/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const requestId = "919d3d23-ce0c-44d9-8dd4-2b75f8639fe2";

describe("worker router transport smoke fixture", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("creates one unowned, never-queued policy lease and exchanges only its opaque request ID", async () => {
    vi.stubEnv("EXTRACTION_WORKER_SECRET", "worker-secret");
    const t = convexTest(schema, modules);
    await t.mutation(internal.workerRouterTransportSmoke.createFixture, {
      requestId,
    });

    const fixture = await t.run(async (ctx) => {
      const smoke = await ctx.db
        .query("workerRouterTransportSmokeRuns")
        .withIndex("request", (query) => query.eq("requestId", requestId))
        .unique();
      if (!smoke) throw new Error("fixture missing");
      return {
        smoke,
        organization: await ctx.db.get(smoke.orgId),
        policy: await ctx.db.get(smoke.policyId),
        run: await ctx.db.get(smoke.runId),
        queues: await ctx.db
          .query("policyExtractionQueue")
          .withIndex("policy", (query) => query.eq("policyId", smoke.policyId))
          .collect(),
        previews: await ctx.db
          .query("policyExtractionPreviewQueue")
          .withIndex("policy", (query) => query.eq("policyId", smoke.policyId))
          .collect(),
        memberships: await ctx.db
          .query("orgMemberships")
          .withIndex("organization", (query) => query.eq("orgId", smoke.orgId))
          .collect(),
      };
    });
    expect(fixture.organization?.type).toBeUndefined();
    expect(fixture.organization?.primaryContactEmail).toBeUndefined();
    expect(fixture.policy?.userId).toBeUndefined();
    expect(fixture.policy?.fileId).toBeUndefined();
    expect(fixture.queues).toEqual([]);
    expect(fixture.previews).toEqual([]);
    expect(fixture.memberships).toEqual([]);

    await expect(
      t.action(api.actions.workerRouterTransportSmoke.begin, {
        secret: "wrong-secret",
        requestId,
      }),
    ).rejects.toThrow(/unauthorized/i);
    const lease = await t.action(api.actions.workerRouterTransportSmoke.begin, {
      secret: "worker-secret",
      requestId,
    });
    expect(lease).toEqual({
      jobKind: "policy",
      jobId: String(fixture.smoke.policyId),
      leaseId: `worker-router-transport:${requestId}`,
      leaseExpiresAt: fixture.smoke.expiresAt,
      orgId: String(fixture.smoke.orgId),
    });
    await expect(
      t.action(api.actions.workerRouterTransportSmoke.begin, {
        secret: "worker-secret",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/unavailable/i);
    await expect(
      t.mutation(internal.workerRouterTransportSmoke.createFixture, {
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).rejects.toThrow(/already active/i);
  });

  test("the stale extraction sweep cannot queue or schedule the marker-owned lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(dayjs("2026-09-10T12:00:00.000Z").valueOf());
    const t = convexTest(schema, modules);
    await t.mutation(internal.workerRouterTransportSmoke.createFixture, {
      requestId,
    });
    const smokeRunId = await t.run(async (ctx) => {
      const smoke = await ctx.db
        .query("workerRouterTransportSmokeRuns")
        .withIndex("request", (query) => query.eq("requestId", requestId))
        .unique();
      if (!smoke) throw new Error("fixture missing");
      return smoke._id;
    });
    const scheduledBefore = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );

    vi.setSystemTime(dayjs().add(6, "minute").valueOf());
    const result = await t.mutation(internal.policies.pipelineRequeueStale, {
      olderThanMs: 5 * 60 * 1000,
      batchSize: 25,
    });
    const state = await t.run(async (ctx) => {
      const smoke = await ctx.db.get(smokeRunId);
      if (!smoke) throw new Error("fixture missing");
      return {
        queues: await ctx.db
          .query("policyExtractionQueue")
          .withIndex("policy", (query) => query.eq("policyId", smoke.policyId))
          .collect(),
        smoke,
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      };
    });
    expect(result.requeued).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(state.smoke).not.toBeNull();
    expect(state.queues).toEqual([]);
    expect(state.scheduled).toHaveLength(scheduledBefore.length);
  });

  test("an unqueued fixture can stage through the real lease gate and exact cleanup removes it", async () => {
    vi.stubEnv("EXTRACTION_WORKER_SECRET", "worker-secret");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const t = convexTest(schema, modules);
    await t.mutation(internal.workerRouterTransportSmoke.createFixture, {
      requestId,
    });
    const smokeRunId = await t.run(async (ctx) => {
      const smoke = await ctx.db
        .query("workerRouterTransportSmokeRuns")
        .withIndex("request", (query) => query.eq("requestId", requestId))
        .unique();
      if (!smoke) throw new Error("fixture missing");
      return smoke._id;
    });
    const lease = await t.action(api.actions.workerRouterTransportSmoke.begin, {
      secret: "worker-secret",
      requestId,
    });
    const upload = await t.fetch("/router-assets/upload", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-secret",
        "content-type": "image/png",
        "content-length": "3",
        "x-spot-router-asset-job-kind": lease.jobKind,
        "x-spot-router-asset-job-id": lease.jobId,
        "x-spot-router-asset-lease-id": lease.leaseId,
        "x-spot-router-asset-org-id": lease.orgId,
        "x-spot-router-asset-filename": "pixel.png",
      },
      body: Uint8Array.from([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as {
      assetId: Id<"routerAssets">;
      reference: { url: string };
    };
    expect(uploaded.reference.url).toContain("/router-assets?");

    await expect(
      t.action(api.actions.workerRouterTransportSmoke.finish, {
        secret: "wrong-secret",
        requestId,
      }),
    ).rejects.toThrow(/unauthorized/i);
    await expect(
      t.action(api.actions.workerRouterTransportSmoke.finish, {
        secret: "worker-secret",
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      t.action(api.actions.workerRouterTransportSmoke.finish, {
        secret: "worker-secret",
        requestId,
      }),
    ).resolves.toEqual({ deleted: true });

    expect(
      await t.run(async (ctx) => ({
        smoke: await ctx.db.get(smokeRunId),
        asset: await ctx.db.get(uploaded.assetId),
      })),
    ).toEqual({ smoke: null, asset: null });
  });
});
