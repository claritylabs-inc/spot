"use node";

import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { toInboxDraftAttachments } from "./emailDelivery";
import { extractEmailAddress } from "./emailAddress";
import { ensureOperatorInbox } from "./operatorInbox";
import { isTeamEmailError } from "./teamEmail";
import { teamReplyError, teamReplyErrorMessage } from "./teamEmailReply";
import {
  capturedResourceId,
  createDraft,
  getDraft,
  isCapturedResourceId,
  isResendInboxError,
  sendDraft,
  type ResendInboxError,
} from "./mailboxTransport";

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

const FINALIZING_REASON =
  "Email delivered; recording it in the team inbox is being retried automatically. It will not be sent again.";
const UNVERIFIED_REASON =
  "Delivery status could not be verified. Check the team inbox; this email stays locked and is never resent automatically.";
const FINALIZE_STUCK_REASON =
  "Email delivered, but recording it in the team inbox needs manual reconciliation. It will not be sent again.";

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
        error.code !== "mailbox_throttled" &&
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

/** What the person sees: only text written for them, never a provider body or internal message. */
function userMessage(error: unknown): string {
  if (isResendInboxError(error)) {
    if (error.code === "mailbox_throttled") {
      const minutes = Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 60000));
      return `This mailbox is pacing its sends. Your draft is saved. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
    if (error.code === "google_sending_retired") return "Google sending has been retired. Review this message using your Resend team address.";
    return error.outcome === "blocked"
      ? "Restricted email delivery blocked a recipient of this email."
      : "Delivery failed. Review the reply and try again.";
  }
  return (
    teamReplyErrorMessage(error) ??
    (isTeamEmailError(error) ? error.message : "The reply could not be sent.")
  );
}

/** The audit text stored on the attempt. */
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
  throw teamReplyError(
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
  } else {
    await ctx.runMutation(internal.pendingEmails.setOperatorPendingReasonInternal, {
      id: attempt.pendingEmailId,
      reason: FINALIZE_STUCK_REASON,
    });
  }
}

type ReconcileOutcome = "sent" | "released" | "pending";

/**
 * Settles an attempt whose send may have died, using only reads. An expired
 * pre-send claim is released (nothing was asked of Resend). For an unknown
 * outcome the stored Resend draft is read: an email id means it was sent and
 * is recorded. Anything else stays locked, retried a bounded number of times.
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
    const read = await getDraft(ctx, attempt.inboxId, attempt.draftId);
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
    // An unsent stored draft is not proof: a timed-out send can still complete.
    // Only positive evidence that it was sent ends the lock.
    return await retry();
  } catch {
    return await retry();
  }
}

export async function sendOperatorInboxDraft(
  ctx: ActionCtx,
  args: {
    pendingEmailId: Id<"pendingEmails">;
    /** An agent's exact confirmation; absent for a browser reply approved on the draft itself. */
    confirmationId?: Id<"operatorAgentConfirmations">;
  },
): Promise<{ recipientEmail: string }> {
  const claim = await ctx.runMutation(
    internal.emailDeliveryAttempts.claimOperatorInboxSendInternal,
    args,
  );
  const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id: args.pendingEmailId,
  });
  if (!pending) throw teamReplyError("Draft not found.");
  const result = { recipientEmail: pending.recipientEmail };

  switch (claim.kind) {
    case "rejected":
      throw teamReplyError(claim.reason);
    case "unknown": {
      const outcome = await reconcileOperatorAttempt(ctx, {
        attemptId: claim.attemptId,
        round: 0,
      });
      if (outcome === "sent") return result;
      throw teamReplyError(
        outcome === "released"
          ? "The earlier attempt never reached Resend and the draft is editable again. Ask to send it again for a fresh approval."
          : claim.reason,
      );
    }
    case "in_progress":
      throw teamReplyError("This email is already being sent.");
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
    throw teamReplyError(userMessage(error));
  };

  let inboxId: string;
  let draftId: string;
  try {
    const ensured = await ensureOperatorInbox(ctx, claim.senderUserId);
    if (
      extractEmailAddress(pending.fromHeader) !==
      ensured.inbox.emailAddress.toLowerCase()
    ) {
      throw teamReplyError("Sender changed — update draft to re-sign.");
    }
    inboxId = ensured.inbox.inboxId;
    const reply = await ctx.runQuery(
      internal.operatorEmailDrafts.getReplyTargetInternal,
      { pendingEmailId: args.pendingEmailId, inboxId, captured: ensured.captured },
    );
    const attachments = pending.attachments?.length
      ? await toInboxDraftAttachments(ctx, pending.attachments)
      : undefined;
    const created = await withBoundedRetry(
      () =>
        createDraft(ctx, claim.senderUserId, {
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
  if (!begun.ok) return await fail(teamReplyError(begun.reason));
  if (pending.directReplyKey && pending.teamEmailThreadId) {
    // A person is answering: automated follow-ups on this conversation stop now.
    try {
      await ctx.runMutation(
        internal.providerOutreach.stopFollowUpsForOperatorReplyInternal,
        { teamEmailThreadId: pending.teamEmailThreadId },
      );
    } catch (error) {
      return await fail(error);
    }
  }
  let emailId: string;
  try {
    const sent = await withBoundedRetry(
      () =>
        sendDraft(ctx, claim.senderUserId, {
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
    throw teamReplyError(
      "Delivery outcome unknown. The draft stays locked while Spot checks the sending mailbox for evidence it was sent, and it will not be sent again.",
    );
  }

  try {
    await advance({ stage: "sent", resendEmailId: emailId });
  } catch {
    // Remote sent but the stage did not persist: hand it to read-only reconciliation.
    await advance({ stage: "unknown", error: "Sent, but the stage was not saved." }).catch(
      () => null,
    );
    throw teamReplyError(
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
