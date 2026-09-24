import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { assertCanReadPolicies, getOrgAccess } from "./lib/access";
import { readRunProgress, readSectionSource } from "./lib/extractionRunView";

/** Section progress of a running extraction, for anyone who can read the policy. */
export const get = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, { policyId }) => {
    const policy = await ctx.db.get(policyId);
    if (!policy?.orgId) return null;
    try {
      const access = await getOrgAccess(ctx, policy.orgId, {
        allowOperator: true,
      });
      assertCanReadPolicies(access);
    } catch {
      return null;
    }
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (q) => q.eq("policyId", policyId))
      .first();
    if (
      !run ||
      (run.pipelineStatus !== "running" && run.pipelineStatus !== "paused")
    ) {
      return null;
    }
    return await readRunProgress(ctx, run._id);
  },
});

/** Callers (operator actions) authorize before reading. */
export const sectionSourceInternal = internalQuery({
  args: { runId: v.string(), sectionId: v.string() },
  handler: async (ctx, { runId, sectionId }) =>
    await readSectionSource(ctx, runId, sectionId),
});
