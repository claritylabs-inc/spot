"use node";

import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import dayjs from "dayjs";
import { escapeHtml } from "@claritylabs-inc/ui/lib/email";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { htmlToPlainText, parseInboundEmail } from "./inboundEmailParser";
import type { GoogleWorkspaceRawMessage } from "./googleWorkspaceProvider";
import { MAX_OPERATOR_EMAIL_RAW_BYTES } from "./operatorEmailAuthentication";
import type { InboxEmail } from "./providerOutreachValidators";

/** The key a Gmail message is stored under in `teamEmailMessages.resendInboxEmailId`. */
export const gmailMessageKey = (address: string, gmailMessageId: string) =>
  `google:${address}:${gmailMessageId}`;

const MAX_TEXT_CHARS = 100_000;
const MAX_HTML_CHARS = 150_000;
const MAX_ATTACHMENT_FILES = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_NOTICES = 20;
/** Enough of an oversized message to read its headers. */
const HEADER_SLICE_BYTES = 256 * 1024;

export type ImportedAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

export type ImportedGmailMessage = {
  email: InboxEmail;
  attachments: ImportedAttachment[];
  /** The Sent label: the connected operator's own outbound mail. */
  sent: boolean;
};

function addresses(field: AddressObject | AddressObject[] | undefined) {
  if (!field) return [];
  return (Array.isArray(field) ? field : [field])
    .flatMap((group) => group.value.map((entry) => entry.address?.toLowerCase() ?? ""))
    .filter(Boolean);
}

const idList = (value: string | string[] | undefined) =>
  (value ? (Array.isArray(value) ? value : value.split(/\s+/)) : []).filter(Boolean);

function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Stores a parsed message's attachments, bounded by the Resend inbox import's
 * limits (10 files of at most 25 MB). Inline images the HTML embeds are skipped;
 * anything not stored is named in the returned notice, never invented.
 */
async function storeAttachments(ctx: ActionCtx, parsed: ParsedMail) {
  const stored: ImportedAttachment[] = [];
  const skipped: string[] = [];
  try {
    for (const attachment of parsed.attachments) {
      if (attachment.related) continue;
      const name = (attachment.filename ?? "attachment").replace(/\s+/g, " ").slice(0, 200);
      if (stored.length >= MAX_ATTACHMENT_FILES || attachment.size > MAX_ATTACHMENT_BYTES) {
        skipped.push(`${name} (${formatBytes(attachment.size)})`);
        continue;
      }
      const fileId = await ctx.storage.store(
        new Blob([new Uint8Array(attachment.content)], { type: attachment.contentType }),
      );
      stored.push({
        fileId,
        filename: name,
        contentType: attachment.contentType || "application/octet-stream",
        size: attachment.size,
      });
    }
  } catch (error) {
    await Promise.all(stored.map((file) => ctx.storage.delete(file.fileId).catch(() => null)));
    throw error;
  }
  const listed = skipped.slice(0, MAX_ATTACHMENT_NOTICES);
  const omitted = skipped.length - listed.length;
  const notice = listed.length
    ? `\n\n[Attachments not imported; open them in Gmail: ${listed.join("; ")}${omitted > 0 ? `; and ${omitted} more` : ""}.]`
    : "";
  return { stored, notice };
}

/**
 * Parses one raw Gmail message into a team inbox email and its stored
 * attachments. Returns the message ready for `mirrorTeamEmail`; nothing about
 * the mailbox beyond this message is read.
 */
export async function importGmailMessage(
  ctx: ActionCtx,
  args: { address: string; message: GoogleWorkspaceRawMessage },
): Promise<ImportedGmailMessage> {
  const { message } = args;
  const bytes = Buffer.from(message.raw, "base64url");
  const oversized = bytes.byteLength > MAX_OPERATOR_EMAIL_RAW_BYTES;
  const parsed = await simpleParser(oversized ? bytes.subarray(0, HEADER_SLICE_BYTES) : bytes);
  const { stored, notice: attachmentNotice } = oversized
    ? { stored: [], notice: "" }
    : await storeAttachments(ctx, parsed);

  const html = typeof parsed.html === "string" ? parsed.html : "";
  const plain = parsed.text?.trim() ? parsed.text : html ? htmlToPlainText(html) : "";
  const content = oversized
    ? { currentText: "[This message is too large to import; open it in Gmail.]", forwarded: undefined }
    : parseInboundEmail({ subject: parsed.subject, text: plain, html: html || undefined });
  const from = parsed.from?.value[0];
  const internalDate = Number(message.internalDate);
  const date = Number.isFinite(internalDate) && internalDate > 0 ? internalDate : parsed.date?.valueOf();
  const noticeHtml = attachmentNotice ? `<p><em>${escapeHtml(attachmentNotice.trim())}</em></p>` : "";
  const email: InboxEmail = {
    resendInboxEmailId: gmailMessageKey(args.address, message.id),
    fromEmail: from?.address?.toLowerCase() ?? "unknown@unknown.invalid",
    ...(from?.name ? { fromName: from.name.slice(0, 300) } : {}),
    toAddresses: addresses(parsed.to),
    ccAddresses: addresses(parsed.cc),
    bccAddresses: addresses(parsed.bcc),
    subject: (parsed.subject ?? "").slice(0, 500),
    ...(parsed.messageId ? { messageId: parsed.messageId.slice(0, 500) } : {}),
    ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo.slice(0, 500) } : {}),
    references: idList(parsed.references).slice(-50),
    text: `${content.currentText.slice(0, MAX_TEXT_CHARS)}${attachmentNotice}`,
    ...(content.forwarded ? { forwarded: content.forwarded } : {}),
    html: oversized
      ? undefined
      : `${html ? html.slice(0, MAX_HTML_CHARS) : `<pre>${escapeHtml(plain.slice(0, MAX_TEXT_CHARS))}</pre>`}${noticeHtml}`,
    occurredAt: date ?? dayjs().valueOf(),
  };
  return { email, attachments: stored, sent: message.labelIds.includes("SENT") };
}
