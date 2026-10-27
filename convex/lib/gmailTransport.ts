"use node";
import { createHash } from "node:crypto";
import MailComposer from "spot-mailer/lib/mail-composer";
import type { gmail_v1 } from "googleapis";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { gmailFor } from "./gmailClient";
import { gmailAddressOf } from "./operatorGmail";
import { gmailReconnectError } from "./operatorInbox";
import {
  evaluateRecipientDeliveryPolicy,
  getEmailDeliveryMode,
  getTestModeRecipient,
  logLocalEmailCapture,
} from "./resend";
import {
  ResendInboxError,
  capturedResourceId,
  validateDraftAttachments,
  type CreateDraftParams,
  type ResendInboxDraft,
  type ResendInboxResult,
  type SendDraftParams,
} from "./resendInbox";
import { operatorFromName } from "./teamEmail";

/**
 * Sends operator correspondence through the operator's connected Gmail
 * (`google:<address>` inbox ids). It keeps the Resend inbox transport contract:
 * `createDraft` stores an immutable payload, `sendDraft` claims it before any
 * Gmail write, and `getDraft` only ever uses positive evidence (the
 * deterministic Message-ID found in the account) to settle an unknown send.
 * Gmail is never written to except by `messages.send`; `gmail.readonly` is used
 * to find a reply's thread and to reconcile an unknown send by `rfc822msgid:`.
 *
 * `EMAIL_DELIVERY_MODE` is enforced here as the Resend transport does: capture
 * makes no call, restricted and operator test mode check every recipient.
 */

export type GmailCreateDraftParams = CreateDraftParams & {
  /** RFC Message-IDs of the conversation, oldest to newest; Gmail threads by them. */
  references?: string[];
};

type Payload = GmailCreateDraftParams & { fromName: string; messageId: string };

const DRAFT_PREFIX = "gmail-oauth-draft:";
const DEFAULT_THROTTLE_MS = 60_000;
const QUOTA_THROTTLE_MS = 60 * 60 * 1000;

const idOf = (id: string) => id.replace(DRAFT_PREFIX, "") as Id<"operatorGmailDrafts">;
const list = (value: string | string[] | undefined) =>
  value ? (Array.isArray(value) ? value : [value]) : [];

const RATE_LIMIT_REASONS = ["ratelimitexceeded", "userratelimitexceeded"];
const QUOTA_REASONS = ["quotaexceeded", "dailylimitexceeded"];

type GmailApiError = {
  code?: number | string;
  status?: number;
  message?: string;
  errors?: { reason?: string }[];
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
    data?: { error?: { errors?: { reason?: string }[]; message?: string } | string };
  };
};

/**
 * Maps a failed Gmail call. A write that may have been processed (network
 * error, 5xx, anything unrecognized) is `unknown`; a definite rejection is not.
 * 401 and `invalid_grant` mean the connection must be reconnected.
 */
function mapGmailError(
  operation: "createDraft" | "sendDraft",
  error: unknown,
  isWrite: boolean,
): ResendInboxError {
  const e = (error ?? {}) as GmailApiError;
  const status =
    e.response?.status ?? e.status ?? (typeof e.code === "number" ? e.code : undefined);
  const body = e.response?.data?.error;
  const reasons = [
    ...(e.errors ?? []),
    ...(typeof body === "object" ? (body?.errors ?? []) : []),
  ].map((entry) => (entry.reason ?? "").toLowerCase());
  const text = `${e.message ?? ""} ${typeof body === "string" ? body : ""}`;
  if (status === 401 || /invalid_grant/i.test(text)) return gmailReconnectError(operation);
  const retryHeader = e.response?.headers?.["retry-after"];
  const retryAfter = Number(Array.isArray(retryHeader) ? retryHeader[0] : retryHeader);
  if (status === 429 || reasons.some((reason) => RATE_LIMIT_REASONS.includes(reason))) {
    return new ResendInboxError("transient", operation, "Gmail is rate limiting this account", {
      status,
      code: "mailbox_throttled",
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_THROTTLE_MS,
    });
  }
  if (reasons.some((reason) => QUOTA_REASONS.includes(reason))) {
    return new ResendInboxError("transient", operation, "Gmail sending quota reached", {
      status,
      code: "mailbox_throttled",
      retryAfterMs: QUOTA_THROTTLE_MS,
    });
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
    return new ResendInboxError("permanent", operation, "Gmail rejected the request", {
      status,
      code: reasons[0] || "gmail_rejected",
    });
  }
  return new ResendInboxError(isWrite ? "unknown" : "transient", operation, "no usable response from Gmail", {
    status,
    code: "no_response",
  });
}

async function payload(ctx: ActionCtx, id: string) {
  const draft = await ctx.runQuery(internal.operatorGmailDrafts.getInternal, { id: idOf(id) });
  if (!draft) throw new Error("Gmail draft not found");
  const blob = await ctx.storage.get(draft.payloadId);
  if (!blob) throw new Error("Gmail draft content unavailable");
  return { draft, value: JSON.parse(await blob.text()) as Payload };
}

/** The operator's active connection for this inbox, or a visible blocked error. */
async function activeConnection(
  ctx: ActionCtx,
  operation: "createDraft" | "sendDraft",
  inboxId: string,
  actor: Id<"users">,
) {
  const connection = await ctx.runQuery(internal.operatorGmail.getActiveByAddressInternal, {
    address: gmailAddressOf(inboxId),
  });
  if (!connection) throw gmailReconnectError(operation);
  if (connection.ownerUserId !== actor) {
    throw new ResendInboxError("blocked", operation, "Gmail account does not belong to this sender", {
      code: "gmail_owner_mismatch",
    });
  }
  return connection;
}

export async function createGmailDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  draftParams: GmailCreateDraftParams,
): Promise<ResendInboxResult<{ id: string }>> {
  const operation = "createDraft";
  const testModeRecipient = await getTestModeRecipient(ctx, actor);
  const params: GmailCreateDraftParams = testModeRecipient
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
  const invalid = (message: string) =>
    new ResendInboxError("permanent", operation, message, { code: "validation_error" });
  if (!params.idempotencyKey?.trim()) throw invalid("an idempotency key is required");
  if (!params.text && !params.html) throw invalid("text or html is required");
  if (Boolean(params.threadId) !== Boolean(params.replyToEmailId)) {
    throw invalid("threadId and replyToEmailId must be provided together");
  }
  if (params.attachments?.length) validateDraftAttachments(operation, params.attachments);

  const recipients = [...list(params.to), ...list(params.cc), ...list(params.bcc)];
  const policy = evaluateRecipientDeliveryPolicy(recipients, testModeRecipient);
  if (policy.action === "blocked") {
    throw new ResendInboxError("blocked", operation, "restricted email delivery blocked a recipient", {
      code: "restricted_recipient",
    });
  }
  if (policy.action === "capture") {
    logLocalEmailCapture({
      kind: "operator-gmail-draft",
      from: params.inboxId,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments?.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
      })),
    });
    return {
      status: "captured",
      operation,
      captureId: capturedResourceId(operation, params.idempotencyKey),
    };
  }

  const connection = await activeConnection(ctx, operation, params.inboxId, actor);
  const key = `${connection.address}:${params.idempotencyKey}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(params)).digest("hex");
  const existing = await ctx.runQuery(internal.operatorGmailDrafts.getByKeyInternal, { key });
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error("Draft key content mismatch");
    return { status: "ok", data: { id: DRAFT_PREFIX + existing._id }, replayed: true };
  }
  const identity = await ctx.runQuery(internal.operatorInboxes.getTeamIdentityInternal, {
    userId: actor,
  });
  const domain = connection.address.split("@")[1];
  const messageId = `<spot-${createHash("sha256").update(key).digest("hex")}@${domain}>`;
  const payloadId = await ctx.storage.store(
    new Blob(
      [JSON.stringify({ ...params, fromName: operatorFromName(identity.name), messageId })],
      { type: "application/json" },
    ),
  );
  const stored = await ctx.runMutation(internal.operatorGmailDrafts.storeInternal, {
    connectionId: connection._id,
    key,
    fingerprint,
    payloadId,
    messageId,
    recipients,
  });
  return { status: "ok", data: { id: DRAFT_PREFIX + stored.id }, replayed: stored.replayed };
}

const rfcId = (messageId: string) => messageId.replace(/^<|>$/g, "");

/** The messages in the account carrying this RFC Message-ID (read-only). */
async function findByMessageId(gmail: gmail_v1.Gmail, messageId: string) {
  const found = await gmail.users.messages.list({
    userId: "me",
    q: `rfc822msgid:${rfcId(messageId)}`,
    maxResults: 1,
  });
  return found.data.messages?.[0] ?? null;
}

function buildRaw(value: Payload, from: string): Promise<string> {
  const reply = value.replyToEmailId?.startsWith("<") ? value.replyToEmailId : undefined;
  const references = [...new Set([...(value.references ?? []), ...(reply ? [reply] : [])])];
  const node = new MailComposer({
    from: { name: value.fromName, address: from },
    to: list(value.to),
    cc: list(value.cc),
    bcc: list(value.bcc),
    subject: value.subject,
    text: value.text,
    html: value.html,
    messageId: value.messageId,
    ...(reply ? { inReplyTo: reply } : {}),
    ...(references.length ? { references } : {}),
    attachments: value.attachments?.map((file) => ({
      filename: file.filename,
      content: Buffer.from(file.content, "base64"),
      contentType: file.contentType,
    })),
  }).compile();
  // Gmail reads the envelope from the headers, so Bcc must stay in the raw message.
  node.keepBcc = true;
  return new Promise((resolve, reject) =>
    node.build((error, message) =>
      error ? reject(error) : resolve(message.toString("base64url")),
    ),
  );
}

export async function sendGmailDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: SendDraftParams,
): Promise<ResendInboxResult<{ emailId: string }>> {
  const operation = "sendDraft";
  if (getEmailDeliveryMode() === "capture") {
    return {
      status: "captured",
      operation,
      captureId: capturedResourceId(operation, params.idempotencyKey),
    };
  }
  const { draft, value } = await payload(ctx, params.draftId);
  const connection = await activeConnection(ctx, operation, params.inboxId, actor);
  if (connection._id !== draft.connectionId) {
    throw new ResendInboxError("blocked", operation, "Gmail draft binding mismatch", {
      code: "gmail_binding_mismatch",
    });
  }
  const policy = evaluateRecipientDeliveryPolicy(
    draft.recipients,
    await getTestModeRecipient(ctx, actor),
  );
  if (policy.action !== "send") {
    throw new ResendInboxError("blocked", operation, "restricted email delivery blocked a recipient", {
      code: "restricted_recipient",
    });
  }
  // A disconnected or invalid-grant account blocks here, before the draft is claimed.
  const { gmail } = await gmailFor(ctx, connection.address);
  let threadId: string | undefined;
  try {
    const parent = value.replyToEmailId?.startsWith("<") ? value.replyToEmailId : undefined;
    threadId = parent ? ((await findByMessageId(gmail, parent))?.threadId ?? undefined) : undefined;
  } catch (error) {
    throw mapGmailError(operation, error, false);
  }
  const raw = await buildRaw(value, connection.address);

  const claim = await ctx.runMutation(internal.operatorGmailDrafts.claimInternal, { id: draft._id });
  if (claim.status === "sent") {
    return { status: "ok", data: { emailId: draft.messageId }, replayed: true };
  }
  if (claim.status === "blocked") throw gmailReconnectError(operation);
  if (claim.status !== "claimed") {
    throw new ResendInboxError("unknown", operation, "Earlier send is unresolved; it will not be replayed");
  }
  try {
    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, ...(threadId ? { threadId } : {}) },
    });
    await ctx.runMutation(internal.operatorGmailDrafts.finishInternal, {
      id: draft._id,
      status: "sent",
      ...(sent.data.id ? { gmailMessageId: sent.data.id } : {}),
      ...((sent.data.threadId ?? threadId) ? { gmailThreadId: (sent.data.threadId ?? threadId)! } : {}),
    });
    if (connection.sendError)
      await ctx
        .runMutation(internal.operatorGmail.recordSendErrorInternal, { connectionId: connection._id })
        .catch(() => null);
    return { status: "ok", data: { emailId: draft.messageId }, replayed: false };
  } catch (error) {
    const mapped = mapGmailError(operation, error, true);
    if (mapped.outcome === "blocked" || mapped.outcome === "permanent")
      await ctx
        .runMutation(internal.operatorGmail.recordSendErrorInternal, {
          connectionId: connection._id,
          error: mapped.message,
        })
        .catch(() => null);
    await ctx
      .runMutation(internal.operatorGmailDrafts.finishInternal, {
        id: draft._id,
        status: mapped.outcome === "unknown" ? "unknown" : "failed",
        error:
          mapped.outcome === "unknown"
            ? "Gmail send outcome unconfirmed. Check Sent mail; Spot will not replay it."
            : mapped.message,
      })
      .catch(() => null);
    throw mapped;
  }
}

/**
 * Reads the stored draft. A `sending` or `unknown` one is settled only by
 * finding its Message-ID in the account; `messages.send` is accepted as a
 * unit, so a found message proves every recipient was accepted. Absence is
 * never proof (a timed-out send can still complete) and never authorizes a replay.
 */
export async function readGmailDraft(
  ctx: ActionCtx,
  inboxId: string,
  id: string,
): Promise<ResendInboxResult<ResendInboxDraft>> {
  const { draft, value } = await payload(ctx, id);
  if (draft.status === "sending" || draft.status === "unknown") {
    try {
      const { gmail, connection } = await gmailFor(ctx, gmailAddressOf(inboxId));
      if (connection._id !== draft.connectionId) throw new Error("Gmail draft binding mismatch");
      const found = await findByMessageId(gmail, draft.messageId);
      if (found) {
        await ctx.runMutation(internal.operatorGmailDrafts.finishInternal, {
          id: draft._id,
          status: "sent",
          ...(found.id ? { gmailMessageId: found.id } : {}),
          ...(found.threadId ? { gmailThreadId: found.threadId } : {}),
        });
      }
    } catch {
      // Unreadable now: the send stays locked and is read again later.
    }
  }
  const current = await ctx.runQuery(internal.operatorGmailDrafts.getInternal, { id: draft._id });
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

/** Gmail replies are sent from reviewed drafts; the Resend-derived reply path does not apply. */
export function replyToGmailThreadEmail(): never {
  throw new ResendInboxError(
    "permanent",
    "replyToThreadEmail",
    "Gmail replies are sent from a reviewed draft",
    { code: "gmail_reply_unsupported" },
  );
}

/** Gmail messages are not stored as inbox thread emails; the team inbox holds them. */
export function getGmailThreadEmail(): never {
  throw new ResendInboxError("permanent", "getThreadEmail", "Message not found in this mailbox", {
    code: "gmail_thread_email_unsupported",
  });
}
