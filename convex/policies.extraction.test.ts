/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildDocumentSourceTree, buildSourceSpan } from "@claritylabs/cl-sdk";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  extractionContractHash,
} from "./lib/extractionPromotion";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

async function seedRunningExtraction(
  t: TestConvex<typeof schema>,
  checkpoint: { nextPhase: string; state: Record<string, unknown> },
) {
  return await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      linesOfBusiness: ["UN"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "Unknown",
      expirationDate: "Unknown",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
      extractionDataStage: "placeholder",
      pipelineStatus: "running",
    });
    const runId = await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      pipelineCheckpoint: {
        ...checkpoint,
        state: { orgId, userId: "user", sourceKind: "upload", ...checkpoint.state },
        createdAt: now,
        lease: { id: "lease-1", phase: checkpoint.nextPhase, expiresAt: now + 60_000, heartbeatAt: now },
      },
      createdAt: now,
      updatedAt: now,
    });
    return { orgId, policyId, runId };
  });
}

describe("convex-sections-v1 promotion", () => {
  const sourceSpans = [
    "Policy Number: GL-100",
    "Property Coverage Limit $1,000,000",
  ].map((text, index) => buildSourceSpan({
    documentId: "policy-1",
    sourceKind: "policy_pdf",
    text,
    pageStart: index + 1,
    pageEnd: index + 1,
    sourceUnit: "text",
  }, index));
  const ledger = buildPromotionEvidenceLedger({
    sourceSpans,
    sourceTree: buildDocumentSourceTree(sourceSpans, "policy-1"),
  });
  const manifest = buildExtractionCompletionManifest({
    extractorVersion: "convex-sections-v1.0",
    ledger,
    pageCount: 2,
    sectionPlanHash: "plan-1",
    sections: [
      {
        id: "declarations-1-1",
        kind: "declarations",
        pageStart: 1,
        pageEnd: 1,
        sourceSpanIds: [sourceSpans[0]!.id],
        resultHash: "result-1",
      },
      {
        id: "coverage_form-2-2",
        kind: "coverage_form",
        pageStart: 2,
        pageEnd: 2,
        sourceSpanIds: [sourceSpans[1]!.id],
        resultHash: "result-2",
      },
    ],
  });
  const fields = {
    carrier: "Example Insurance Company",
    policyNumber: "GL-100",
    insuredName: "Acme Corp",
    operationalProfile: {
      policyNumber: { value: "GL-100", sourceSpanIds: [sourceSpans[0]!.id] },
      coverages: [{ name: "Property", sourceSpanIds: [sourceSpans[1]!.id] }],
    },
  };

  async function seedPromotion(
    sectionStatuses: Record<string, "succeeded" | "failed">,
    completionManifest: Record<string, unknown> = manifest,
  ) {
    const t = convexTest(schema, modules);
    const ids = await seedRunningExtraction(t, { nextPhase: "merge", state: {} });
    const sourceBundleArtifactId = await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const storageId = await ctx.storage.store(new Blob(["{}"]));
      for (const section of manifest.sections) {
        const status = sectionStatuses[section.id];
        if (!status) continue;
        await ctx.db.insert("policyExtractionArtifacts", {
          policyId: ids.policyId,
          kind: "section_result",
          storageId,
          runId: ids.runId,
          sourceFingerprint: manifest.sourceFingerprint,
          extractorVersion: manifest.extractorVersion,
          sectionId: section.id,
          metadata: { status, planHash: "plan-1", resultHash: section.resultHash },
          createdAt: now,
          updatedAt: now,
        });
      }
      return await ctx.db.insert("policyExtractionArtifacts", {
        policyId: ids.policyId,
        kind: "source_bundle",
        storageId,
        runId: ids.runId,
        sourceFingerprint: ledger.sourceFingerprint,
        extractorVersion: manifest.extractorVersion,
        metadata: {
          artifactRole: "promotion_evidence",
          evidenceLedgerHash: ledger.ledgerHash,
          manifestHash: completionManifest.manifestHash,
        },
        createdAt: now,
        updatedAt: now,
      });
    });
    const promote = () =>
      t.mutation(internal.policies.promoteCompletedExtractionInternal, {
        id: ids.policyId,
        runId: ids.runId,
        leaseId: "lease-1",
        sourceBundleArtifactId,
        fields,
        evidenceLedger: ledger,
        completionManifest,
      });
    return { t, ids, promote };
  }

  test("promotes when every section has a persisted successful result", async () => {
    const { t, ids, promote } = await seedPromotion({
      "declarations-1-1": "succeeded",
      "coverage_form-2-2": "succeeded",
    });

    const result = await promote();

    expect(result.promoted).toBe(true);
    expect(result.decision.reasons).toEqual([]);
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));
    expect(policy).toMatchObject({ extractionDataStage: "final", policyNumber: "GL-100" });
  });

  test("refuses to promote without a successful result for every section", async () => {
    const missing = await seedPromotion({ "declarations-1-1": "succeeded" });
    await expect(missing.promote()).rejects.toThrow(
      /section coverage_form-2-2 has no persisted successful result/,
    );

    const failed = await seedPromotion({
      "declarations-1-1": "failed",
      "coverage_form-2-2": "succeeded",
    });
    await expect(failed.promote()).rejects.toThrow(
      /section declarations-1-1 has no persisted successful result/,
    );
    const policy = await failed.t.run((ctx) => ctx.db.get(failed.ids.policyId));
    expect(policy?.extractionDataStage).toBe("placeholder");
  });

  test("refuses manifests from other protocols", async () => {
    const { manifestHash: _hash, ...rest } = manifest;
    const legacy = { ...rest, protocolVersion: "source-tree-v1" };
    const legacyManifest = { ...legacy, manifestHash: extractionContractHash(legacy) };
    const { promote } = await seedPromotion(
      { "declarations-1-1": "succeeded", "coverage_form-2-2": "succeeded" },
      legacyManifest,
    );

    await expect(promote()).rejects.toThrow(/convex-sections-v1/);
  });
});

describe("declarations preview", () => {
  const previewFields = {
    carrier: "Example Insurance Company",
    policyNumber: "GL-100",
    insuredName: "Acme Corp",
    effectiveDate: "01/01/2026",
    pipelineError: "not allowlisted",
  };

  test("writes allowlisted preview fields under the current run lease", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRunningExtraction(t, { nextPhase: "extract_sections", state: {} });

    const stale = await t.mutation(internal.policies.updatePreviewExtractionInternal, {
      id: ids.policyId,
      runId: ids.runId,
      leaseId: "other-lease",
      fields: previewFields,
      previewVersion: "convex-sections-v1.0",
    });
    expect(stale).toEqual({ updated: false, reason: "stale_run" });

    const updated = await t.mutation(internal.policies.updatePreviewExtractionInternal, {
      id: ids.policyId,
      runId: ids.runId,
      leaseId: "lease-1",
      fields: previewFields,
      previewVersion: "convex-sections-v1.0",
      previewModel: "gpt-5.6-terra",
    });
    expect(updated).toEqual({ updated: true });
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));
    expect(policy).toMatchObject({
      extractionDataStage: "preview",
      carrier: "Example Insurance Company",
      policyNumber: "GL-100",
      policyYear: 2026,
      extractionPreviewVersion: "convex-sections-v1.0",
      extractionPreviewModel: "gpt-5.6-terra",
    });
    expect(policy?.pipelineError).toBeUndefined();
  });

  test("never overwrites a final policy", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedRunningExtraction(t, { nextPhase: "extract_sections", state: {} });
    await t.run((ctx) =>
      ctx.db.patch(ids.policyId, {
        extractionDataStage: "final",
        pipelineStatus: "complete",
        carrier: "Final Carrier",
      }),
    );

    const result = await t.mutation(internal.policies.updatePreviewExtractionInternal, {
      id: ids.policyId,
      runId: ids.runId,
      leaseId: "lease-1",
      fields: previewFields,
      previewVersion: "convex-sections-v1.0",
    });

    expect(result).toEqual({ updated: false, reason: "already_final" });
    expect((await t.run((ctx) => ctx.db.get(ids.policyId)))?.carrier).toBe("Final Carrier");
  });
});

test("the stale sweep hands abandoned extraction-worker runs to advance", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(dayjs("2026-09-24T12:00:00.000Z").valueOf());
  const t = convexTest(schema, modules);
  const ids = await seedRunningExtraction(t, {
    nextPhase: "extract",
    state: { externalWorker: true },
  });

  vi.setSystemTime(dayjs().add(6, "minute").valueOf());
  const result = await t.mutation(internal.policies.pipelineRequeueStale, {});

  expect(result.requeued).toEqual([String(ids.policyId)]);
  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled).toEqual([
    expect.objectContaining({
      name: "actions/policyExtraction:advance",
      args: [{ jobId: String(ids.policyId) }],
    }),
  ]);
  const queued = await t.run((ctx) =>
    ctx.db
      .query("policyExtractionQueue")
      .withIndex("policy", (q) => q.eq("policyId", ids.policyId as Id<"policies">))
      .collect(),
  );
  expect(queued).toEqual([]);
});
