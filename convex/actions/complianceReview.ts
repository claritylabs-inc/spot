"use node";

import { getSessionUserId as getAuthUserId } from "../lib/sessionIdentity";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { computeRequirementJudgments } from "./complianceJudgments";
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

    await computeRequirementJudgments(ctx, {
      requirementId: args.requirementId,
      subjectOrgId: args.orgId,
      force: true,
    });
    const result = await ctx.runMutation(
      internal.compliance.finishComplianceRecheckInternal,
      {
        ...args,
        userId: userId as Id<"users">,
      },
    );
    const verdict = {
      status: result.status,
      matchedPolicyIds: result.matchedPolicyIds,
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      ...(result.daysUntilExpiration !== undefined
        ? { daysUntilExpiration: result.daysUntilExpiration }
        : {}),
    };
    return {
      ...verdict,
      notes: reviewNote(
        verdict,
        context.policies.filter((policy) =>
          result.matchedPolicyIds.includes(policy._id),
        ),
      ),
    };
  },
});
