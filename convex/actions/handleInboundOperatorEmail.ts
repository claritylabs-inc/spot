"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  authenticateOperatorEmail,
  MAX_OPERATOR_EMAIL_RAW_BYTES,
  OperatorEmailAuthenticationError,
} from "../lib/operatorEmailAuthentication";
import {
  fetchReceivedEmailAttachments,
  fetchReceivedEmailRaw,
  ReceivedEmailRejectedError,
} from "../lib/receivingEmail";
import {
  AgentAttachmentLimitError,
  assertAgentAttachmentLimits,
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  normalizeAgentAttachmentFilename,
} from "../lib/agentAttachmentLimits";
import {
  formatInboundEmailForAgent,
  htmlToPlainText,
  parseInboundEmail,
  storedInboundEmailContent,
} from "../lib/inboundEmailParser";
import { getAuthSiteUrl } from "../lib/domains";
import { getAgentDomains, sendResendEmail } from "../lib/resend";
import { extractEmailAddress } from "../lib/emailAddress";
import {
  createDraft,
  getThreadEmail,
  isResendInboxError,
  sendDraft,
} from "../lib/resendInbox";
import { ensureAgentInbox } from "../lib/operatorInbox";
import {
  OPERATOR_EMAIL_ADDRESS,
  OPERATOR_EMAIL_DOMAIN,
  operatorEmailThreadToken,
} from "../lib/operatorEmailAddress";

const MAX_COMMAND_TEXT_CHARS = 18_000;
const MAX_INBOX_ATTACHMENT_FILES = 10;
const RESEND_ID = /^[A-Za-z0-9_-]{1,128}$/;

type CommandFile = {
  filename: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
};

type StoredAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

/**
 * Builds the agent-facing message from an authenticated or best-effort
 * email: current text only (quoted history and forwarded content stay
 * separate and untrusted), bounded text, and bounded attachments.
 */
function composeCommand(input: {
  subject?: string;
  text?: string;
  html?: string;
  files: CommandFile[];
  /** Appended after the body, e.g. attachments that could not be imported. */
  notice?: string;
}) {
  const sourceText = input.text?.trim()
    ? input.text
    : input.html
      ? htmlToPlainText(input.html, input.html.length, true)
      : "";
  const parsed = parseInboundEmail({
    subject: input.subject,
    text: sourceText.slice(0, MAX_COMMAND_TEXT_CHARS),
  });
  const text = formatInboundEmailForAgent(parsed);
  const subject = (input.subject?.trim() || "Email to Spot").slice(0, 200);
  const truncated = sourceText.length > MAX_COMMAND_TEXT_CHARS;
  const body = `${text.slice(0, MAX_COMMAND_TEXT_CHARS).trim()}${truncated ? "\n\n[Full email attached as forwarded-email.txt]" : ""}${input.notice ? `\n\n${input.notice}` : ""}`.trim();
  const files = [...input.files];
  if (truncated) {
    const bytes = Buffer.from(sourceText);
    files.push({
      filename: "forwarded-email.txt",
      contentType: "text/plain",
      size: bytes.length,
      bytes,
    });
  }
  assertAgentAttachmentLimits(files);
  return {
    subject,
    content: `Subject: ${subject}${body ? `\n\n${body}` : ""}`,
    emailContent: {
      ...storedInboundEmailContent(parsed),
      subject,
      currentText: parsed.currentText,
      parseInputTruncated: truncated,
    },
    files,
  };
}

/**
 * Stores the files, runs `accept`, and deletes every stored file that no
 * accepted message references (rejections, duplicates and failures).
 */
async function acceptWithStoredFiles<T>(
  ctx: Pick<ActionCtx, "storage" | "runMutation">,
  files: CommandFile[],
  accept: (attachments: StoredAttachment[]) => Promise<T>,
  referenced: (result: T) => boolean,
): Promise<T> {
  const attachments: StoredAttachment[] = [];
  try {
    for (const file of files) {
      const fileId = await ctx.storage.store(
        new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
      );
      attachments.push({
        fileId,
        filename: file.filename,
        contentType: file.contentType,
        size: file.size,
      });
    }
    const result = await accept(attachments);
    if (referenced(result)) return result;
    await ctx.runMutation(
      internal.operatorAgent.deleteUnreferencedAttachmentsInternal,
      { fileIds: attachments.map((file) => file.fileId) },
    );
    return result;
  } catch (error) {
    await ctx.runMutation(
      internal.operatorAgent.deleteUnreferencedAttachmentsInternal,
      { fileIds: attachments.map((file) => file.fileId) },
    );
    throw error;
  }
}

/** Legacy `operator(+thread)@agent…` mail, delivered through `/resend-inbound`. */
export const processInbound = internalAction({
  args: { emailId: v.string() },
  handler: async (ctx, { emailId }) => {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(emailId))
      throw new Error("Invalid received email ID");
    const received = await fetchReceivedEmailRaw(
      emailId,
      MAX_OPERATOR_EMAIL_RAW_BYTES,
    );
    if (received.status === "unavailable")
      throw new Error("Original operator email is unavailable");
    const mail = await authenticateOperatorEmail(received.raw);
    const sender = mail.from!.value[0].address!.toLowerCase();
    const identity = await ctx.runQuery(
      internal.operatorEmail.resolveIdentity,
      { email: sender },
    );
    if (!identity) return;
    const agentDomains = getAgentDomains();
    const recipients = [mail.to, mail.cc].flatMap((value) =>
      (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) =>
        group.value.map((address) => address.address?.toLowerCase() ?? ""),
      ),
    );
    const tokens = [
      ...new Set(
        recipients.flatMap((address) => {
          const token = operatorEmailThreadToken(address, agentDomains);
          return token ? [token] : [];
        }),
      ),
    ];
    if (tokens.length > 1)
      throw new Error("Email addresses more than one operator thread");
    const command = composeCommand({
      subject: mail.subject,
      text: mail.text,
      html: mail.html || undefined,
      files: mail.attachments.map((attachment) => ({
        filename: normalizeAgentAttachmentFilename(
          attachment.filename || "attachment",
        ),
        contentType: attachment.contentType,
        size: attachment.content.length,
        bytes: attachment.content,
      })),
    });
    await acceptWithStoredFiles(
      ctx,
      command.files,
      (attachments) =>
        ctx.runMutation(internal.operatorEmail.accept, {
          providerId: emailId,
          messageId: mail.messageId!,
          sender,
          subject: command.subject,
          content: command.content,
          emailContent: command.emailContent,
          threadToken: tokens[0],
          attachments,
          // Legacy mail is DKIM-authenticated above before it reaches here.
          emailReadOnly: false,
        }),
      (result) => !result.duplicate,
    );
  },
});

export type InboxCommandIgnoredReason =
  | "invalid_ids"
  | "unknown_inbox"
  | "inbox_retired"
  | "captured"
  | "unbound_email"
  | "not_inbound"
  | "mismatched_email"
  | "raw_rejected"
  | "authentication_failed"
  | "unauthorized_sender"
  | "thread_unavailable"
  | "ambiguous_thread"
  | "thread_busy"
  | "attachment_limits";

export type InboxCommandResult =
  | { status: "accepted" | "duplicate"; receiptId: Id<"operatorEmailReceipts"> }
  | { status: "ignored"; reason: InboxCommandIgnoredReason };

function ignored(
  reason: InboxCommandIgnoredReason,
  context: { inboxId: string; emailId: string },
): InboxCommandResult {
  console.warn(
    `Operator command email ignored (${reason}) inbox=${context.inboxId} email=${context.emailId}`,
  );
  return { status: "ignored", reason };
}

const bareMessageId = (value: string | null | undefined) =>
  value?.trim().replace(/^<|>$/g, "") || null;

/**
 * Entry point for mail received by the shared command inbox (`agent@team…`).
 * The manager's inbox webhook dispatcher calls it with
 * `internal.actions.handleInboundOperatorEmail.processInboxCommand` after the
 * shared inbox Svix verification, passing the exact ids from the
 * `inbox.email.received` event: `{ inboxId, resendThreadId, emailId }`.
 *
 * Returns `accepted`, `duplicate` (already received, including via the legacy
 * transport), or `ignored` with a reason; ignored mail is permanent and must
 * not be retried. It throws for anything retryable (network, Resend errors,
 * DKIM DNS temperrors), and never downgrades those to read-only.
 *
 * Authentication: the original MIME is fetched through the Receiving API and
 * checked by `authenticateOperatorEmail` (aligned full-body DKIM, signed
 * routing headers naming this exact inbox). Only when Resend confirms there is
 * no raw MIME is the operator resolved from the exact normalized From, and the
 * run is marked `emailReadOnly` so it cannot write. Explicit DKIM failure,
 * malformed or oversized MIME, mismatched ids or an unauthorized sender are
 * ignored, never treated as read-only.
 */
export const processInboxCommand = internalAction({
  args: {
    inboxId: v.string(),
    resendThreadId: v.string(),
    emailId: v.string(),
  },
  handler: async (ctx, args): Promise<InboxCommandResult> => {
    const { inboxId, resendThreadId, emailId } = args;
    const context = { inboxId, emailId };
    if (![inboxId, resendThreadId, emailId].every((id) => RESEND_ID.test(id))) {
      return ignored("invalid_ids", context);
    }
    const inbox = await ctx.runQuery(internal.operatorEmail.getCommandInbox, {
      inboxId,
      resendThreadId,
    });
    if (!inbox) return ignored("unknown_inbox", context);
    if (inbox.retired && !inbox.threadMapped) {
      return ignored("inbox_retired", context);
    }

    let original;
    try {
      original = await getThreadEmail(inboxId, resendThreadId, emailId);
    } catch (error) {
      // The inbox/thread/email triple does not exist together.
      if (isResendInboxError(error) && error.status === 404) {
        return ignored("unbound_email", context);
      }
      throw error;
    }
    if (original.status !== "ok") return ignored("captured", context);
    const email = original.data;
    if (email.id !== emailId) return ignored("mismatched_email", context);
    if (email.direction !== "inbound") return ignored("not_inbound", context);

    let received;
    try {
      received = await fetchReceivedEmailRaw(
        emailId,
        MAX_OPERATOR_EMAIL_RAW_BYTES,
      );
    } catch (error) {
      if (error instanceof ReceivedEmailRejectedError) {
        return ignored("raw_rejected", context);
      }
      throw error;
    }

    let sender: string;
    let messageId: string;
    let emailReadOnly: boolean;
    let command: ReturnType<typeof composeCommand>;
    try {
      if (received.status === "available") {
        let mail;
        try {
          mail = await authenticateOperatorEmail(received.raw, {
            commandInboxAddress: inbox.emailAddress,
          });
        } catch (error) {
          if (
            error instanceof OperatorEmailAuthenticationError &&
            error.kind === "invalid"
          ) {
            return ignored("authentication_failed", context);
          }
          throw error;
        }
        sender = mail.from!.value[0].address!.toLowerCase();
        // The signed message must be the one the inbox reported.
        const reportedMessageId = bareMessageId(email.messageId);
        if (
          extractEmailAddress(email.from) !== sender ||
          (reportedMessageId !== null &&
            reportedMessageId !== bareMessageId(mail.messageId))
        ) {
          return ignored("mismatched_email", context);
        }
        messageId = mail.messageId!;
        emailReadOnly = false;
        const identity = await ctx.runQuery(
          internal.operatorEmail.resolveIdentity,
          { email: sender },
        );
        if (!identity) return ignored("unauthorized_sender", context);
        command = composeCommand({
          subject: mail.subject,
          text: mail.text,
          html: mail.html || undefined,
          files: mail.attachments.map((attachment, index) => ({
            filename: safeFilename(attachment.filename, index),
            contentType: attachment.contentType,
            size: attachment.content.length,
            bytes: attachment.content,
          })),
        });
      } else {
        // Resend confirmed there is no raw MIME, so nothing proves the sender.
        const from = extractEmailAddress(email.from);
        const identity = from
          ? await ctx.runQuery(internal.operatorEmail.resolveIdentity, {
              email: from,
            })
          : null;
        if (!from || !identity) return ignored("unauthorized_sender", context);
        sender = from;
        // The unauthenticated Message-ID header is attacker-chosen, so it must
        // never feed receipt dedupe: key it to the provider email id instead.
        messageId = `<resend-inbox-${emailId}@${OPERATOR_EMAIL_DOMAIN}>`;
        emailReadOnly = true;
        const attachments = await fetchReceivedEmailAttachments(
          emailId,
          email.attachments,
          {
            maxFiles: MAX_INBOX_ATTACHMENT_FILES,
            maxFileBytes: MAX_AGENT_ATTACHMENT_BYTES,
            maxTotalBytes: MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
          },
        );
        command = composeCommand({
          subject: email.subject ?? undefined,
          text: email.text ?? undefined,
          html: email.html ?? undefined,
          files: attachments.files.map((file, index) => ({
            ...file,
            filename: safeFilename(file.filename, index),
          })),
          notice: attachments.omitted.length
            ? `[Attachments not imported: ${attachments.omitted
                .map(({ filename, reason }) => `${filename.slice(0, 100)} (${reason})`)
                .join("; ")}${attachments.omittedMore ? `; and ${attachments.omittedMore} more` : ""}]`
            : undefined,
        });
      }
    } catch (error) {
      if (error instanceof AgentAttachmentLimitError) {
        return ignored("attachment_limits", context);
      }
      throw error;
    }

    const result = await acceptWithStoredFiles(
      ctx,
      command.files,
      (attachments) =>
        ctx.runMutation(internal.operatorEmail.acceptInboxCommand, {
          inbox: { inboxId, resendThreadId, emailId },
          messageId,
          sender,
          subject: command.subject,
          content: command.content,
          emailContent: command.emailContent,
          attachments,
          emailReadOnly,
        }),
      (outcome) => outcome.status === "accepted",
    );
    if (result.status === "rejected") return ignored(result.reason, context);
    return result;
  },
});

/** A printable attachment name, or a neutral one when the sender's is unusable. */
function safeFilename(filename: string | undefined | null, index: number) {
  try {
    return normalizeAgentAttachmentFilename(filename || "attachment");
  } catch {
    return `attachment-${index + 1}`;
  }
}

/**
 * Manager-run setup (never called automatically): provisions the shared
 * command inbox `agent@<TEAM_EMAIL_DOMAIN>` and records it as `kind: "agent"`.
 * In capture mode it makes no network call, persists nothing, and returns
 * placeholder ids with `captured: true`.
 */
export const provisionAgentInbox = internalAction({
  args: {},
  handler: async (ctx) => {
    const { inbox, captured } = await ensureAgentInbox(ctx);
    return {
      inboxId: inbox.inboxId,
      emailAddress: inbox.emailAddress,
      fromName: inbox.fromName,
      captured,
    };
  },
});

const READ_ONLY_NOTICE =
  "This email could not be authenticated, so I ran it read-only: I can read and answer, but I did not save, send, or change anything. To make changes, send it again from your operator mailbox or use operator chat.";

/**
 * Replies from the agent inbox inside the Resend thread the command arrived
 * on, always as a reply draft with an explicit To (`to`, the resolved
 * operator's own login address). Reply-To, reply-all and the message's CC are
 * never used, and there is a single strategy, so a retry cannot take a
 * different endpoint. Keys are stable per delivery: a replay of a request
 * that already succeeded returns the original draft or send. The one case a
 * replay differs is `to` changing between attempts (the operator's login
 * email changed); Resend then rejects the reused key as a payload mismatch
 * and the delivery fails closed instead of sending a second copy.
 */
async function sendCommandReply(
  ctx: ActionCtx,
  args: {
    inbox: { inboxId: string };
    threadId: string;
    emailId: string;
    to: string;
    subject: string;
    text: string;
    key: string;
  },
) {
  const draft = await createDraft(ctx, null, {
    inboxId: args.inbox.inboxId,
    to: args.to,
    subject: args.subject,
    text: args.text,
    threadId: args.threadId,
    replyToEmailId: args.emailId,
    idempotencyKey: `${args.key}:draft`,
  });
  if (draft.status !== "ok") return;
  await sendDraft(ctx, null, {
    inboxId: args.inbox.inboxId,
    draftId: draft.data.id,
    idempotencyKey: `${args.key}:send`,
  });
}

export const deliver = internalAction({
  args: { receiptId: v.id("operatorEmailReceipts") },
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(
      internal.operatorEmail.getDeliveryContext,
      args,
    );
    if (!context) return;
    const { receipt, run, response, confirmation, inbox, operatorEmail } =
      context;
    if (run.status === "queued" || run.status === "running") {
      await ctx.scheduler.runAfter(
        5_000,
        internal.actions.handleInboundOperatorEmail.deliver,
        args,
      );
      return;
    }
    const waiting = run.status === "waiting_confirmation";
    const phase = waiting
      ? `confirmation:${confirmation?._id ?? run._id}`
      : `terminal:${run.status}`;

    const threadUrl = `${getAuthSiteUrl()}/operator/threads/${receipt.threadId}`;
    const content =
      run.status === "failed" || run.status === "cancelled"
        ? `This task ${run.status}. Open the operator thread for details.`
        : response?.content || "Your operator task has an update.";
    const approval = waiting
      ? `\n\nApproval required: ${confirmation?.payload.summary ?? "Review the proposed action"}\nApprove or cancel in the operator thread: ${threadUrl}`
      : "";
    const restriction = receipt.emailReadOnly ? `${READ_ONLY_NOTICE}\n\n` : "";
    const text = `${restriction}${content}${approval}\n\n${response?.attachments?.length ? "Files and " : ""}Conversation: ${threadUrl}`;
    const command =
      inbox && receipt.resendThreadId && receipt.resendInboxEmailId
        ? { inbox, threadId: receipt.resendThreadId, emailId: receipt.resendInboxEmailId }
        : null;
    // A command receipt that lost its inbox mapping must not fall back to the legacy sender.
    if (receipt.inboxId && !command) return;
    const claim = await ctx.runMutation(internal.operatorEmail.claimDelivery, {
      receiptId: receipt._id,
      phase,
      text,
    });
    if (claim) {
      const subject = /^re:/i.test(receipt.subject)
        ? receipt.subject
        : `Re: ${receipt.subject}`;
      try {
        if (command) {
          await sendCommandReply(ctx, {
            inbox: command.inbox,
            threadId: command.threadId,
            emailId: command.emailId,
            to: operatorEmail,
            subject,
            text: claim.text,
            key: `operator-email:${claim.id}`,
          });
        }
        const sent = command
          ? { ok: true }
          : await sendResendEmail(
              ctx,
              null,
              {
                from: `Spot Operator <${OPERATOR_EMAIL_ADDRESS}>`,
                to: receipt.sender,
                reply_to: `operator+${receipt.threadId}@${OPERATOR_EMAIL_DOMAIN}`,
                subject,
                text: claim.text,
                headers: {
                  "Message-ID": claim.messageId,
                  "In-Reply-To": receipt.messageId,
                  References: receipt.messageId,
                },
              },
              { retries: 2, idempotencyKey: `operator-email:${claim.id}` },
            );
        await ctx.runMutation(internal.operatorEmail.finishDelivery, {
          deliveryId: claim.id,
          attempts: claim.attempts,
          sent: sent.ok,
        });
      } catch (error) {
        await ctx.runMutation(internal.operatorEmail.finishDelivery, {
          deliveryId: claim.id,
          attempts: claim.attempts,
          sent: false,
        });
        console.error("Operator email response delivery failed", error);
      }
    }
    if (waiting && !claim)
      await ctx.scheduler.runAfter(
        60_000,
        internal.actions.handleInboundOperatorEmail.deliver,
        args,
      );
  },
});
