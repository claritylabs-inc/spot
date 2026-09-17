"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { z } from "zod";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "../lib/models";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

const ComplianceReviewSchema = z.object({
  status: z.enum(["met", "not_met", "expiring_soon", "expired", "unverified"]),
  matchedPolicyIds: z.array(z.string()).max(8),
  expiresAt: z.string().nullable(),
  daysUntilExpiration: z.number().int().nullable(),
  notes: z.string().min(1).max(600),
});

type ComplianceReviewResult = {
  status: "met" | "not_met" | "expiring_soon" | "expired" | "unverified";
  matchedPolicyIds: Id<"policies">[];
  expiresAt?: string;
  daysUntilExpiration?: number;
  notes: string;
};

type ManualReviewContext = {
  org: {
    _id: Id<"organizations">;
    name: string;
  } | null;
  policies: Array<{ _id: Id<"policies"> }>;
};

const COMPLIANCE_REVIEW_TIMEOUT_MS = 75_000;

function truncate(value: unknown, maxLength = 1200) {
  if (typeof value !== "string") return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function compactContext(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => truncate(item),
    2,
  );
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

    const context = await ctx.runQuery(
      internal.compliance.getManualComplianceReviewContextInternal,
      {
        orgId: args.orgId,
        requirementId: args.requirementId,
        userId: userId as Id<"users">,
      },
    ) as ManualReviewContext;

    const knownPolicyIds = new Set(
      context.policies.map((policy: { _id: Id<"policies"> }) =>
        String(policy._id),
      ),
    );
    const today = dayjs().format("YYYY-MM-DD");
    const abortSignal = AbortSignal.timeout(COMPLIANCE_REVIEW_TIMEOUT_MS);
    let result;
    try {
      result = await generateObjectForOrg(ctx, args.orgId, "analysis", {
        schema: ComplianceReviewSchema,
        abortSignal,
        maxOutputTokens: 500,
        system:
          "You are a careful commercial insurance compliance reviewer. Decide whether the organization's current policies satisfy a single insurance requirement using only the provided structured policy evidence. Do not guess. If the evidence is ambiguous, incomplete, internally inconsistent, or requires human interpretation, return unverified.",
        prompt: `Today is ${today}.

Status rules:
- met: active policy evidence clearly satisfies the requirement.
- not_met: no active policy evidence satisfies it, or the detected active limit/deductible/coverage is below the requirement.
- expiring_soon: otherwise met, but the satisfying policy expires within 30 days.
- expired: only expired policy evidence matches.
- unverified: evidence is present but ambiguous, contradictory, or not structured enough to decide.

Named insured must reasonably match the organization name unless the requirement or policy evidence makes a different insured acceptable.
Use matchedPolicyIds only from the provided policies. Keep notes short and specific; mention the decisive policy/evidence and any gap.

Review context:
${compactContext(context)}`,
      });
    } catch (error) {
      if (abortSignal.aborted) {
        throw new Error(
          "The deeper compliance check took too long. Try again in a moment.",
        );
      }
      throw error;
    }

    const matchedPolicyIds = result.object.matchedPolicyIds
      .filter((id: string) => knownPolicyIds.has(id))
      .map((id: string) => id as Id<"policies">);
    const review: ComplianceReviewResult = {
      status: result.object.status,
      matchedPolicyIds,
      expiresAt: result.object.expiresAt ?? undefined,
      daysUntilExpiration: result.object.daysUntilExpiration ?? undefined,
      notes: result.object.notes.trim(),
    };

    await ctx.runMutation(
      internal.compliance.saveManualComplianceReviewInternal,
      {
        orgId: args.orgId,
        requirementId: args.requirementId,
        userId: userId as Id<"users">,
        ...review,
      },
    );

    return review;
  },
});
