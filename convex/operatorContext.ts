import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Install once for this iteration before submitting its execution model job. */
export const installCompactedContinuation = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
    expectedStorageId: v.optional(v.id("_storage")),
    storageId: v.id("_storage"),
    mode: v.union(v.literal("model"), v.literal("deterministic")),
    skipped: v.optional(v.boolean()),
    tokensBefore: v.number(),
    tokensAfter: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      run?.status === "running" &&
      !run.cancellationRequestedAt &&
      run.runnerAttempt === args.expectedRunnerAttempt &&
      (run.checkpoint?.iteration ?? 0) === args.expectedCheckpointIteration &&
      run.modelContinuationStorageId === args.storageId &&
      run.checkpoint?.compaction?.iteration === args.expectedCheckpointIteration
    ) {
      return run.checkpoint.compaction;
    }
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.expectedRunnerAttempt ||
      (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration ||
      run.modelContinuationStorageId !== args.expectedStorageId ||
      run.checkpoint?.compaction?.iteration === args.expectedCheckpointIteration
    ) {
      if (args.storageId !== run?.modelContinuationStorageId)
        await ctx.storage.delete(args.storageId);
      return null;
    }
    const compaction = {
      mode: args.mode,
      ...(args.skipped ? { skipped: true } : {}),
      count: (run.checkpoint?.compaction?.count ?? 0) + 1,
      iteration: args.expectedCheckpointIteration,
      tokensBefore: args.tokensBefore,
      tokensAfter: args.tokensAfter,
    };
    await ctx.db.patch(run._id, {
      modelContinuationStorageId: args.storageId,
      checkpoint: {
        iteration: 0,
        executionCount: 0,
        ...run.checkpoint,
        compaction,
      },
    });
    if (run.modelContinuationStorageId)
      await ctx.storage.delete(run.modelContinuationStorageId);
    return compaction;
  },
});
