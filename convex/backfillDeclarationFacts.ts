import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { extractDeclarationFactsFromPolicy } from "./lib/declarationFacts";

export function effectiveExtractionDataStage(policy: {
  extractionDataStage?: "placeholder" | "preview" | "final";
  pipelineStatus?: string;
}) {
  return policy.extractionDataStage ?? (policy.pipelineStatus === "complete" ? "final" : "placeholder");
}

/**
 * Rebuilds declaration facts from policy rows already stored in Convex.
 * This never schedules extraction or invokes a model.
 */
export const backfillBatchInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    continueAutomatically: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(25, Math.trunc(args.batchSize ?? 25)));
    const page = await ctx.db.query("policies").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });
    let eligible = 0;
    let inserted = 0;
    let deactivated = 0;
    let unchanged = 0;

    for (const policy of page.page) {
      if (!policy.orgId || effectiveExtractionDataStage(policy) !== "final") continue;
      eligible += 1;
      if (args.dryRun ?? true) {
        if (!policy.deletedAt) {
          inserted += extractDeclarationFactsFromPolicy(
            policy as unknown as Record<string, unknown>,
          ).length;
        }
        continue;
      }
      const result = await replacePolicyDeclarationFacts(ctx, policy._id);
      inserted += result.inserted;
      deactivated += result.deactivated;
      if (result.unchanged) unchanged += 1;
    }

    if (!page.isDone && args.continueAutomatically) {
      await ctx.scheduler.runAfter(
        0,
        internal.backfillDeclarationFacts.backfillBatchInternal,
        {
          cursor: page.continueCursor,
          batchSize,
          dryRun: args.dryRun ?? true,
          continueAutomatically: true,
        },
      );
    }

    return {
      dryRun: args.dryRun ?? true,
      visited: page.page.length,
      eligible,
      inserted,
      deactivated,
      unchanged,
      isDone: page.isDone,
      continueCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});
