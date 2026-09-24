"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

type PolicyPage = {
  page: Array<{
    id: Id<"policies">;
    needsExtraction: boolean;
    canExtract: boolean;
  }>;
  continueCursor: string;
  isDone: boolean;
};

export const run = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.max(1, Math.min(500, Math.trunc(args.limit ?? 100)));
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let needsExtraction = 0;
    let eligible = 0;
    let skipped = 0;
    let scheduled = 0;
    let isDone = false;

    while (scanned < limit && !isDone) {
      const page: PolicyPage =
        await ctx.runQuery(internal.reextractLegacyPolicies.listPageInternal, {
          paginationOpts: { cursor, numItems: Math.min(25, limit - scanned) },
        });
      scanned += page.page.length;
      cursor = page.continueCursor;
      isDone = page.isDone;

      for (const policy of page.page) {
        if (!policy.needsExtraction) continue;
        needsExtraction++;
        if (!policy.canExtract) {
          skipped++;
          continue;
        }
        eligible++;
        if (dryRun) continue;
        await ctx.scheduler.runAfter(
          0,
          internal.actions.policyExtraction.retryPolicyExtraction,
          { policyId: policy.id, mode: "full" },
        );
        scheduled++;
      }
    }

    return {
      dryRun,
      limit,
      scanned,
      needsExtraction,
      eligible,
      skipped,
      scheduled,
      isDone,
      continueCursor: isDone ? null : cursor,
    };
  },
});
