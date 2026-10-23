import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
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
// replayed automatically: an interrupted send becomes `unknown` and needs a
// person to check the inbox.

const OPERATOR_CLAIM_LEASE_MS = 15 * 60 * 1000;
const UNKNOWN_OUTCOME_REASON =
  "Delivery outcome unknown — check the team inbox before sending this email again. Any edit makes it a new email.";

type OperatorStage = NonNullable<Doc<"emailDeliveryAttempts">["operatorStage"]>;

const OPERATOR_STAGE_FROM: Record<OperatorStage, OperatorStage[]> = {
  claimed: [],
  draft_created: ["claimed"],
  sending: ["claimed", "draft_created"],
  sent: ["sending"],
  unknown: ["sending"],
  failed: ["claimed", "draft_created", "sending"],
};

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
    const attempts = (
      await ctx.db
        .query("emailDeliveryAttempts")
        .withIndex("pending", (q) => q.eq("pendingEmailId", draft._id))
        .order("desc")
        .take(50)
    ).filter(
      (attempt) =>
        attempt.source === "operator_inbox" &&
        attempt.draftFingerprint === fingerprint,
    );

    // Attempts for this exact content decide what may happen next. A new attempt
    // never reuses a stored inbox draft: the idempotent create call returns it.
    for (const attempt of attempts) {
      const stage = attempt.operatorStage;
      if (stage === "sent" && attempt.resendEmailId) {
        return draft.status === "sent"
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
          reason:
            "A previous send of this exact email has an unknown outcome. Check the team inbox before sending again.",
        } as const;
      }
      if (stage === "sending" || stage === "claimed" || stage === "draft_created") {
        if (now - attempt.startedAt < OPERATOR_CLAIM_LEASE_MS) {
          return { kind: "in_progress" } as const;
        }
        if (stage === "sending") {
          await ctx.db.patch(attempt._id, {
            operatorStage: "unknown",
            error: "Send did not finish; outcome unknown.",
            completedAt: now,
          });
          if (draft.status === "pending") {
            await ctx.db.patch(draft._id, {
              status: "draft",
              sendBlockedReason: UNKNOWN_OUTCOME_REASON,
            });
          }
          return {
            kind: "unknown",
            reason:
              "A previous send of this exact email did not finish and its outcome is unknown. Check the team inbox before sending again.",
          } as const;
        }
        await ctx.db.patch(attempt._id, {
          operatorStage: "failed",
          status: "failed",
          error: "Claim expired before sending.",
          completedAt: now,
        });
      }
    }

    if (draft.status !== "draft") {
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
    return {
      kind: "claimed",
      attemptId,
      senderUserId,
      keyId: `${draft._id}:${fingerprint.slice(0, 16)}`,
    } as const;
  },
});

/** Moves a claimed attempt forward; a failed or unknown one returns its draft to editable. */
export const advanceOperatorInboxAttemptInternal = internalMutation({
  args: {
    attemptId: v.id("emailDeliveryAttempts"),
    stage: v.union(
      v.literal("draft_created"),
      v.literal("sending"),
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
    const now = dayjs().valueOf();
    const final = args.stage === "sent" || args.stage === "unknown" || args.stage === "failed";
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
          : args.stage === "unknown"
            ? { error: args.error }
            : {}),
      ...(final ? { completedAt: now } : {}),
    });
    if (
      (args.stage === "failed" || args.stage === "unknown") &&
      attempt.pendingEmailId
    ) {
      const draft = await ctx.db.get(attempt.pendingEmailId);
      if (draft?.status === "pending") {
        await ctx.db.patch(draft._id, {
          status: "draft",
          ...(args.stage === "unknown"
            ? { sendBlockedReason: UNKNOWN_OUTCOME_REASON }
            : {}),
        });
      }
    }
    return null;
  },
});
