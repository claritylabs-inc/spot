"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { deleteSignedRouterAsset } from "./routerAssets";

type FixtureLease = {
  jobKind: "policy";
  jobId: string;
  leaseId: string;
  leaseExpiresAt: number;
  orgId: string;
};

const fixtureLeaseValidator = v.object({
  jobKind: v.literal("policy"),
  jobId: v.string(),
  leaseId: v.string(),
  leaseExpiresAt: v.number(),
  orgId: v.string(),
});

const cleanupResultValidator = v.object({ deleted: v.boolean() });

function requireWorkerSecret(secret: string): void {
  const expected = process.env.EXTRACTION_WORKER_SECRET?.trim();
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized extraction worker");
  }
}

async function cleanupFixture(
  ctx: ActionCtx,
  requestId: string,
): Promise<{ deleted: boolean }> {
  const snapshot = await ctx.runQuery(
    internal.workerRouterTransportSmoke.getCleanupSnapshot,
    { requestId },
  );
  if (!snapshot) return { deleted: true };

  await Promise.allSettled(
    snapshot.assetIds.map(async (assetId: Id<"routerAssets">) => {
      await deleteSignedRouterAsset(ctx, { assetId });
    }),
  );
  const remaining = await ctx.runQuery(
    internal.workerRouterTransportSmoke.getCleanupSnapshot,
    { requestId },
  );
  if (remaining && remaining.assetIds.length > 0) {
    throw new Error("Worker router transport asset cleanup remains pending");
  }
  return await ctx.runMutation(
    internal.workerRouterTransportSmoke.deleteFixture,
    { requestId },
  );
}

export const begin = action({
  args: { secret: v.string(), requestId: v.string() },
  returns: fixtureLeaseValidator,
  handler: async (ctx, args): Promise<FixtureLease> => {
    requireWorkerSecret(args.secret);
    return await ctx.runMutation(
      internal.workerRouterTransportSmoke.beginFixture,
      { requestId: args.requestId },
    );
  },
});

export const finish = action({
  args: { secret: v.string(), requestId: v.string() },
  returns: cleanupResultValidator,
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    requireWorkerSecret(args.secret);
    return await cleanupFixture(ctx, args.requestId);
  },
});

export const cleanup = internalAction({
  args: { requestId: v.string() },
  returns: cleanupResultValidator,
  handler: async (ctx, args): Promise<{ deleted: boolean }> =>
    await cleanupFixture(ctx, args.requestId),
});

export const cleanupExpired = internalAction({
  args: { requestId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await cleanupFixture(ctx, args.requestId);
    } catch {
      const attempt = Math.max(0, Math.floor(args.attempt ?? 0));
      if (attempt < 5) {
        await ctx.scheduler.runAfter(
          Math.min(2 ** attempt * 5_000, 60_000),
          internal.actions.workerRouterTransportSmoke.cleanupExpired,
          { requestId: args.requestId, attempt: attempt + 1 },
        );
      }
    }
    return null;
  },
});
