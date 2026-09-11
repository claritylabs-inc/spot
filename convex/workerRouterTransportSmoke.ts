import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

export const WORKER_ROUTER_TRANSPORT_SMOKE_TTL_MS = 15 * 60 * 1000;

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertRequestId(requestId: string): void {
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Invalid worker router transport smoke request ID");
  }
}

function fixtureName(requestId: string): string {
  return `[Synthetic worker router transport] ${requestId}`;
}

function fixtureContext(requestId: string): string {
  return `Internal, never-queued worker router transport fixture ${requestId}`;
}

function leaseId(requestId: string): string {
  return `worker-router-transport:${requestId}`;
}

type Fixture = Doc<"workerRouterTransportSmokeRuns">;

async function assertOwnedFixture(
  ctx: QueryCtx | MutationCtx,
  fixture: Fixture,
) {
  assertRequestId(fixture.requestId);
  const [organization, policy, run, queueRows, previewRows] = await Promise.all(
    [
      ctx.db.get(fixture.orgId),
      ctx.db.get(fixture.policyId),
      ctx.db.get(fixture.runId),
      ctx.db
        .query("policyExtractionQueue")
        .withIndex("policy", (query) => query.eq("policyId", fixture.policyId))
        .take(1),
      ctx.db
        .query("policyExtractionPreviewQueue")
        .withIndex("policy", (query) => query.eq("policyId", fixture.policyId))
        .take(1),
    ],
  );
  if (
    !organization ||
    organization.name !== fixtureName(fixture.requestId) ||
    organization.context !== fixtureContext(fixture.requestId) ||
    organization.type !== undefined ||
    organization.primaryInsuranceContactId !== undefined ||
    organization.primaryContactEmail !== undefined ||
    organization.primaryContactPhone !== undefined
  ) {
    throw new Error("Worker router transport fixture organization mismatch");
  }
  if (
    !policy ||
    policy.orgId !== fixture.orgId ||
    policy.fileId !== undefined ||
    policy.fileName !== fixtureName(fixture.requestId) ||
    policy.policyNumber !== fixture.requestId
  ) {
    throw new Error("Worker router transport fixture policy mismatch");
  }
  const checkpoint = run?.pipelineCheckpoint as
    | {
        nextPhase?: string;
        state?: {
          orgId?: string;
          externalWorker?: boolean;
          workerRouterTransportSmokeRequestId?: string;
        };
        lease?: { id?: string; phase?: string; expiresAt?: number };
      }
    | undefined;
  if (
    !run ||
    run._id !== fixture.runId ||
    run.policyId !== fixture.policyId ||
    run.pipelineStatus !== "running" ||
    checkpoint?.nextPhase !== "extract" ||
    checkpoint.state?.orgId !== String(fixture.orgId) ||
    checkpoint.state?.externalWorker !== true ||
    checkpoint.state.workerRouterTransportSmokeRequestId !==
      fixture.requestId ||
    checkpoint.lease?.id !== fixture.leaseId ||
    checkpoint.lease.phase !== "external_extract" ||
    checkpoint.lease.expiresAt !== fixture.expiresAt ||
    queueRows.length !== 0 ||
    previewRows.length !== 0
  ) {
    throw new Error("Worker router transport fixture lease mismatch");
  }
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (query) => query.eq("orgId", fixture.orgId))
    .take(1);
  if (memberships.length !== 0) {
    throw new Error("Worker router transport fixture acquired a membership");
  }
  return { organization, policy, run };
}

export const createFixture = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    assertRequestId(args.requestId);
    const existing = await ctx.db
      .query("workerRouterTransportSmokeRuns")
      .withIndex("singleton", (query) => query.eq("singleton", "active"))
      .unique();
    if (existing) {
      throw new Error(
        `Worker router transport smoke already active: ${existing.requestId}`,
      );
    }
    const duplicate = await ctx.db
      .query("workerRouterTransportSmokeRuns")
      .withIndex("request", (query) => query.eq("requestId", args.requestId))
      .unique();
    if (duplicate)
      throw new Error("Worker router transport request already exists");

    const createdAt = dayjs().valueOf();
    const expiresAt = createdAt + WORKER_ROUTER_TRANSPORT_SMOKE_TTL_MS;
    const orgId = await ctx.db.insert("organizations", {
      name: fixtureName(args.requestId),
      context: fixtureContext(args.requestId),
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      fileName: fixtureName(args.requestId),
      carrier: "Synthetic transport fixture",
      insuredName: "Synthetic transport fixture",
      policyNumber: args.requestId,
      linesOfBusiness: ["UN"],
      documentType: "policy",
      policyYear: dayjs().year(),
      effectiveDate: "Synthetic",
      expirationDate: "Synthetic",
      isRenewal: false,
      coverages: [],
      extractionDataStage: "placeholder",
      extractionDataStageUpdatedAt: createdAt,
    });
    const fixtureLeaseId = leaseId(args.requestId);
    const runId = await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: {
        nextPhase: "extract",
        state: {
          orgId: String(orgId),
          externalWorker: true,
          workerRouterTransportSmokeRequestId: args.requestId,
        },
        lease: {
          id: fixtureLeaseId,
          phase: "external_extract",
          expiresAt,
          heartbeatAt: createdAt,
        },
        createdAt,
      },
      createdAt,
      updatedAt: createdAt,
    });
    await ctx.db.insert("workerRouterTransportSmokeRuns", {
      singleton: "active",
      requestId: args.requestId,
      orgId,
      policyId,
      runId,
      leaseId: fixtureLeaseId,
      status: "ready",
      createdAt,
      expiresAt,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.actions.workerRouterTransportSmoke.cleanupExpired,
      { requestId: args.requestId, attempt: 0 },
    );
    return { requestId: args.requestId };
  },
});

export const beginFixture = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    assertRequestId(args.requestId);
    const fixture = await ctx.db
      .query("workerRouterTransportSmokeRuns")
      .withIndex("request", (query) => query.eq("requestId", args.requestId))
      .unique();
    if (!fixture || fixture.expiresAt <= dayjs().valueOf()) {
      throw new Error("Worker router transport fixture is unavailable");
    }
    await assertOwnedFixture(ctx, fixture);
    if (fixture.status === "ready") {
      await ctx.db.patch(fixture._id, {
        status: "running",
        startedAt: dayjs().valueOf(),
      });
    }
    return {
      jobKind: "policy" as const,
      jobId: String(fixture.policyId),
      leaseId: fixture.leaseId,
      leaseExpiresAt: fixture.expiresAt,
      orgId: String(fixture.orgId),
    };
  },
});

export const getCleanupSnapshot = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    assertRequestId(args.requestId);
    const fixture = await ctx.db
      .query("workerRouterTransportSmokeRuns")
      .withIndex("request", (query) => query.eq("requestId", args.requestId))
      .unique();
    if (!fixture) return null;
    await assertOwnedFixture(ctx, fixture);
    const assets = await ctx.db
      .query("routerAssets")
      .withIndex("job", (query) =>
        query.eq("jobKind", "policy").eq("jobId", String(fixture.policyId)),
      )
      .take(32);
    for (const asset of assets) {
      if (
        asset.ownerKind !== "worker" ||
        asset.leaseId !== fixture.leaseId ||
        asset.orgId !== fixture.orgId
      ) {
        throw new Error("Worker router transport asset ownership mismatch");
      }
    }
    return {
      smokeRunId: fixture._id,
      orgId: fixture.orgId,
      policyId: fixture.policyId,
      runId: fixture.runId,
      assetIds: assets.map((asset) => asset._id),
    };
  },
});

export const deleteFixture = internalMutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    assertRequestId(args.requestId);
    const fixture = await ctx.db
      .query("workerRouterTransportSmokeRuns")
      .withIndex("request", (query) => query.eq("requestId", args.requestId))
      .unique();
    if (!fixture) return { deleted: true };
    await assertOwnedFixture(ctx, fixture);
    const assets = await ctx.db
      .query("routerAssets")
      .withIndex("job", (query) =>
        query.eq("jobKind", "policy").eq("jobId", String(fixture.policyId)),
      )
      .take(1);
    if (assets.length !== 0) {
      throw new Error("Worker router transport assets remain during cleanup");
    }
    await ctx.db.delete(fixture.runId);
    await ctx.db.delete(fixture.policyId);
    await ctx.db.delete(fixture.orgId);
    await ctx.db.delete(fixture._id);
    return { deleted: true };
  },
});
