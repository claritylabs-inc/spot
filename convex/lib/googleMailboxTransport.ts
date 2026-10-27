"use node";
import { createHash } from "node:crypto";
import nodemailer from "spot-mailer";
import { simpleParser } from "mailparser";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { decryptPassword, withClient } from "./imapMailbox";
import { MAILBOX_PREFIX } from "./sendingMailbox";
import { operatorFromName } from "./teamEmail";
import {
  evaluateRecipientDeliveryPolicy,
  getTestModeRecipient,
  getEmailDeliveryMode,
} from "./resend";
import {
  ResendInboxError,
  validateDraftAttachments,
  type CreateDraftParams,
  type ResendInboxDraft,
  type ResendInboxResult,
} from "./resendInbox";

export function smtpFor(address: string, encryptedPassword: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: address, pass: decryptPassword(encryptedPassword) },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    logger: false,
    debug: false,
  });
}
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
export async function createGoogleDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  draftParams: CreateDraftParams,
): Promise<ResendInboxResult<{ id: string }>> {
  const testModeRecipient = await getTestModeRecipient(ctx, actor);
  const params: CreateDraftParams = testModeRecipient
    ? {
        ...draftParams,
        to: testModeRecipient,
        cc: undefined,
        bcc: undefined,
        subject: draftParams.subject?.startsWith("[TEST]")
          ? draftParams.subject
          : `[TEST] ${draftParams.subject ?? ""}`.trim(),
      }
    : draftParams;
  if (
    !params.idempotencyKey?.trim() ||
    (!params.text && !params.html) ||
    Boolean(params.threadId) !== Boolean(params.replyToEmailId)
  )
    throw new ResendInboxError(
      "permanent",
      "createDraft",
      "Invalid mailbox draft",
    );
  if (params.attachments?.length)
    validateDraftAttachments("createDraft", params.attachments);
  const address = params.inboxId.slice(MAILBOX_PREFIX.length);
  const box = await ctx.runQuery(internal.operatorSendingMailboxes.connection, {
    address,
  });
  if (!box || box.ownerUserId !== actor)
    throw new ResendInboxError(
      "blocked",
      "createDraft",
      "Mailbox does not belong to this sender",
    );
  const recipients = [
    ...list(params.to),
    ...list(params.cc),
    ...list(params.bcc),
  ];
  const policy = evaluateRecipientDeliveryPolicy(recipients, testModeRecipient);
  if (policy.action !== "send")
    throw new ResendInboxError(
      "blocked",
      "createDraft",
      "Mailbox recipients are blocked by delivery policy",
    );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
  const key = box.address + ":" + params.idempotencyKey;
  const old = await ctx.runQuery(internal.operatorSendingMailboxes.draftByKey, {
    key,
  });
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new Error("Draft key content mismatch");
    return {
      status: "ok",
      data: { id: "gmail-draft:" + old._id },
      replayed: true,
    };
  }
  const identity = await ctx.runQuery(
    internal.operatorInboxes.getTeamIdentityInternal,
    { userId: actor },
  );
  const messageId = `<spot-${createHash("sha256").update(key).digest("hex")}@insurewithspot.com>`;
  const payloadId = await ctx.storage.store(
    new Blob(
      [
        JSON.stringify({
          ...params,
          fromName: operatorFromName(identity.name),
          messageId,
        }),
      ],
      { type: "application/json" },
    ),
  );
  const id = await ctx.runMutation(
    internal.operatorSendingMailboxes.storeDraft,
    { mailboxId: box._id, key, fingerprint, payloadId, messageId, recipients },
  );
  return { status: "ok", data: { id: "gmail-draft:" + id }, replayed: false };
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
export async function sendGoogleDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  inboxId: string,
  id: string,
): Promise<ResendInboxResult<{ emailId: string }>> {
  const { draft, value } = await payload(ctx, id);
  const box = await ctx.runQuery(internal.operatorSendingMailboxes.connection, {
    address: inboxId.slice(MAILBOX_PREFIX.length),
  });
  if (!box || box._id !== draft.mailboxId || box.ownerUserId !== actor)
    throw new ResendInboxError(
      "blocked",
      "sendDraft",
      "Sender mailbox mismatch",
    );
  if (!box.enabled)
    throw new ResendInboxError(
      "blocked",
      "sendDraft",
      "Sender mailbox is paused",
      { code: "mailbox_paused" },
    );
  if (getEmailDeliveryMode() === "capture")
    throw new ResendInboxError(
      "blocked",
      "sendDraft",
      "Capture mode cannot send through Google",
    );
  const policy = evaluateRecipientDeliveryPolicy(
    draft.recipients,
    await getTestModeRecipient(ctx, actor),
  );
  if (policy.action !== "send")
    throw new ResendInboxError(
      "blocked",
      "sendDraft",
      "Delivery policy blocked recipients",
    );
  const claim = await ctx.runMutation(
    internal.operatorSendingMailboxes.claimDraft,
    { id: draft._id },
  );
  if (claim.status === "sent")
    return { status: "ok", data: { emailId: draft.messageId }, replayed: true };
  if (claim.status === "throttled")
    throw new ResendInboxError(
      "transient",
      "sendDraft",
      "Mailbox sending limit reached; try after " +
        dayjs(claim.retryAt).toISOString(),
      {
        code: "mailbox_throttled",
        retryAfterMs: Math.max(1000, claim.retryAt - dayjs().valueOf()),
      },
    );
  if (claim.status !== "claimed")
    throw new ResendInboxError(
      "unknown",
      "sendDraft",
      "Earlier send is unresolved; it will not be replayed",
    );
  const transport = smtpFor(box.address, box.encryptedPassword);
  try {
    const reply = value.replyToEmailId?.startsWith("<")
      ? value.replyToEmailId
      : undefined;
    const result = await transport.sendMail({
      from: { name: value.fromName, address: box.address },
      to: list(value.to),
      cc: list(value.cc),
      bcc: list(value.bcc),
      subject: value.subject,
      text: value.text,
      html: value.html,
      messageId: draft.messageId,
      ...(reply ? { inReplyTo: reply, references: [reply] } : {}),
      attachments: value.attachments?.map((file) => ({
        filename: file.filename,
        content: Buffer.from(file.content, "base64"),
        contentType: file.contentType,
      })),
    });
    if (result.rejected?.length)
      throw new Error(
        "Some recipients were rejected; manual reconciliation required",
      );
    await ctx.runMutation(internal.operatorSendingMailboxes.finishDraft, {
      id: draft._id,
      status: "sent",
    });
    return {
      status: "ok",
      data: { emailId: draft.messageId },
      replayed: false,
    };
  } catch {
    await ctx
      .runMutation(internal.operatorSendingMailboxes.finishDraft, {
        id: draft._id,
        status: "unknown",
        error:
          "Google send outcome unconfirmed. Check Sent mail; Spot will not replay it.",
      })
      .catch(() => null);
    throw new ResendInboxError(
      "unknown",
      "sendDraft",
      "Google send outcome is unknown; read-only reconciliation required",
    );
  } finally {
    transport.close();
  }
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
