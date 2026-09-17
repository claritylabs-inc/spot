/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Audit fixture",
      type: "client",
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Fixture carrier",
      policyNumber: "CURRENT",
      insuredName: "Fixture",
      linesOfBusiness: ["CGL"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      isRenewal: false,
      coverages: [],
    });
    const runId = await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: { lease: { id: "lease-A" } },
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    const storageId = await ctx.storage.store(new Blob(["fixture"]));
    return { policyId, runId, storageId };
  });
  return { t, ...ids, expectedRun: { runId: ids.runId, leaseId: "lease-A" } };
}

test("a lease rollover during audit cannot attach old evidence, log, or clear new artifacts", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.runId, {
      pipelineCheckpoint: { lease: { id: "lease-B" } },
    });
  });
  await expect(
    f.t.mutation(internal.policies.pipelineSaveArtifact, {
      jobId: f.policyId,
      expectedRun: f.expectedRun,
      kind: "source_bundle",
      storageId: f.storageId,
      sourceFingerprint: "old-source",
      extractorVersion: "test",
    }),
  ).rejects.toThrow("stale");
  await expect(
    f.t.mutation(internal.policies.pipelineAppendLog, {
      jobId: f.policyId,
      expectedRun: f.expectedRun,
      timestamp: dayjs().valueOf(),
      message: "old audit",
    }),
  ).rejects.toThrow("stale");
  await expect(
    f.t.mutation(internal.policies.pipelineClearArtifacts, {
      jobId: f.policyId,
      expectedRun: f.expectedRun,
    }),
  ).rejects.toThrow("stale");
  expect(
    await f.t.run((ctx) => ctx.db.query("policyExtractionArtifacts").collect()),
  ).toEqual([]);
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).not.toHaveProperty(
    "pipelineLog",
  );
});

test("rollover after artifact persistence still rejects promotion using the original lease", async () => {
  const f = await fixture();
  const artifactId = await f.t.mutation(
    internal.policies.pipelineSaveArtifact,
    {
      jobId: f.policyId,
      expectedRun: f.expectedRun,
      kind: "source_bundle",
      storageId: f.storageId,
      sourceFingerprint: "source-A",
      extractorVersion: "test",
    },
  );
  expect(await f.t.run((ctx) => ctx.db.get(artifactId))).toMatchObject({
    runId: f.runId,
  });
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.runId, {
      pipelineCheckpoint: { lease: { id: "lease-B" } },
    });
  });
  await expect(
    f.t.mutation(internal.policies.promoteCompletedExtractionInternal, {
      id: f.policyId,
      runId: f.runId,
      leaseId: "lease-A",
      sourceBundleArtifactId: artifactId,
      fields: { policyNumber: "OLD-A" },
      evidenceLedger: {},
      completionManifest: {},
    }),
  ).rejects.toThrow("lease is stale");
  expect(await f.t.run((ctx) => ctx.db.get(f.policyId))).toMatchObject({
    policyNumber: "CURRENT",
  });
});

test("a replacement run cannot inherit a prior run's artifact writer even with the same lease label", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.delete(f.runId);
    await ctx.db.insert("policyExtractionRuns", {
      policyId: f.policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: { lease: { id: "lease-A" } },
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
  });
  await expect(
    f.t.mutation(internal.policies.pipelineSaveArtifact, {
      jobId: f.policyId,
      expectedRun: f.expectedRun,
      kind: "source_bundle",
      storageId: f.storageId,
      sourceFingerprint: "source-A",
      extractorVersion: "test",
    }),
  ).rejects.toThrow("stale");
  expect(
    await f.t.run((ctx) => ctx.db.query("policyExtractionArtifacts").collect()),
  ).toEqual([]);
});
