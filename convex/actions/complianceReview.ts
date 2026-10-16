"use node";

import { getSessionUserId as getAuthUserId } from "../lib/sessionIdentity";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide, runWithPayloadSplitting } from "../lib/clRouterClient";
import { jevProceeds, jevChoiceConfidence } from "../lib/jevThreshold";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

type ComplianceReviewResult = {
  status: "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
  matchedPolicyIds: Id<"policies">[];
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes: string;
};

type ManualReviewContext = import("convex/server").FunctionReturnType<
  typeof internal.compliance.getManualComplianceReviewContextInternal
>;
const COMPLIANCE_REVIEW_TIMEOUT_MS = 75_000;
const MAX_DECISION_QUESTIONS = 128;

function reviewNote(
  review: Omit<ComplianceReviewResult, "notes">,
  policies: ManualReviewContext["policies"],
): string {
  const matched = policies
    .map((policy) => policy.policyNumber || String(policy._id))
    .join(", ");
  const evidence = matched ? ` Matched policies: ${matched}.` : "";
  const notes: Record<ComplianceReviewResult["status"], string> = {
    met: "The matched policy evidence satisfies this requirement.",
    not_met: "The available policy evidence does not satisfy this requirement.",
    expiring_soon: `The matched policy evidence satisfies this requirement, with coverage expiring on ${review.expiresAt} (${review.daysUntilExpiration} days).`,
    expired: `The matching policy evidence has expired; the earliest expiration was ${review.expiresAt}.`,
    unverified:
      "The available evidence does not support a confident compliance verdict. Manual verification is required.",
  };
  return `${notes[review.status]}${evidence}`.slice(0, 600);
}

export const recheckOwnRequirement = action({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
  },
  returns: v.object({
    status: v.union(
      v.literal("met"),
      v.literal("not_met"),
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("unverified"),
    ),
    matchedPolicyIds: v.array(v.id("policies")),
    expiresAt: v.optional(v.string()),
    daysUntilExpiration: v.optional(v.number()),
    notes: v.string(),
  }),
  handler: async (ctx, args): Promise<ComplianceReviewResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const context = (await ctx.runQuery(
      internal.compliance.getManualComplianceReviewContextInternal,
      {
        orgId: args.orgId,
        requirementId: args.requirementId,
        userId: userId as Id<"users">,
      },
    )) as ManualReviewContext;

    if (context.judgmentPlans.length > 100) throw new Error("Too many compliance policies");
    const abortSignal = AbortSignal.timeout(COMPLIANCE_REVIEW_TIMEOUT_MS);
    const traceId = `compliance-review:${args.requirementId}:${crypto.randomUUID()}`;
    const judgments = [];
    for (const plan of context.judgmentPlans) {
      const answers: Record<string, string | boolean> = {};
      const entries = Object.entries(plan.questions);
      for (let offset = 0; offset < entries.length; offset += MAX_DECISION_QUESTIONS) {
        const batch = entries.slice(offset, offset + MAX_DECISION_QUESTIONS);
        try {
          const results = await runWithPayloadSplitting(batch, (part) => clRouterDecide({
            orgId: String(args.orgId),
            task: "compliance_manual_review",
            trace: { traceId },
            state: plan.state,
            questions: Object.fromEntries(part),
          }, { telemetry: ctx, abortSignal }));
          for (const result of results) {
            for (const [key, answer] of Object.entries(result.answers)) {
              if (answer.type === "noul") {
                if (jevProceeds(answer.noul)) answers[key] = true;
                else if (jevProceeds(1 - answer.noul)) answers[key] = false;
              } else if (answer.type === "choice" && jevProceeds(jevChoiceConfidence(answer))) {
                answers[key] = answer.choice;
              }
            }
          }
        } catch {
          // Missing judgments remain unverified, including router failures.
        }
      }
      judgments.push({ policyId: plan.policyId, inputKey: plan.inputKey, answers });
    }
    const result = await ctx.runMutation(internal.compliance.saveComplianceJudgmentsInternal, {
      ...args,
      userId: userId as Id<"users">,
      judgments,
    });
    const verdict = {
      status: result.status,
      matchedPolicyIds: result.matchedPolicyIds,
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      ...(result.daysUntilExpiration !== undefined ? { daysUntilExpiration: result.daysUntilExpiration } : {}),
    };
    return { ...verdict, notes: reviewNote(verdict, context.policies.filter((policy) => result.matchedPolicyIds.includes(policy._id))) };
  },
});
