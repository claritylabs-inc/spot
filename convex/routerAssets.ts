import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const ROUTER_ASSET_MAX_BYTES = 12 * 1024 * 1024;
export const ROUTER_ASSET_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024;
export const ROUTER_ASSET_MAX_COUNT = 8;
export const ROUTER_ASSET_TTL_MS = 10 * 60 * 1000;

const jobKindValidator = v.union(
  v.literal("policy"),
  v.literal("preview"),
  v.literal("proposal"),
);
type RouterAssetJob = {
  jobKind: "policy" | "preview" | "proposal";
  jobId: string;
  leaseId: string;
  orgId: Id<"organizations">;
};

async function activeLeaseExpiry(
  ctx: QueryCtx | MutationCtx,
  job: RouterAssetJob,
): Promise<number | null> {
  const now = dayjs().valueOf();
  if (job.jobKind === "proposal") {
    const jobId = ctx.db.normalizeId(
      "procurementProposalExtractionJobs",
      job.jobId,
    );
    if (!jobId) return null;
    const row = await ctx.db.get(jobId);
    const expiry = row?.leaseExpiresAt ?? 0;
    return row &&
      row.status === "running" &&
      row.leaseId === job.leaseId &&
      expiry > now &&
      row.clientOrgId === job.orgId
      ? expiry
      : null;
  }
  const policyId = ctx.db.normalizeId("policies", job.jobId);
  if (!policyId) return null;
  const run = await ctx.db
    .query("policyExtractionRuns")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .unique();
  if (!run || run.pipelineStatus !== "running") return null;
  const checkpoint = run.pipelineCheckpoint as
    | {
        nextPhase?: string;
        state?: { orgId?: string };
        lease?: { id?: string; expiresAt?: number };
      }
    | undefined;
  if (
    checkpoint?.nextPhase !== "extract" ||
    checkpoint.state?.orgId !== String(job.orgId)
  )
    return null;
  if (job.jobKind === "policy") {
    const expiry = checkpoint.lease?.expiresAt ?? 0;
    return checkpoint.lease?.id === job.leaseId && expiry > now ? expiry : null;
  }
  const previews = await ctx.db
    .query("policyExtractionPreviewQueue")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .order("desc")
    .take(20);
  const row = previews.find(
    (item) =>
      item.status === "leased" &&
      item.leaseId === job.leaseId &&
      (item.leaseExpiresAt ?? 0) > now,
  );
  return row?.leaseExpiresAt ?? null;
}

export const validateWorkerLease = internalQuery({
  args: {
    jobKind: jobKindValidator,
    jobId: v.string(),
    leaseId: v.string(),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => ({
    leaseExpiresAt: await activeLeaseExpiry(ctx, args),
  }),
});

export const registerWorkerAsset = internalMutation({
  args: {
    jobKind: jobKindValidator,
    jobId: v.string(),
    leaseId: v.string(),
    orgId: v.id("organizations"),
    storageId: v.id("_storage"),
    mediaType: v.string(),
    filename: v.optional(v.string()),
    sizeBytes: v.number(),
    sha256: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const leaseExpiresAt = await activeLeaseExpiry(ctx, args);
    if (!leaseExpiresAt)
      throw new Error("Stale or mismatched extraction worker lease");
    if (
      args.expiresAt <= now ||
      args.expiresAt > leaseExpiresAt ||
      args.expiresAt > now + ROUTER_ASSET_TTL_MS
    ) {
      throw new Error("Router asset expiry exceeds its active worker lease");
    }
    if (
      !Number.isSafeInteger(args.sizeBytes) ||
      args.sizeBytes <= 0 ||
      args.sizeBytes > ROUTER_ASSET_MAX_BYTES
    ) {
      throw new Error("Router asset exceeds the 12 MiB per-asset limit");
    }
    const existing = await ctx.db
      .query("routerAssets")
      .withIndex("job", (q) =>
        q.eq("jobKind", args.jobKind).eq("jobId", args.jobId),
      )
      .order("desc")
      .take(ROUTER_ASSET_MAX_COUNT * 4);
    const active = existing.filter(
      (row) => row.leaseId === args.leaseId && row.expiresAt > now,
    );
    if (active.length >= ROUTER_ASSET_MAX_COUNT)
      throw new Error("Router request exceeds the eight-asset limit");
    if (
      active.reduce((sum, row) => sum + row.sizeBytes, args.sizeBytes) >
      ROUTER_ASSET_MAX_AGGREGATE_BYTES
    ) {
      throw new Error("Router request exceeds the 16 MiB decoded asset limit");
    }
    const assetId = await ctx.db.insert("routerAssets", {
      ...args,
      ownerKind: "worker",
      createdAt: now,
      cleanupAttempts: 0,
    });
    await ctx.scheduler.runAt(
      args.expiresAt,
      internal.actions.routerAssets.expireAsset,
      { assetId },
    );
    return assetId;
  },
});

export const registerActionAsset = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    surface: v.string(),
    sessionKey: v.string(),
    storageId: v.id("_storage"),
    mediaType: v.string(),
    filename: v.optional(v.string()),
    sizeBytes: v.number(),
    sha256: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    if (args.expiresAt <= now || args.expiresAt > now + ROUTER_ASSET_TTL_MS) {
      throw new Error("Router asset expiry exceeds the action asset lifetime");
    }
    if (
      !Number.isSafeInteger(args.sizeBytes) ||
      args.sizeBytes <= 0 ||
      args.sizeBytes > ROUTER_ASSET_MAX_BYTES
    ) {
      throw new Error("Router asset exceeds the 12 MiB per-asset limit");
    }
    const existing = await ctx.db
      .query("routerAssets")
      .withIndex("session", (q) =>
        q
          .eq("ownerKind", "action")
          .eq("surface", args.surface)
          .eq("sessionKey", args.sessionKey),
      )
      .order("desc")
      .take(ROUTER_ASSET_MAX_COUNT);
    const active = existing.filter((row) => row.expiresAt > now);
    if (active.length >= ROUTER_ASSET_MAX_COUNT) {
      throw new Error("Router request exceeds the eight-asset limit");
    }
    if (
      active.reduce((sum, row) => sum + row.sizeBytes, args.sizeBytes) >
      ROUTER_ASSET_MAX_AGGREGATE_BYTES
    ) {
      throw new Error("Router request exceeds the 16 MiB decoded asset limit");
    }
    const assetId = await ctx.db.insert("routerAssets", {
      ...args,
      ownerKind: "action",
      createdAt: now,
      cleanupAttempts: 0,
    });
    await ctx.scheduler.runAt(
      args.expiresAt,
      internal.actions.routerAssets.expireAsset,
      { assetId },
    );
    return assetId;
  },
});

export const resolveForDownload = internalQuery({
  args: { assetId: v.id("routerAssets"), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.assetId);
    if (
      !row ||
      row.expiresAt !== args.expiresAt ||
      row.expiresAt <= dayjs().valueOf()
    )
      return null;
    if (row.ownerKind === "action") return row;
    if (!row.jobKind || !row.jobId || !row.leaseId || !row.orgId) return null;
    return (await activeLeaseExpiry(ctx, {
      jobKind: row.jobKind,
      jobId: row.jobId,
      leaseId: row.leaseId,
      orgId: row.orgId,
    }))
      ? row
      : null;
  },
});

export const getForCleanup = internalQuery({
  args: { assetId: v.id("routerAssets") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.assetId);
    if (!row) return null;
    return { storageId: row.storageId };
  },
});

export const completeCleanup = internalMutation({
  args: { assetId: v.id("routerAssets"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.assetId);
    if (!row || row.storageId !== args.storageId) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});

const MAX_CLEANUP_ATTEMPTS = 5;

export const scheduleUnregisteredCleanup = internalMutation({
  args: { storageId: v.id("_storage"), attempt: v.number() },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.attempt) ||
      args.attempt < 1 ||
      args.attempt >= MAX_CLEANUP_ATTEMPTS
    )
      return false;
    await ctx.scheduler.runAfter(
      Math.min(60_000, 2 ** args.attempt * 1_000),
      internal.actions.routerAssets.deleteUnregisteredAsset,
      { storageId: args.storageId, attempt: args.attempt },
    );
    return true;
  },
});

export const recordCleanupFailure = internalMutation({
  args: { assetId: v.id("routerAssets"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.assetId);
    if (!row || row.storageId !== args.storageId) return false;
    const cleanupAttempts = (row.cleanupAttempts ?? 0) + 1;
    await ctx.db.patch(row._id, { cleanupAttempts });
    if (cleanupAttempts < MAX_CLEANUP_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        Math.min(60_000, 2 ** cleanupAttempts * 1_000),
        internal.actions.routerAssets.expireAsset,
        { assetId: row._id },
      );
    }
    return true;
  },
});
