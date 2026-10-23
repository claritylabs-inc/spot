"use node";

import type { FunctionArgs } from "convex/server";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { toInboxDraftAttachments } from "./emailDelivery";
import { extractEmailAddress } from "./emailAddress";
import { ensureOperatorInbox } from "./operatorInbox";
import {
  capturedResourceId,
  createDraft,
  getDraft,
  isCapturedResourceId,
  isResendInboxError,
  sendDraft,
  type ResendInboxError,
} from "./resendInbox";

/**
 * Sends an approved operator draft from the signing operator's own Resend
 * inbox. The claim records the attempt against the exact approval and draft
 * fingerprint; `beginOperatorInboxSendingInternal` rechecks everything once
 * more immediately before Resend is asked to send. Every stage is recorded so
 * nothing is replayed after an unknown outcome: that is only resolved by a
 * read-only look at the stored Resend draft. Capture mode makes no Resend call
 * but still records the attempt and the local team-inbox message.
 */

/** Delays between bounded read-only retries of an unknown outcome and of a failed record. */
const RECONCILE_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const FINALIZE_DELAYS_MS = [15_000, 60_000, 300_000, 1_800_000, 7_200_000];
/** An unsent Resend draft only proves "not sent" once an in-flight send would have landed. */
const MIN_AGE_TO_RELEASE_MS = 30_000;

const FINALIZING_REASON =
  "Email delivered; recording it in the team inbox is being retried automatically. It will not be sent again.";
const UNVERIFIED_REASON =
  "Delivery status could not be verified. Check the team inbox; this email stays locked and is never resent automatically.";

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

async function tryRecordSent(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    attemptId: Id<"emailDeliveryAttempts">;
    emailId: string;
  },
): Promise<boolean> {
  try {
    await ctx.runMutation(internal.pendingEmails.recordOperatorInboxSentInternal, {
      id: args.pendingEmailId,
      attemptId: args.attemptId,
      emailId: args.emailId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Records a delivered email. The email already left, so a failed record is
 * retried in the background (never by sending again) and the locked draft
 * says so.
 */
async function recordSent(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    attemptId: Id<"emailDeliveryAttempts">;
    emailId: string;
  },
) {
  if (await tryRecordSent(ctx, args)) return;
  await ctx
    .runMutation(internal.pendingEmails.setOperatorPendingReasonInternal, {
      id: args.pendingEmailId,
      reason: FINALIZING_REASON,
    })
    .catch(() => null);
  await ctx.scheduler.runAfter(
    FINALIZE_DELAYS_MS[0],
    internal.actions.sendPendingEmail.finalizeOperatorSend,
    { attemptId: args.attemptId, round: 1 },
  );
  throw new Error(
    "The email was sent. Recording it in the team inbox failed and is being retried automatically; it will not be sent again.",
  );
}

/** Background finish of a delivered email's record. Never sends. */
export async function finalizeOperatorAttempt(
  ctx: ActionCtx,
  args: { attemptId: Id<"emailDeliveryAttempts">; round: number },
) {
  const attempt = await ctx.runQuery(
    internal.emailDeliveryAttempts.getOperatorAttemptInternal,
    { attemptId: args.attemptId },
  );
  if (
    !attempt ||
    attempt.operatorStage !== "sent" ||
    !attempt.pendingEmailId ||
    !attempt.resendEmailId
  ) {
    return;
  }
  if (
    await tryRecordSent(ctx, {
      pendingEmailId: attempt.pendingEmailId,
      attemptId: attempt._id,
      emailId: attempt.resendEmailId,
    })
  ) {
    return;
  }
  const delay = FINALIZE_DELAYS_MS[args.round];
  if (delay !== undefined) {
    await ctx.scheduler.runAfter(
      delay,
      internal.actions.sendPendingEmail.finalizeOperatorSend,
      { attemptId: attempt._id, round: args.round + 1 },
    );
  }
}

type ReconcileOutcome = "sent" | "released" | "pending";

/**
 * Settles an attempt whose send may have died, using only reads. An expired
 * pre-send claim is released. For an unknown outcome the stored Resend draft
 * says whether it was sent (record it) or verifiably was not (release it);
 * anything else stays locked and is retried a bounded number of times.
 */
export async function reconcileOperatorAttempt(
  ctx: ActionCtx,
  args: { attemptId: Id<"emailDeliveryAttempts">; round: number },
): Promise<ReconcileOutcome> {
  const state = await ctx.runMutation(
    internal.emailDeliveryAttempts.settleOperatorAttemptInternal,
    { attemptId: args.attemptId },
  );
  const attempt = await ctx.runQuery(
    internal.emailDeliveryAttempts.getOperatorAttemptInternal,
    { attemptId: args.attemptId },
  );
  if (!attempt || !attempt.pendingEmailId) return "pending";
  if (state === "failed") return "released";
  if (state === "active") return "pending";
  if (state === "sent") {
    if (attempt.resendEmailId) {
      await finalizeOperatorAttempt(ctx, { attemptId: attempt._id, round: 0 });
    }
    return "sent";
  }

  const pendingEmailId = attempt.pendingEmailId;
  const retry = async (): Promise<"pending"> => {
    const delay = RECONCILE_DELAYS_MS[args.round];
    if (delay !== undefined) {
      await ctx.scheduler.runAfter(
        delay,
        internal.actions.sendPendingEmail.reconcileOperatorSend,
        { attemptId: attempt._id, round: args.round + 1 },
      );
    } else {
      await ctx.runMutation(internal.pendingEmails.setOperatorPendingReasonInternal, {
        id: pendingEmailId,
        reason: UNVERIFIED_REASON,
      });
    }
    return "pending";
  };
  if (
    !attempt.inboxId ||
    !attempt.draftId ||
    isCapturedResourceId(attempt.inboxId) ||
    isCapturedResourceId(attempt.draftId)
  ) {
    return await retry();
  }
  try {
    const read = await getDraft(attempt.inboxId, attempt.draftId);
    if (read.status !== "ok") return await retry();
    if (read.data.emailId) {
      await ctx.runMutation(
        internal.emailDeliveryAttempts.advanceOperatorInboxAttemptInternal,
        {
          attemptId: attempt._id,
          stage: "sent",
          resendEmailId: read.data.emailId,
        },
      );
      await finalizeOperatorAttempt(ctx, { attemptId: attempt._id, round: 0 });
      return "sent";
    }
    if (dayjs().valueOf() - (attempt.completedAt ?? 0) < MIN_AGE_TO_RELEASE_MS) {
      return await retry();
    }
    // The draft exists and was never sent: it is safe to offer it for editing or a fresh send.
    await ctx.runMutation(
      internal.emailDeliveryAttempts.advanceOperatorInboxAttemptInternal,
      {
        attemptId: attempt._id,
        stage: "failed",
        error: "Verified with Resend: the email was not sent.",
      },
    );
    return "released";
  } catch {
    return await retry();
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
      throw new Error(claim.reason);
    case "unknown": {
      const outcome = await reconcileOperatorAttempt(ctx, {
        attemptId: claim.attemptId,
        round: 0,
      });
      if (outcome === "sent") return result;
      throw new Error(
        outcome === "released"
          ? "The earlier send was verified as not sent and the draft is editable again. Ask to send it again for a fresh approval."
          : claim.reason,
      );
    }
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

  const begun = await ctx.runMutation(
    internal.emailDeliveryAttempts.beginOperatorInboxSendingInternal,
    { attemptId },
  );
  if (!begun.ok) return await fail(new Error(begun.reason));
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
      "Delivery outcome unknown. The draft stays locked while Spot verifies with Resend; it will not be sent again unless it is confirmed not sent.",
    );
  }

  try {
    await advance({ stage: "sent", resendEmailId: emailId });
  } catch {
    // Remote sent but the stage did not persist: hand it to read-only reconciliation.
    await advance({ stage: "unknown", error: "Sent, but the stage was not saved." }).catch(
      () => null,
    );
    throw new Error(
      "The email was sent, but its delivery could not be recorded. Spot is verifying it and will not send it again.",
    );
  }
  await recordSent(ctx, {
    pendingEmailId: args.pendingEmailId,
    attemptId,
    emailId,
  });
  return result;
}
