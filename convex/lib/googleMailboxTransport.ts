"use node";
import { simpleParser } from "mailparser";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { withClient } from "./imapMailbox";
import { MAILBOX_PREFIX } from "./inboxIds";
import { normalizeContentId } from "./providerOutreachValidators";
import {
  type CreateDraftParams,
  type ResendInboxDraft,
  type ResendInboxResult,
} from "./resendInbox";

export function imapFor(address: string, encryptedPassword: string) {
  return {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    username: address,
    encryptedPassword,
  };
}
const idOf = (id: string) =>
  id.replace(/^gmail-draft:/, "") as Id<"operatorMailboxDrafts">;
const list = (value: string | string[] | undefined) =>
  value ? (Array.isArray(value) ? value : [value]) : [];
type Payload = CreateDraftParams & { fromName: string; messageId: string };
async function payload(ctx: ActionCtx, id: string) {
  const draft = await ctx.runQuery(internal.operatorSendingMailboxes.getDraft, {
    id: idOf(id),
  });
  if (!draft) throw new Error("Mailbox draft not found");
  const blob = await ctx.storage.get(draft.payloadId);
  if (!blob) throw new Error("Mailbox draft content unavailable");
  return { draft, value: JSON.parse(await blob.text()) as Payload };
}
export async function readGoogleDraft(
  ctx: ActionCtx,
  inboxId: string,
  id: string,
): Promise<ResendInboxResult<ResendInboxDraft>> {
  const { draft, value } = await payload(ctx, id);
  const box = await ctx.runQuery(internal.operatorSendingMailboxes.connection, {
    address: inboxId.slice(MAILBOX_PREFIX.length),
  });
  if (!box || box._id !== draft.mailboxId)
    throw new Error("Mailbox draft binding mismatch");
  if (
    (draft.status === "unknown" || draft.status === "sending") &&
    new Set(draft.recipients.map((address) => address.toLowerCase())).size === 1
  ) {
    // A Sent copy proves acceptance only for a single-recipient envelope. With
    // several recipients it cannot rule out partial rejection; keep that send
    // locked for manual review. Absence never authorizes replay.
    await withClient(
      imapFor(box.address, box.encryptedPassword),
      async (client) => {
        const folders = await client.list();
        const sent = folders.find((folder) => folder.specialUse === "\\Sent");
        if (!sent) return;
        await client.mailboxOpen(sent.path, { readOnly: true });
        const matches = await client.search(
          { header: { "message-id": draft.messageId } },
          { uid: true },
        );
        if (matches && matches.length)
          await ctx.runMutation(internal.operatorSendingMailboxes.finishDraft, {
            id: draft._id,
            status: "sent",
          });
      },
    ).catch(() => null);
  }
  const current = await ctx.runQuery(
    internal.operatorSendingMailboxes.getDraft,
    { id: draft._id },
  );
  return {
    status: "ok",
    replayed: false,
    data: {
      id,
      type: value.threadId ? "reply" : "standalone",
      to: list(value.to),
      cc: list(value.cc),
      bcc: list(value.bcc),
      subject: value.subject ?? null,
      text: value.text ?? null,
      html: value.html ?? null,
      threadId: value.threadId ?? null,
      replyToEmailId: value.replyToEmailId ?? null,
      emailId: current?.status === "sent" ? draft.messageId : null,
    },
  };
}
export async function syncGoogleMailbox(
  ctx: ActionCtx,
  address: string,
): Promise<boolean> {
  const box = await ctx.runQuery(internal.operatorSendingMailboxes.connection, {
    address,
  });
  if (!box) return false;
  const state = await ctx.runQuery(
    internal.operatorSendingMailboxes.syncState,
    { mailboxId: box._id },
  );
  await withClient(
    imapFor(box.address, box.encryptedPassword),
    async (client) => {
      const folders = await client.list();
      const spam = folders.find((folder) => folder.specialUse === "\\Junk");
      for (const folder of [
        { path: "INBOX", kind: "inbox" as const },
        ...(spam ? [{ path: spam.path, kind: "spam" as const }] : []),
      ]) {
        const mailbox = await client.mailboxOpen(folder.path, {
          readOnly: true,
        });
        const validity = String(mailbox.uidValidity);
        const previous =
          (folder.kind === "spam"
            ? state?.spamUidValidity
            : state?.inboxUidValidity) === validity
            ? folder.kind === "spam"
              ? state?.spamUid
              : state?.inboxUid
            : undefined;
        // On first connection start now, rather than importing historical warmup/private mail.
        if (previous === undefined) {
          await ctx.runMutation(internal.operatorSendingMailboxes.saveSync, {
            mailboxId: box._id,
            uid: Math.max(0, mailbox.uidNext - 1),
            uidValidity: validity,
            folder: folder.kind,
          });
          continue;
        }
        const found = await client.search(
          { uid: `${previous + 1}:*` },
          { uid: true },
        );
        const ids = (found || []).filter((uid) => uid > previous).slice(0, 25);
        let checkpoint = previous;
        for (const uid of ids) {
          const message = await client.fetchOne(
            uid,
            { source: true },
            { uid: true },
          );
          if (!message || !message.source) {
            checkpoint = uid;
            continue;
          }
          if (message.source.byteLength > 20 * 1024 * 1024)
            throw new Error(
              "Reply exceeds sync size budget; review the original mailbox",
            ); // Do not advance past an unreadable large reply.
          const parsed = await simpleParser(message.source);
          const refs =
            typeof parsed.references === "string"
              ? [parsed.references]
              : (parsed.references ?? []);
          const from = parsed.from?.value[0];
          const addressList = (field: typeof parsed.to) =>
            !field
              ? []
              : (Array.isArray(field) ? field : [field])
                  .flatMap((item) => item.value.map((a) => a.address ?? ""))
                  .filter(Boolean);
          // Check ownership before storing any attachment from this private mailbox.
          let known = false;
          for (const ref of [...refs, parsed.inReplyTo ?? ""]
            .filter(Boolean)
            .slice(-30)) {
            if (
              await ctx.runQuery(internal.operatorSendingMailboxes.message, {
                address: box.address,
                messageId: ref,
              })
            ) {
              known = true;
              break;
            }
          }
          if (!known) {
            checkpoint = uid;
            continue;
          }
          const attachments: {
            fileId: Id<"_storage">;
            filename: string;
            contentType: string;
            size: number;
            contentId?: string;
          }[] = [];
          for (const file of parsed.attachments.slice(0, 20)) {
            const fileId = await ctx.storage.store(
              new Blob([new Uint8Array(file.content)], {
                type: file.contentType,
              }),
            );
            attachments.push({
              fileId,
              filename: file.filename ?? "attachment",
              contentType: file.contentType,
              size: file.size,
              ...(normalizeContentId(file.contentId)
                ? { contentId: normalizeContentId(file.contentId) }
                : {}),
            });
          }
          const omitted =
            parsed.attachments.length > 20
              ? "\n\n[Additional attachments remain in the connected Gmail mailbox.]"
              : "";
          try {
            await ctx.runMutation(internal.operatorSendingMailboxes.ingest, {
              mailboxId: box._id,
              attachments,
              email: {
                resendInboxEmailId: `gmail:${box.address}:${folder.kind}:${validity}:${uid}`,
                fromEmail: from?.address ?? "",
                ...(from?.name ? { fromName: from.name } : {}),
                toAddresses: addressList(parsed.to),
                ccAddresses: addressList(parsed.cc),
                bccAddresses: [],
                subject: parsed.subject ?? "(no subject)",
                ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
                ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
                references: refs,
                text: (parsed.text ?? "").slice(0, 100000) + omitted,
                ...(parsed.html ? { html: parsed.html.slice(0, 180_000) } : {}),
                occurredAt: parsed.date?.valueOf() ?? dayjs().valueOf(),
              },
            });
          } catch (error) {
            await Promise.all(
              attachments.map((file) => ctx.storage.delete(file.fileId)),
            );
            throw error;
          }
          checkpoint = uid;
        }
        await ctx.runMutation(internal.operatorSendingMailboxes.saveSync, {
          mailboxId: box._id,
          uid: checkpoint,
          uidValidity: validity,
          folder: folder.kind,
        });
      }
    },
  );
  return true;
}
