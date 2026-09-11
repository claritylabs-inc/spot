/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  createSignedActionRouterAsset,
  deleteSignedRouterAsset,
  settleRouterAssetCleanups,
} from "./actions/routerAssets";
import { routerAssetSigningConfiguration } from "./lib/routerAssetSignature";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function runningProposalJob() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "router-asset@example.com",
      accountKind: "operator",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Router Asset Client",
      type: "client",
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Router Asset Broker",
      type: "broker",
    });
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId: orgId,
      title: "Asset test",
      narrative: "Test",
      status: "marketing",
      inboxToken: "router-asset-test",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
      requestId,
      clientOrgId: orgId,
      brokerOrgId,
      brokerName: "Broker",
      status: "request_sent",
      applicationQuestions: [],
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const proposalId = await ctx.db.insert("procurementProposals", {
      requestId,
      clientOrgId: orgId,
      brokerOrgId,
      outreachId,
      status: "extracting",
      extractionFingerprint: "router-asset",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("procurementProposalExtractionJobs", {
      proposalId,
      requestId,
      clientOrgId: orgId,
      extractionFingerprint: "router-asset",
      requestedByUserId: userId,
      status: "running",
      attempts: 1,
      leaseId: "lease-1",
      leaseExpiresAt: dayjs().add(30, "minute").valueOf(),
      createdAt: now,
      updatedAt: now,
    });
    return { orgId, jobId };
  });
  return { t, ...ids };
}

function uploadHeaders(args: {
  orgId: string;
  jobId: string;
  leaseId?: string;
}) {
  return {
    authorization: "Bearer worker-secret",
    "content-type": "image/png",
    "content-length": "3",
    "x-spot-router-asset-job-kind": "proposal",
    "x-spot-router-asset-job-id": args.jobId,
    "x-spot-router-asset-lease-id": args.leaseId ?? "lease-1",
    "x-spot-router-asset-org-id": args.orgId,
    "x-spot-router-asset-filename": "page.png",
  };
}

describe("router asset HTTP staging", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("stores bytes server-side and binds download to the exact active lease", async () => {
    vi.stubEnv("EXTRACTION_WORKER_SECRET", "worker-secret");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const { t, orgId, jobId } = await runningProposalJob();

    const stale = await t.fetch("/router-assets/upload", {
      method: "POST",
      headers: uploadHeaders({ orgId, jobId, leaseId: "wrong-lease" }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(stale.status).toBe(409);

    const upload = await t.fetch("/router-assets/upload", {
      method: "POST",
      headers: {
        ...uploadHeaders({ orgId, jobId }),
        "x-worker-controlled-storage-id": "substitution-is-not-an-input",
      },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    const result = (await upload.json()) as {
      assetId: Id<"routerAssets">;
      reference: { url: string; sizeBytes: number; sha256: string };
    };
    expect(result.reference).toMatchObject({
      sizeBytes: 3,
      sha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(result.reference.url).toMatch(
      /^http:\/\/localhost:3211\/router-assets\?/,
    );
    const row = await t.run(async (ctx) => ctx.db.get(result.assetId));
    expect(row).toMatchObject({
      ownerKind: "worker",
      jobKind: "proposal",
      jobId,
      leaseId: "lease-1",
      orgId,
    });

    const reference = new URL(result.reference.url);
    const download = await t.fetch(`${reference.pathname}${reference.search}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    reference.searchParams.set("signature", "tampered");
    expect(
      (await t.fetch(`${reference.pathname}${reference.search}`)).status,
    ).toBe(404);

    await t.run(async (ctx) => ctx.db.patch(jobId, { status: "complete" }));
    expect(
      (await t.fetch(`${reference.pathname}${reference.search}`)).status,
    ).toBe(404);
  });

  test("scheduled cleanup covers a response the worker never receives", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EXTRACTION_WORKER_SECRET", "worker-secret");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const { t, orgId, jobId } = await runningProposalJob();
    const upload = await t.fetch("/router-assets/upload", {
      method: "POST",
      headers: uploadHeaders({ orgId, jobId }),
      body: new Uint8Array([1, 2, 3]),
    });
    const { assetId } = (await upload.json()) as {
      assetId: Id<"routerAssets">;
    };
    expect(await t.run(async (ctx) => ctx.db.get(assetId))).not.toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(async (ctx) => ctx.db.get(assetId))).toBeNull();
  });
});

describe("router asset signing configuration", () => {
  test("requires the exact lane HTTP-action origin", () => {
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "dev",
        CL_ROUTER_SECRET: "router-secret",
        CONVEX_SITE_URL: "https://acoustic-caiman-755.convex.site",
      }),
    ).toMatchObject({
      siteUrl: "https://acoustic-caiman-755.convex.site",
    });
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "production",
        CL_ROUTER_SECRET: "router-secret",
        CONVEX_SITE_URL: "https://actions.spot.insure",
      }),
    ).toMatchObject({ siteUrl: "https://actions.spot.insure" });

    for (const siteUrl of [
      "https://actions.spot.insure:8443",
      "https://worker@actions.spot.insure",
      "https://actions.spot.insure/unexpected",
      "https://actions.spot.insure?lane=production",
    ]) {
      expect(() =>
        routerAssetSigningConfiguration({
          SPOT_ENV: "production",
          CL_ROUTER_SECRET: "router-secret",
          CONVEX_SITE_URL: siteUrl,
        }),
      ).toThrow("canonical router asset host");
    }
  });
});

describe("action-owned router asset cleanup", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("attempts every cleanup and reports only a sanitized failure count", async () => {
    const first = vi.fn(async () => {
      throw new Error("secret storage failure");
    });
    const second = vi.fn(async () => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      settleRouterAssetCleanups([first, second]),
    ).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("secret storage failure"),
    );
  });

  test("retains the ledger and schedules retry when blob deletion fails", async () => {
    const assetId = "asset-id" as Id<"routerAssets">;
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      runQuery: vi.fn(async () => ({ storageId })),
      runMutation: vi.fn(async () => true),
      storage: {
        delete: vi.fn(async () => Promise.reject(new Error("retry"))),
      },
    };
    await expect(
      deleteSignedRouterAsset(ctx as never, { assetId }),
    ).resolves.toBe(false);
    expect(ctx.runMutation).toHaveBeenCalledOnce();
    const [, failureArgs] = ctx.runMutation.mock.calls[0] as unknown as [
      unknown,
      unknown,
    ];
    expect(failureArgs).toEqual({ assetId, storageId });

    ctx.storage.delete.mockResolvedValueOnce(undefined as never);
    ctx.runMutation.mockClear();
    await expect(
      deleteSignedRouterAsset(ctx as never, { assetId }),
    ).resolves.toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledOnce();
  });

  test("register failure with an initial delete failure schedules orphan cleanup", async () => {
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => Promise.reject(new Error("temporary"))),
      },
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(new Error("registration failed"))
        .mockResolvedValueOnce(true),
    };
    await expect(
      createSignedActionRouterAsset(ctx as never, {
        bytes: new Uint8Array([1]),
        mediaType: "audio/webm",
        surface: "voice_transcription",
        sessionKey: "session-1",
      }),
    ).rejects.toThrow("registration failed");
    expect(ctx.runMutation).toHaveBeenLastCalledWith(expect.anything(), {
      storageId,
      attempt: 1,
    });
  });

  test("preserves registration failure when immediate orphan cleanup also fails", async () => {
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const storageId = "storage-id" as Id<"_storage">;
    const ctx = {
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => Promise.reject(new Error("delete failed"))),
      },
      runMutation: vi
        .fn()
        .mockRejectedValueOnce(new Error("registration failed"))
        .mockRejectedValueOnce(new Error("cleanup scheduling failed")),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      createSignedActionRouterAsset(ctx as never, {
        bytes: new Uint8Array([1]),
        mediaType: "audio/webm",
        surface: "voice_transcription",
        sessionKey: "session-1",
      }),
    ).rejects.toThrow("registration failed");
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
  });
});
