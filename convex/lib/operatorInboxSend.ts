"use node";

import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { toInboxDraftAttachments } from "./emailDelivery";
import { extractEmailAddress } from "./emailAddress";
import { ensureOperatorInbox } from "./operatorInbox";
import {
  capturedResourceId,
  createDraft,
  isResendInboxError,
  sendDraft,
  type ResendInboxError,
} from "./resendInbox";

/**
 * Sends an approved operator draft from the signing operator's own Resend
 * inbox. The claim (`claimOperatorInboxSendInternal`) is the only gate: it
 * rechecks the exact approval, the approver being the signer, and the draft
 * fingerprint, and records every stage so nothing is replayed after an
 * unknown outcome. Capture mode makes no Resend call but still records the
 * attempt and the local team-inbox message.
 */

const MAX_TRANSIENT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 5_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries only failures Resend reports as not accepted (or an idempotent create that may have landed). */
async function withBoundedRetry<T>(
  run: () => Promise<T>,
  options: { retryUnknown: boolean },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        isResendInboxError(error) &&
        (error.outcome === "transient" ||
          (options.retryUnknown && error.outcome === "unknown"));
      if (!retryable || attempt >= MAX_TRANSIENT_RETRIES) throw error;
      await wait(
        Math.min(
          (error as ResendInboxError).retryAfterMs ?? 1_000 * (attempt + 1),
          MAX_RETRY_DELAY_MS,
        ),
      );
    }
  }
}

function describeFailure(error: unknown): string {
  if (isResendInboxError(error)) {
    return error.outcome === "blocked"
      ? "Restricted email delivery blocked a recipient of this email."
      : `Delivery failed (${error.operation}: ${error.outcome}${error.code ? ` ${error.code}` : ""}).`;
  }
  return error instanceof Error ? error.message : "Delivery failed.";
}

async function recordSent(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    attemptId: Id<"emailDeliveryAttempts">;
    emailId: string;
  },
) {
  try {
    await ctx.runMutation(internal.pendingEmails.recordOperatorInboxSentInternal, {
      id: args.pendingEmailId,
      attemptId: args.attemptId,
      emailId: args.emailId,
    });
  } catch {
    // The email left; a retry of the send finishes this record and never resends.
    throw new Error(
      "The email was sent, but recording it in the team inbox failed. Send it again to finish recording; it will not be delivered twice.",
    );
  }
}

export async function sendOperatorInboxDraft(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    confirmationId: Id<"operatorAgentConfirmations">;
  },
): Promise<{ recipientEmail: string }> {
  const claim = await ctx.runMutation(
    internal.emailDeliveryAttempts.claimOperatorInboxSendInternal,
    args,
  );
  const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id: args.pendingEmailId,
  });
  if (!pending) throw new Error("Draft not found.");
  const result = { recipientEmail: pending.recipientEmail };

  switch (claim.kind) {
    case "rejected":
    case "unknown":
      throw new Error(claim.reason);
    case "in_progress":
      throw new Error("This email is already being sent.");
    case "sent":
      return result;
    case "finalize":
      await recordSent(ctx, {
        pendingEmailId: args.pendingEmailId,
        attemptId: claim.attemptId,
        emailId: claim.emailId,
      });
      return result;
    case "claimed":
      break;
  }

  const { attemptId, keyId } = claim;
  const advance = (
    update: Omit<
      FunctionArgs<
        typeof internal.emailDeliveryAttempts.advanceOperatorInboxAttemptInternal
      >,
      "attemptId"
    >,
  ) =>
    ctx.runMutation(
      internal.emailDeliveryAttempts.advanceOperatorInboxAttemptInternal,
      { attemptId, ...update },
    );
  const fail = async (error: unknown): Promise<never> => {
    await advance({
      stage: "failed",
      error: describeFailure(error),
      blocked: isResendInboxError(error) && error.outcome === "blocked",
    });
    throw new Error(describeFailure(error));
  };

  let inboxId: string;
  let draftId: string;
  try {
    const ensured = await ensureOperatorInbox(ctx, claim.senderUserId);
    if (
      extractEmailAddress(pending.fromHeader) !==
      ensured.inbox.emailAddress.toLowerCase()
    ) {
      throw new Error("Sender changed — update draft to re-sign.");
    }
    inboxId = ensured.inbox.inboxId;
    const reply = await ctx.runQuery(
      internal.operatorEmailDrafts.getReplyTargetInternal,
      { pendingEmailId: args.pendingEmailId, inboxId },
    );
    const attachments = pending.attachments?.length
      ? await toInboxDraftAttachments(ctx, pending.attachments)
      : undefined;
    const created = await withBoundedRetry(
      () =>
        createDraft({
          inboxId,
          to: pending.recipientEmail,
          ...(pending.ccAddresses?.length ? { cc: pending.ccAddresses } : {}),
          ...(pending.bccAddresses?.length ? { bcc: pending.bccAddresses } : {}),
          subject: pending.subject,
          text: pending.renderedText ?? pending.emailBody,
          ...(pending.renderedHtml ? { html: pending.renderedHtml } : {}),
          ...(attachments ? { attachments } : {}),
          ...(reply
            ? {
                threadId: reply.resendThreadId,
                replyToEmailId: reply.replyToEmailId,
              }
            : {}),
          idempotencyKey: `opdraft:${keyId}`,
        }),
      { retryUnknown: true },
    );
    draftId =
      created.status === "captured"
        ? capturedResourceId("draft", keyId)
        : created.data.id;
    await advance({ stage: "draft_created", inboxId, draftId });
  } catch (error) {
    return await fail(error);
  }

  await advance({ stage: "sending" });
  let emailId: string;
  try {
    const sent = await withBoundedRetry(
      () =>
        sendDraft({
          inboxId,
          draftId,
          idempotencyKey: `opsend:${keyId}`,
        }),
      { retryUnknown: false },
    );
    emailId =
      sent.status === "captured"
        ? capturedResourceId("email", keyId)
        : sent.data.emailId;
  } catch (error) {
    if (
      isResendInboxError(error) &&
      (error.outcome === "blocked" ||
        error.outcome === "permanent" ||
        error.outcome === "transient")
    ) {
      // Resend did not accept the send: nothing left, and the draft is editable again.
      return await fail(error);
    }
    // No response or a server error on the send itself: it may have gone out.
    await advance({ stage: "unknown", error: describeFailure(error) });
    throw new Error(
      "Delivery outcome unknown — check the team inbox before sending this email again.",
    );
  }

  try {
    await advance({ stage: "sent", resendEmailId: emailId });
  } catch {
    throw new Error(
      "The email was sent, but its delivery could not be recorded. Check the team inbox before sending again.",
    );
  }
  await recordSent(ctx, {
    pendingEmailId: args.pendingEmailId,
    attemptId,
    emailId,
  });
  return result;
}
