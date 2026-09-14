"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { markdownToHtml, stripMarkdown } from "./aiUtils";
import { parseEmailPayloadRecord, readStoredEmailFields } from "./emailPayloadFields";
import { extractEmailAddress } from "./emailAddress";
import {
  getAgentDomain,
  getEmailDeliveryMode,
  getLegacyAgentDomains,
  sendResendEmail,
  type ResendPayload,
  type ResendResult,
} from "./resend";

const MAX_EMAIL_SIZE = 38 * 1024 * 1024;

export type EmailAttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  fileId: Id<"_storage">;
  kind?: "coi" | "original_policy" | "uploaded_file" | "generated_document";
};

export type EmailDeliverySource =
  | "pending_email"
  | "email_subagent"
  | "policy_delivery"
  | "inbound_email"
  | "procurement_packet";

export function buildAgentEmailHtmlBody(
  body: string,
  signature: { html: string },
): string {
  return markdownToHtml(body) + signature.html;
}

export function buildEmailPayload(params: {
  fromHeader: string;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  signature: { text: string; html: string };
  inReplyTo?: string;
  references?: string;
  replyTo?: string;
}): ResendPayload {
  const plainText = stripMarkdown(params.body) + params.signature.text;
  const html = buildAgentEmailHtmlBody(params.body, {
    html: params.signature.html,
  });
  const payload: ResendPayload = {
    from: params.fromHeader,
    to: params.to,
    subject: params.subject,
    text: plainText,
    html,
  };
  if (params.cc.length > 0) payload.cc = params.cc;
  if (params.bcc.length > 0) payload.bcc = params.bcc;
  if (params.replyTo) payload.reply_to = params.replyTo;
  const headers: Record<string, string> = {};
  if (params.inReplyTo) headers["In-Reply-To"] = params.inReplyTo;
  if (params.references ?? params.inReplyTo) {
    headers.References = params.references ?? params.inReplyTo!;
  }
  if (Object.keys(headers).length > 0) payload.headers = headers;
  return payload;
}

export function buildPendingEmailResendPayload(
  pending: Doc<"pendingEmails">,
  options: {
    outboundMessageId: string;
    threadEmail?: string;
  },
): ResendPayload {
  const legacy = parseEmailPayloadRecord(pending.emailPayload);
  const legacyHeaders =
    legacy.headers && typeof legacy.headers === "object"
      ? (legacy.headers as Record<string, unknown>)
      : {};
  const fields = readStoredEmailFields(pending);
  const from = fields.fromHeader;
  if (!from) {
    throw new Error("Draft is missing sender metadata.");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(legacyHeaders)) {
    if (typeof value === "string" && value.trim()) headers[key] = value;
  }
  if (fields.inReplyTo) headers["In-Reply-To"] = fields.inReplyTo;
  if (fields.references ?? fields.inReplyTo) {
    headers.References = fields.references ?? fields.inReplyTo!;
  }
  headers["Message-ID"] = options.outboundMessageId;

  const replyTo = fields.replyTo;
  const retiredDomains = getLegacyAgentDomains();
  const senderAddresses = [
    from,
    replyTo,
    ...Object.entries(headers)
      .filter(([name]) => ["from", "reply-to", "sender"].includes(name.toLowerCase()))
      .map(([, value]) => value),
  ];
  if (
    senderAddresses.some((value) => {
      const domain = extractEmailAddress(value)?.split("@")[1];
      return domain && retiredDomains.includes(domain);
    })
  ) {
    throw new Error(
      `This draft uses a retired Spot email address. Regenerate the draft with an @${getAgentDomain()} sender and reply address, then review it before sending.`,
    );
  }
  const payload: ResendPayload = {
    from,
    to: pending.recipientEmail,
    subject: pending.subject,
    text: fields.renderedText ?? stripMarkdown(pending.emailBody),
    html: fields.renderedHtml,
    headers,
  };

  if (fields.ccAddresses?.length) payload.cc = fields.ccAddresses;
  if (fields.bccAddresses?.length) payload.bcc = fields.bccAddresses;
  if (replyTo && replyTo !== options.threadEmail) {
    payload.reply_to = replyTo;
  }

  return payload;
}

export async function toResendAttachments(
  ctx: ActionCtx,
  attachments: EmailAttachmentMeta[],
): Promise<Array<{ filename: string; content: string }>> {
  let encodedSize = 0;
  const result: Array<{ filename: string; content: string }> = [];

  for (const att of attachments) {
    const blob = await ctx.storage.get(att.fileId);
    if (!blob) {
      throw new Error(`Attachment "${att.filename}" is no longer available.`);
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const content = buffer.toString("base64");
    encodedSize += Buffer.byteLength(content, "utf8");
    if (encodedSize > MAX_EMAIL_SIZE) {
      throw new Error("Attachments are too large to send in one email.");
    }
    result.push({ filename: att.filename, content });
  }

  return result;
}

export async function sendTrackedResendEmail(
  ctx: ActionCtx,
  params: {
    source: EmailDeliverySource;
    orgId: Id<"organizations">;
    pendingEmailId?: Id<"pendingEmails">;
    threadId?: Id<"threads">;
    threadMessageId?: Id<"threadMessages">;
    recipientEmail: string;
    ccAddresses?: string[];
    bccAddresses?: string[];
    subject: string;
    messageId?: string;
    payload: ResendPayload;
    retries?: number;
  },
): Promise<ResendResult> {
  const attemptId = (await ctx.runMutation(
    internal.emailDeliveryAttempts.start,
    {
      orgId: params.orgId,
      pendingEmailId: params.pendingEmailId,
      threadId: params.threadId,
      threadMessageId: params.threadMessageId,
      source: params.source,
      deliveryMode: getEmailDeliveryMode(),
      recipientEmail: params.recipientEmail,
      ccAddresses: params.ccAddresses,
      bccAddresses: params.bccAddresses,
      subject: params.subject,
      messageId: params.messageId,
    },
  )) as Id<"emailDeliveryAttempts">;

  try {
    const result = await sendResendEmail(params.payload, {
      retries: params.retries,
    });
    if (result.ok) {
      await ctx.runMutation(internal.emailDeliveryAttempts.markSent, {
        id: attemptId,
        resendEmailId: result.id,
      });
      return result;
    }

    await ctx.runMutation(internal.emailDeliveryAttempts.markFailed, {
      id: attemptId,
      status: result.error.includes("restricted email delivery blocked")
        ? "blocked"
        : "failed",
      error: result.error,
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(internal.emailDeliveryAttempts.markFailed, {
      id: attemptId,
      status: "failed",
      error,
    });
    return { ok: false, error };
  }
}
