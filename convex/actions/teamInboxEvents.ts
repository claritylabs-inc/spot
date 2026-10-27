"use node";

import dayjs from "dayjs";
import { escapeHtml } from "@claritylabs-inc/ui/lib/email";
import { htmlToPlainText, parseInboundEmail } from "../lib/inboundEmailParser";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { canonicalAddress } from "../lib/emailAddress";
import type { InboxEmail } from "../lib/providerOutreachValidators";
import {
  getThreadEmail,
  isBounceSender,
  isResendInboxError,
  listReceivedEmailAttachments,
  parseInboxWebhookEvent,
  type ResendThreadEmail,
} from "../lib/mailboxTransport";
import { gmailFor } from "../lib/gmailClient";
import { bareRfcId } from "../lib/messageId";
import { hasAlignedSenderDkim } from "../lib/gmailSenderAuthentication";
import { MAX_OPERATOR_EMAIL_RAW_BYTES } from "../lib/operatorEmailAuthentication";
import { labelThread, sanitizedFailure, warn } from "../lib/outreachInboxSupport";
import { fetchReceivedEmailRaw, ReceivedEmailRejectedError } from "../lib/receivingEmail";
import {
  verifySvixWebhook,
  SvixWebhookVerificationError,
} from "../lib/verifySvixWebhook";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_EMAIL_TEXT_CHARS = 100_000;
const MAX_EMAIL_HTML_CHARS = 150_000;
const ATTACHMENT_NOTICE_LIMIT = 20;

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

function addressList(values: string[]): string[] {
  return values
    .map(canonicalAddress)
    .filter(Boolean);
}

function displayName(from: string): string | undefined {
  const name = from.includes("<")
    ? from.slice(0, from.lastIndexOf("<")).replace(/["']/g, "").trim()
    : "";
  return name ? name.slice(0, 300) : undefined;
}

function formatBytes(size: number | null) {
  if (size === null) return "unknown size";
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_ATTACHMENT_DOWNLOADS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type StoredAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

/**
 * Best-effort attachment import for inbound inbox mail through Resend's
 * Receiving API. Any failure keeps the metadata notice instead; files are
 * never invented. Returns the stored files and the Resend ids they cover.
 */
async function downloadInboundAttachments(
  ctx: ActionCtx,
  email: ResendThreadEmail,
): Promise<{ stored: StoredAttachment[]; ids: Set<string> }> {
  const stored: StoredAttachment[] = [];
  const ids = new Set<string>();
  if (!email.attachments.length) return { stored, ids };
  try {
    const listed = await listReceivedEmailAttachments(email.id);
    if (listed.status !== "ok") return { stored, ids };
    const wanted = new Set(email.attachments.map((attachment) => attachment.id));
    for (const attachment of listed.data
      .filter((item) => wanted.has(item.id))
      .slice(0, MAX_ATTACHMENT_DOWNLOADS)) {
      if ((attachment.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
      const response = await fetch(attachment.downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
      const contentType =
        attachment.contentType ||
        response.headers.get("content-type") ||
        "application/octet-stream";
      const fileId = await ctx.storage.store(
        new Blob([bytes], { type: contentType }),
      );
      stored.push({
        fileId,
        filename: (attachment.filename ?? "attachment").slice(0, 200),
        contentType,
        size: bytes.byteLength,
      });
      ids.add(attachment.id);
    }
  } catch (error) {
    warn("inbox attachment download failed", error);
  }
  return { stored, ids };
}

/**
 * Whether a received email from a connected Gmail address is provably that
 * operator's own: it is in their Gmail Sent folder (looked up by Message-ID),
 * or its original MIME carries aligned DKIM. A lapsed connection or a missing
 * Sent copy falls through to DKIM; without proof the mail stays ordinary
 * inbound. A transient Google error or DNS temperror throws so the event is
 * retried. The Sent lookup is a single immediate check.
 */
async function gmailSenderAuthenticated(
  ctx: ActionCtx,
  event: { eventType: string; emailId: string },
  email: InboxEmail,
) {
  if (event.eventType !== "inbox.email.received") return false;
  const connection = await ctx.runQuery(internal.gmailInbound.senderConnectionInternal, {
    address: email.fromEmail,
  });
  if (!connection) return false;
  if (email.messageId && (await inGmailSentFolder(ctx, connection.address, email.messageId)))
    return true;
  try {
    const received = await fetchReceivedEmailRaw(event.emailId, MAX_OPERATOR_EMAIL_RAW_BYTES);
    return (
      received.status === "available" &&
      (await hasAlignedSenderDkim(received.raw, {
        address: email.fromEmail,
        messageId: email.messageId,
      }))
    );
  } catch (error) {
    if (error instanceof ReceivedEmailRejectedError) return false;
    throw error;
  }
}

async function inGmailSentFolder(ctx: ActionCtx, address: string, messageId: string) {
  let gmail: Awaited<ReturnType<typeof gmailFor>>["gmail"];
  try {
    ({ gmail } = await gmailFor(ctx, address));
  } catch (error) {
    if (isResendInboxError(error) && error.outcome === "blocked") return false;
    throw error;
  }
  try {
    const listed = await gmail.users.messages.list({
      userId: "me",
      q: `rfc822msgid:${bareRfcId(messageId)} in:sent`,
      maxResults: 1,
    });
    return (listed.data.messages?.length ?? 0) > 0;
  } catch (error) {
    const status = (error as { code?: unknown; status?: unknown }).status ?? (error as { code?: unknown }).code;
    // Only an outage or throttling is worth a retry; a revoked or unauthorised grant just means no proof.
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) return false;
    throw error;
  }
}

/**
 * Bounded mirror DTO. Attachments that were not imported are named in a
 * notice appended to the body; no file bytes are invented.
 */
function toInboxEmail(
  email: ResendThreadEmail,
  downloadedIds: Set<string> = new Set(),
): InboxEmail {
  const pending = email.attachments.filter(
    (attachment) => !downloadedIds.has(attachment.id),
  );
  const notices = pending
    .slice(0, ATTACHMENT_NOTICE_LIMIT)
    .map((attachment) => {
      const name = (attachment.filename ?? "unnamed file")
        .replace(/\s+/g, " ")
        .slice(0, 200);
      return `${name} (${formatBytes(attachment.size)})`;
    });
  const omitted = Math.max(0, pending.length - notices.length);
  const noticeText = notices.length
    ? `\n\n[Attachments not downloaded; open them in Resend: ${notices.join("; ")}${omitted ? `; and ${omitted} more` : ""}.]`
    : "";
  const baseText =
    email.text?.trim() || (email.html ? htmlToPlainText(email.html, MAX_EMAIL_HTML_CHARS) : "");
  const parsed = parseInboundEmail({ subject: email.subject ?? undefined, text: baseText, html: email.html ?? undefined });
  const received = dayjs(email.receivedAt);
  const noticeHtml = notices.length
    ? `<p><em>${escapeHtml(noticeText.trim())}</em></p>`
    : "";
  return {
    resendInboxEmailId: email.id,
    fromEmail: addressList([email.from])[0] ?? "unknown@unknown.invalid",
    ...(displayName(email.from) ? { fromName: displayName(email.from) } : {}),
    toAddresses: addressList(email.to),
    ccAddresses: addressList(email.cc),
    bccAddresses: addressList(email.bcc),
    subject: (email.subject ?? "").slice(0, 500),
    ...(email.messageId ? { messageId: email.messageId.slice(0, 500) } : {}),
    references: [],
    text: `${parsed.currentText.slice(0, MAX_EMAIL_TEXT_CHARS)}${noticeText}`,
    ...(parsed.forwarded ? { forwarded: parsed.forwarded } : {}),
    html: `${email.html?.slice(0, MAX_EMAIL_HTML_CHARS) ?? `<pre>${escapeHtml(baseText.slice(0, MAX_EMAIL_TEXT_CHARS))}</pre>`}${noticeHtml}`,
    occurredAt: received.isValid() ? received.valueOf() : dayjs().valueOf(),
  };
}

export const handleInboxEvent = internalAction({
  args: { eventId: v.id("providerOutreachWebhookEvents") },
  handler: async (ctx, { eventId }): Promise<{ status: string }> => {
    const claim = await ctx.runMutation(
      internal.teamInboxEvents.claimInboxEventInternal,
      {
        eventId,
      },
    );
    if (claim.status !== "claimed") return { status: claim.status };
    const { leaseToken, event, route, inbox } = claim;
    const target = inbox ?? { inboxId: event.inboxId };
    // Files stored before the mirror mutation; removed if it never runs.
    let uploaded: StoredAttachment[] = [];

    const complete = (error?: string) =>
      ctx.runMutation(internal.teamInboxEvents.completeInboxEventInternal, {
        eventId,
        leaseToken,
        ...(error ? { error } : {}),
      });

    try {
      // The command-channel inbox is reserved for its own routing, never imported as mail.
      if (route.kind === "agent") {
        if (event.eventType === "inbox.email.received") {
          await ctx.runAction(internal.actions.handleInboundOperatorEmail.processInboxCommand, {
            inboxId: event.inboxId,
            resendThreadId: event.threadId,
            emailId: event.emailId,
          });
        }
        await complete();
        return { status: "agent_command" as const };
      }
      // Unknown inbox (the webhook is account-wide): nothing to import.
      if (route.kind === "unmatched") {
        if (event.eventType === "inbox.email.received")
          await labelThread(target, event.threadId, "needsReply");
        await complete();
        return { status: "unmatched" as const };
      }

      let fetched: Awaited<ReturnType<typeof getThreadEmail>>;
      try {
        fetched = await getThreadEmail(
          ctx,
          event.inboxId,
          event.threadId,
          event.emailId,
        );
      } catch (error) {
        if (isResendInboxError(error) && error.retryable) {
          await ctx.runMutation(
            internal.teamInboxEvents.releaseInboxEventInternal,
            {
              eventId,
              leaseToken,
              error: sanitizedFailure(error).message,
            },
          );
          return { status: "retry" as const };
        }
        // Permanent fetch failure: fail closed. The reply hold stays and hands to
        // the operator at the reply-check timeout; never resume, never drop silently.
        warn("inbox email fetch failed", error);
        if (event.eventType === "inbox.email.received")
          await labelThread(target, event.threadId, "needsReply");
        await complete(sanitizedFailure(error).message);
        return { status: "fetch_failed" as const };
      }
      if (fetched.status !== "ok") {
        await complete("capture_mode_no_fetch");
        return { status: "captured" as const };
      }
      const downloads =
        event.eventType === "inbox.email.received"
          ? await downloadInboundAttachments(ctx, fetched.data)
          : { stored: [], ids: new Set<string>() };
      uploaded = downloads.stored;
      const email = toInboxEmail(fetched.data, downloads.ids);

      if (route.kind !== "sequence") {
        const applied = await ctx.runMutation(
          internal.teamInboxEvents.applyTeamInboxEmailInternal,
          {
            eventId,
            leaseToken,
            email,
            attachments: downloads.stored,
            gmailSenderAuthenticated: await gmailSenderAuthenticated(ctx, event, email),
          },
        );
        uploaded = [];
        if (
          applied.applied &&
          !applied.duplicate &&
          !applied.gmailSent &&
          event.eventType === "inbox.email.received"
        )
          await labelThread(target, event.threadId, "needsReply");
        return {
          status: applied.applied
            ? ("team_mirrored" as const)
            : ("team_not_applied" as const),
        };
      }

      if (event.eventType === "inbox.email.sent") {
        const applied = await ctx.runMutation(
          internal.providerOutreach.applySentInboxEmailInternal,
          {
            eventId,
            leaseToken,
            sequenceId: route.sequenceId,
            email,
          },
        );
        if (applied.applied && route.stepId)
          await labelThread(target, event.threadId, "automated");
        return { status: "sent_mirrored" as const };
      }

      const applied = await ctx.runMutation(
        internal.providerOutreach.applyInboundInboxEmailInternal,
        {
          eventId,
          leaseToken,
          sequenceId: route.sequenceId,
          email,
          attachments: downloads.stored,
          classification: isBounceSender(fetched.data.from)
            ? "bounce"
            : "reply",
        },
      );
      uploaded = [];
      if (applied.applied && applied.needsReplyLabel)
        await labelThread(target, event.threadId, "needsReply");
      return { status: "received_applied" as const };
    } catch (error) {
      warn("inbox event handling failed", error);
      await Promise.all(
        uploaded.map((file) => ctx.storage.delete(file.fileId).catch(() => {})),
      );
      try {
        await ctx.runMutation(
          internal.teamInboxEvents.releaseInboxEventInternal,
          {
            eventId,
            leaseToken,
            error: "Unexpected event handling error",
          },
        );
      } catch (releaseError) {
        warn("could not release inbox event", releaseError);
      }
      return { status: "error" as const };
    }
  },
});

// ---------------------------------------------------------------------------
// HTTP ingress (called by the manager's /resend-inbox-webhook route)
// ---------------------------------------------------------------------------

export const handleInboxWebhook = internalAction({
  args: {
    payload: v.string(),
    svixId: v.string(),
    svixTimestamp: v.string(),
    svixSignature: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    status: v.number(),
    outcome: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; status: number; outcome: string }> => {
    if (Buffer.byteLength(args.payload, "utf8") > MAX_WEBHOOK_BYTES)
      return { ok: false, status: 413, outcome: "payload_too_large" };
    // Strict signature first; nothing is parsed or recorded before it passes.
    try {
      verifySvixWebhook({
        secret: process.env.RESEND_INBOX_WEBHOOK_SECRET,
        payload: args.payload,
        svixId: args.svixId,
        svixTimestamp: args.svixTimestamp,
        svixSignature: args.svixSignature,
      });
    } catch (error) {
      if (error instanceof SvixWebhookVerificationError) {
        if (error.code === "missing_secret") {
          console.error(
            "[provider-outreach] RESEND_INBOX_WEBHOOK_SECRET is not configured",
          );
          return { ok: false, status: 503, outcome: "webhook_not_configured" };
        }
        return { ok: false, status: 401, outcome: error.code };
      }
      return { ok: false, status: 401, outcome: "invalid_signature" };
    }

    const parsed = parseInboxWebhookEvent(args.payload);
    // Authenticated events of other types are acknowledged and ignored.
    if (parsed.kind === "unrecognized")
      return { ok: true, status: 200, outcome: "ignored_event_type" };
    // A recognized event without its ids cannot be recorded: reject, never ack.
    if (parsed.kind === "malformed") {
      console.warn("[provider-outreach] malformed inbox webhook", {
        type: parsed.type,
        reason: parsed.reason,
      });
      return { ok: false, status: 400, outcome: "malformed_event" };
    }
    const { event } = parsed;
    try {
      const recorded = await ctx.runMutation(
        internal.teamInboxEvents.recordInboxEventInternal,
        {
          emailId: event.emailId,
          eventType: event.type,
          inboxId: event.inboxId,
          threadId: event.threadId,
          ...(event.occurredAt !== undefined
            ? { occurredAt: event.occurredAt }
            : {}),
        },
      );
      // The webhook is account-wide: other inboxes are acknowledged, not handled.
      if (!recorded.recorded)
        return { ok: true, status: 200, outcome: "unknown_inbox" };
      return {
        ok: true,
        status: 200,
        outcome: recorded.duplicate ? "duplicate" : "recorded",
      };
    } catch (error) {
      warn("could not record inbox event", error);
      // Retryable: Resend redelivers a non-2xx response.
      return { ok: false, status: 500, outcome: "record_failed" };
    }
  },
});
