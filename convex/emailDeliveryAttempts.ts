import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  isOperatorEmailDraft,
  pendingEmailDraftFingerprint,
} from "./lib/actionConfirmationFingerprint";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { getEmailDeliveryMode } from "./lib/resend";
import {
  SENDER_CHANGED_REASON,
  checkOperatorSendApproval,
} from "./operatorEmailDrafts";

const sourceValidator = v.union(
  v.literal("pending_email"),
  v.literal("email_subagent"),
  v.literal("policy_delivery"),
  v.literal("inbound_email"),
  v.literal("procurement_packet"),
);

export const start = internalMutation({
  args: {
    orgId: v.id("organizations"),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    source: sourceValidator,
    deliveryMode: v.optional(v.string()),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailDeliveryAttempts", {
      ...args,
      provider: "resend",
      status: "attempting",
      startedAt: dayjs().valueOf(),
    });
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("emailDeliveryAttempts"),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      resendEmailId: args.resendEmailId,
      completedAt: dayjs().valueOf(),
      error: undefined,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("emailDeliveryAttempts"),
    status: v.union(v.literal("failed"), v.literal("blocked")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      error: args.error,
      completedAt: dayjs().valueOf(),
    });
  },
});

// --- Operator inbox sends ----------------------------------------------------
//
// An operator send is claimed in one transaction against the exact approval
// and draft fingerprint, which also locks the draft (`status: "pending"`).
// Stages only move forward. Once `sending` begins the outcome is never
// replayed: an interrupted or unanswered send becomes `unknown`, the draft
// stays locked, and a read-only check of the stored Resend draft decides
// whether it was sent (record it) or verifiably was not (release it).

const OPERATOR_CLAIM_LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_FINGERPRINT = 100;
const UNKNOWN_OUTCOME_REASON =
  "Delivery outcome unknown — Spot is verifying with Resend and will not send this email again until it is known not to have been sent.";

type OperatorStage = NonNullable<Doc<"emailDeliveryAttempts">["operatorStage"]>;

const OPERATOR_STAGE_FROM: Record<OperatorStage, OperatorStage[]> = {
  claimed: [],
  draft_created: ["claimed"],
  sending: ["claimed", "draft_created"],
  sent: ["sending", "unknown"],
  unknown: ["sending"],
  failed: ["claimed", "draft_created", "sending", "unknown"],
};

type OperatorAttempt = Doc<"emailDeliveryAttempts">;

/** The delivery is known not to have left: return the draft to editable. */
async function releaseDraft(ctx: MutationCtx, attempt: OperatorAttempt) {
  if (!attempt.pendingEmailId) return;
  const draft = await ctx.db.get(attempt.pendingEmailId);
  if (draft?.status === "pending") {
    await ctx.db.patch(draft._id, {
      status: "draft",
      sendBlockedReason: undefined,
    });
  }
}

/** The outcome is not known: keep the draft locked and verify read-only soon. */
async function lockUnknown(
  ctx: MutationCtx,
  attempt: OperatorAttempt,
  error: string,
) {
  await ctx.db.patch(attempt._id, {
    operatorStage: "unknown",
    error,
    completedAt: dayjs().valueOf(),
  });
  if (attempt.pendingEmailId) {
    const draft = await ctx.db.get(attempt.pendingEmailId);
    if (draft?.status === "pending") {
      await ctx.db.patch(draft._id, { sendBlockedReason: UNKNOWN_OUTCOME_REASON });
    }
  }
  await ctx.scheduler.runAfter(
    0,
    internal.actions.sendPendingEmail.reconcileOperatorSend,
    { attemptId: attempt._id, round: 0 },
  );
}

export const getOperatorAttemptInternal = internalQuery({
  args: { attemptId: v.id("emailDeliveryAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    return attempt?.source === "operator_inbox" ? attempt : null;
  },
});

export const claimOperatorInboxSendInternal = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    confirmationId: v.id("operatorAgentConfirmations"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.pendingEmailId);
    if (!draft || !isOperatorEmailDraft(draft)) {
      return { kind: "rejected", reason: "This is not an operator draft." } as const;
    }
    if (draft.transport !== "operator_inbox" || !draft.senderUserId) {
      return { kind: "rejected", reason: SENDER_CHANGED_REASON } as const;
    }
    const senderUserId = draft.senderUserId;
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    const now = dayjs().valueOf();
    const attempts = await ctx.db
      .query("emailDeliveryAttempts")
      .withIndex("by_pendingEmailId_and_draftFingerprint", (q) =>
        q.eq("pendingEmailId", draft._id).eq("draftFingerprint", fingerprint),
      )
      .order("desc")
      .take(MAX_ATTEMPTS_PER_FINGERPRINT + 1);
    // Past the cap an earlier sent or unknown attempt could be out of view.
    if (attempts.length > MAX_ATTEMPTS_PER_FINGERPRINT) {
      return {
        kind: "rejected",
        reason:
          "This exact email has too many delivery attempts. Edit it to make it a new email.",
      } as const;
    }

    let status = draft.status;
    for (const attempt of attempts) {
      if (attempt.source !== "operator_inbox") continue;
      const stage = attempt.operatorStage;
      if (stage === "sent" && attempt.resendEmailId) {
        return status === "sent"
          ? ({
              kind: "sent",
              emailId: attempt.resendEmailId,
              teamEmailThreadId: draft.teamEmailThreadId,
            } as const)
          : ({
              kind: "finalize",
              attemptId: attempt._id,
              emailId: attempt.resendEmailId,
            } as const);
      }
      if (stage === "unknown") {
        return {
          kind: "unknown",
          attemptId: attempt._id,
          reason:
            "A previous send of this exact email has an unknown outcome. It stays locked until Resend confirms whether it was sent.",
        } as const;
      }
      if (stage === "sending" || stage === "claimed" || stage === "draft_created") {
        if (now - attempt.startedAt < OPERATOR_CLAIM_LEASE_MS) {
          return { kind: "in_progress" } as const;
        }
        if (stage === "sending") {
          await lockUnknown(ctx, attempt, "Send did not finish; outcome unknown.");
          return {
            kind: "unknown",
            attemptId: attempt._id,
            reason:
              "A previous send of this exact email did not finish and its outcome is unknown. It stays locked until Resend confirms whether it was sent.",
          } as const;
        }
        // Expired before any send began: nothing left, so reclaim it.
        await ctx.db.patch(attempt._id, {
          operatorStage: "failed",
          status: "failed",
          error: "Claim expired before sending.",
          completedAt: now,
        });
        if (status === "pending") {
          await ctx.db.patch(draft._id, {
            status: "draft",
            sendBlockedReason: undefined,
          });
          status = "draft";
        }
      }
    }

    if (status !== "draft") {
      return { kind: "rejected", reason: "Only a current draft can be sent." } as const;
    }
    const approval = await checkOperatorSendApproval(ctx, args);
    if (!approval.approved) {
      return { kind: "rejected", reason: approval.reason } as const;
    }
    await assertNoOperatorImpersonation(ctx, senderUserId);

    const attemptId = await ctx.db.insert("emailDeliveryAttempts", {
      orgId: draft.orgId,
      senderUserId,
      draftFingerprint: fingerprint,
      operatorConfirmationId: args.confirmationId,
      pendingEmailId: draft._id,
      source: "operator_inbox",
      provider: "resend",
      deliveryMode: getEmailDeliveryMode(),
      status: "attempting",
      operatorStage: "claimed",
      recipientEmail: draft.recipientEmail,
      ccAddresses: draft.ccAddresses,
      bccAddresses: draft.bccAddresses,
      subject: draft.subject,
      startedAt: now,
    });
    await ctx.db.patch(draft._id, {
      status: "pending",
      sendBlockedReason: undefined,
    });
    // Safety net: settle the attempt if this action dies before finishing.
    await ctx.scheduler.runAfter(
      OPERATOR_CLAIM_LEASE_MS + 60_000,
      internal.actions.sendPendingEmail.reconcileOperatorSend,
      { attemptId, round: 0 },
    );
    return {
      kind: "claimed",
      attemptId,
      senderUserId,
      // The full fingerprint keeps a key from ever matching an earlier, different email.
      keyId: `${draft._id}:${fingerprint}`,
    } as const;
  },
});

/**
 * The last gate before Resend is asked to send. Claim-time checks are stale
 * after inbox, attachment and draft I/O, so everything is checked again in the
 * same transaction that advances the attempt to `sending`: the signer is still
 * an active operator not impersonating, the confirming run is still theirs and
 * live, the exact approval and fingerprint still hold, and the sender
 * identity, Always CC snapshot and link targets are unchanged.
 */
export const beginOperatorInboxSendingInternal = internalMutation({
  args: { attemptId: v.id("emailDeliveryAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    const refuse = (reason: string) => ({ ok: false, reason }) as const;
    if (
      !attempt ||
      attempt.source !== "operator_inbox" ||
      !attempt.pendingEmailId ||
      !attempt.operatorConfirmationId ||
      !attempt.senderUserId ||
      (attempt.operatorStage !== "claimed" &&
        attempt.operatorStage !== "draft_created")
    ) {
      return refuse("The send is no longer current.");
    }
    if (dayjs().valueOf() - attempt.startedAt >= OPERATOR_CLAIM_LEASE_MS) {
      return refuse("The send took too long to prepare; try again.");
    }
    const draft = await ctx.db.get(attempt.pendingEmailId);
    if (
      !draft ||
      draft.status !== "pending" ||
      draft.senderUserId !== attempt.senderUserId ||
      (await pendingEmailDraftFingerprint(draft)) !== attempt.draftFingerprint
    ) {
      return refuse("The draft changed while sending was being prepared.");
    }
    const approval = await checkOperatorSendApproval(ctx, {
      confirmationId: attempt.operatorConfirmationId,
      pendingEmailId: draft._id,
    });
    if (!approval.approved) return refuse(approval.reason);
    try {
      await assertNoOperatorImpersonation(ctx, attempt.senderUserId);
    } catch {
      return refuse("Email cannot be sent while impersonating a client.");
    }
    const confirmation = await ctx.db.get(attempt.operatorConfirmationId);
    const run =
      confirmation?.payload.kind === "operator_tool_action"
        ? await ctx.db.get(confirmation.payload.runId)
        : null;
    if (
      !run ||
      run.operatorUserId !== attempt.senderUserId ||
      run.status !== "running" ||
      run.cancellationRequestedAt
    ) {
      return refuse("The approving operator run is no longer active.");
    }
    await ctx.db.patch(attempt._id, { operatorStage: "sending" });
    return { ok: true } as const;
  },
});

/**
 * Settles an attempt whose action may have died: an expired pre-send claim is
 * released; an expired `sending` becomes `unknown` (locked, verified read-only).
 */
export const settleOperatorAttemptInternal = internalMutation({
  args: { attemptId: v.id("emailDeliveryAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.source !== "operator_inbox" || !attempt.operatorStage) {
      return "final" as const;
    }
    const stage = attempt.operatorStage;
    if (stage === "sent" || stage === "unknown" || stage === "failed") {
      return stage;
    }
    if (dayjs().valueOf() - attempt.startedAt < OPERATOR_CLAIM_LEASE_MS) {
      return "active" as const;
    }
    if (stage === "sending") {
      await lockUnknown(ctx, attempt, "Send did not finish; outcome unknown.");
      return "unknown" as const;
    }
    await ctx.db.patch(attempt._id, {
      operatorStage: "failed",
      status: "failed",
      error: "Claim expired before sending.",
      completedAt: dayjs().valueOf(),
    });
    await releaseDraft(ctx, attempt);
    return "failed" as const;
  },
});

/** Moves a claimed attempt forward; a failed one returns its draft to editable, an unknown one stays locked. */
export const advanceOperatorInboxAttemptInternal = internalMutation({
  args: {
    attemptId: v.id("emailDeliveryAttempts"),
    stage: v.union(
      v.literal("draft_created"),
      v.literal("sent"),
      v.literal("unknown"),
      v.literal("failed"),
    ),
    inboxId: v.optional(v.string()),
    draftId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    error: v.optional(v.string()),
    blocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (
      !attempt ||
      attempt.source !== "operator_inbox" ||
      !attempt.operatorStage ||
      !OPERATOR_STAGE_FROM[args.stage].includes(attempt.operatorStage)
    ) {
      throw new Error("Operator send attempt cannot move to that stage.");
    }
    if (args.stage === "unknown") {
      await lockUnknown(ctx, attempt, args.error ?? "Outcome unknown.");
      return null;
    }
    await ctx.db.patch(attempt._id, {
      operatorStage: args.stage,
      ...(args.inboxId ? { inboxId: args.inboxId } : {}),
      ...(args.draftId ? { draftId: args.draftId } : {}),
      ...(args.resendEmailId ? { resendEmailId: args.resendEmailId } : {}),
      ...(args.stage === "sent"
        ? { status: "sent" as const, error: undefined }
        : args.stage === "failed"
          ? {
              status: args.blocked ? ("blocked" as const) : ("failed" as const),
              error: args.error,
            }
          : {}),
      ...(args.stage === "sent" || args.stage === "failed"
        ? { completedAt: dayjs().valueOf() }
        : {}),
    });
    if (args.stage === "failed") await releaseDraft(ctx, attempt);
    return null;
  },
});
