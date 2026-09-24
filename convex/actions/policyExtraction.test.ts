/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import schema from "../schema";
import { extractionSourceFingerprint } from "../lib/extractionPromotion";
import type { PolicySection } from "../lib/policySectioning";
import { RouterJobPending } from "../lib/routerJobClient";
import {
  SECTION_EXTRACTOR_VERSION,
  type DeclarationsSectionOutput,
  type EndorsementSectionOutput,
  type ScheduleSectionOutput,
} from "../lib/sectionExtraction/schemas";
import { sectionInvocationKey } from "../lib/sectionExtraction/sectionJobs";
import type { SourceSpanLike } from "../lib/sourceTree";

const {
  executeDurableRouterRequest,
  cancelDurableRouterRequest,
  slicePdfPages,
  generateObjectForOrg,
} = vi.hoisted(() => ({
  executeDurableRouterRequest: vi.fn(),
  cancelDurableRouterRequest: vi.fn(),
  slicePdfPages: vi.fn(),
  generateObjectForOrg: vi.fn(),
}));
vi.mock("../lib/routerJobClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/routerJobClient")>()),
  executeDurableRouterRequest,
  cancelDurableRouterRequest,
}));
vi.mock("../lib/policySectioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/policySectioning")>()),
  slicePdfPages,
}));
vi.mock("../lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/models")>()),
  generateObjectForOrg,
}));

// Root-anchored so this directory's modules resolve as actions/*.
const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  executeDurableRouterRequest.mockReset();
  cancelDurableRouterRequest.mockReset();
  slicePdfPages.mockReset();
  generateObjectForOrg.mockReset();
});

const plan = {
  version: "policy-section-plan-v1",
  pageCount: 2,
  pageLabels: [],
  sections: [
    { sectionId: "declarations-1-1", kind: "declarations", pageStart: 1, pageEnd: 1, confidence: 1 },
    {
      sectionId: "endorsement-2-2",
      kind: "endorsement",
      pageStart: 2,
      pageEnd: 2,
      confidence: 1,
      formNumber: "CG 20 10",
    },
  ],
  planHash: "plan-1",
};

const declarations: DeclarationsSectionOutput = {
  policyNumber: { value: "GL-100", citations: [{ page: 1, quote: "Policy Number: GL-100" }] },
  namedInsured: { value: "Acme Corp", citations: [{ page: 1, quote: "Acme Corp" }] },
  insurer: {
    value: "Example Insurance Company",
    citations: [{ page: 1, quote: "Example Insurance Company" }],
  },
  broker: null,
  effectiveDate: { value: "01/01/2026", citations: [{ page: 1, quote: "01/01/2026" }] },
  expirationDate: { value: "01/01/2027", citations: [{ page: 1, quote: "01/01/2027" }] },
  retroactiveDate: null,
  programName: null,
  operationsDescription: null,
  premium: null,
  totalCost: null,
  premiumBreakdown: [],
  taxesAndFees: [],
  linesOfBusiness: ["CGL"],
  parties: [],
  insuredDetails: [],
  coverages: [],
  forms: [],
};

const endorsement: EndorsementSectionOutput = { endorsements: [] };

function routerResponse(output: unknown) {
  return {
    requestId: "req-1",
    model: { provider: "openai", model: "gpt-5.6-terra" },
    routing: {
      decision: "routed",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      attemptCount: 1,
      source: "jev",
    },
    usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.01,
    costStatus: "priced",
    output,
    finishReason: "stop",
  };
}

async function seedExtraction(
  t: TestConvex<typeof schema>,
  checkpoint: { nextPhase: string; state?: Record<string, unknown> },
) {
  return await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const userId = await ctx.db.insert("users", { email: "broker@example.com" });
    const fileId = await ctx.storage.store(
      new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" }),
    );
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
        nextPhase: checkpoint.nextPhase,
        state: {
          sourceKind: "upload",
          fileId,
          orgId,
          userId,
          traceId: "trace-1",
          ...checkpoint.state,
        },
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    return { orgId, userId, fileId, policyId, runId, jobId: String(policyId) };
  });
}

type ParsedSource = {
  version: "parsed-source-v1";
  pageCount: number;
  pages: Array<{ page: number; text: string }>;
  sourceSpans: SourceSpanLike[];
  textLayerMissing: boolean;
};

async function seedSectionExtraction(
  t: TestConvex<typeof schema>,
  sectionPlan: typeof plan = plan,
  parsedSource?: ParsedSource,
) {
  const ids = await seedExtraction(t, {
    nextPhase: "extract_sections",
    state: {
      sourceFingerprint: parsedSource
        ? extractionSourceFingerprint(parsedSource.sourceSpans)
        : "fingerprint-1",
      sectionPlanHash: sectionPlan.planHash,
      pageCount: sectionPlan.pageCount,
      sectionAttempts: {},
      sectionRetries: {},
      previewWritten: false,
    },
  });
  await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const artifacts = {
      section_plan: sectionPlan,
      ...(parsedSource ? { parsed_source: parsedSource } : {}),
    };
    for (const [kind, value] of Object.entries(artifacts)) {
      await ctx.db.insert("policyExtractionArtifacts", {
        policyId: ids.policyId,
        kind: kind as "section_plan" | "parsed_source",
        storageId: await ctx.storage.store(new Blob([JSON.stringify(value)])),
        runId: ids.runId,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return ids;
}

async function readState(t: TestConvex<typeof schema>, ids: { runId: Id<"policyExtractionRuns">; policyId: Id<"policies"> }) {
  return await t.run(async (ctx) => ({
    run: await ctx.db.get(ids.runId),
    policy: await ctx.db.get(ids.policyId),
    artifacts: await ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("policy", (q) => q.eq("policyId", ids.policyId))
      .collect(),
    advances: (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (fn) => fn.name === "actions/policyExtraction:advance" && fn.state.kind === "pending",
    ),
  }));
}

function sectionRequest(call: number) {
  const [, operation, payload, invocationKey, , options] =
    executeDurableRouterRequest.mock.calls[call]!;
  return {
    operation,
    payload: payload as {
      maxTokens: number;
      trace: { traceId?: string };
      messages: Array<{ content: Array<{ type: string; text?: string; data?: string; mediaType?: string }> }>;
    },
    invocationKey: invocationKey as string,
    options,
  };
}

describe("extract_sections", () => {
  test("yields while router jobs run, then resumes from stored section results", async () => {
    slicePdfPages.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t);

    executeDurableRouterRequest.mockRejectedValueOnce(new RouterJobPending("pending"));
    const yieldedAt = dayjs().valueOf();
    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    const submitted = sectionRequest(0);
    expect(submitted.operation).toBe("generate");
    expect(submitted.options).toEqual({ wait: "yield" });
    expect(submitted.invocationKey).toMatch(
      new RegExp(`^policy:${ids.runId}:declarations-1-1:[0-9a-f]{16}$`),
    );
    expect(submitted.payload.maxTokens).toBe(32_768);
    expect(submitted.payload.trace.traceId).toBe("trace-1");
    expect(submitted.payload.messages[0]!.content[1]).toMatchObject({
      type: "file",
      mediaType: "application/pdf",
      data: "JVBERg==",
    });
    expect(slicePdfPages).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 1);
    let state = await readState(t, ids);
    expect(state.run?.pipelineStatus).toBe("running");
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "extract_sections" });
    expect(state.run?.pipelineCheckpoint.lease).toBeUndefined();
    expect(state.run?.pipelineCheckpoint.state.routerWaitStartedAt).toBeGreaterThanOrEqual(yieldedAt);
    expect(state.advances).toHaveLength(1);
    expect(state.advances[0]!.scheduledTime - yieldedAt).toBeGreaterThanOrEqual(2_000);
    expect(state.artifacts.filter((artifact) => artifact.kind === "section_result")).toEqual([]);

    executeDurableRouterRequest.mockResolvedValueOnce(routerResponse(declarations));
    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    expect(sectionRequest(1).invocationKey).toBe(submitted.invocationKey);
    state = await readState(t, ids);
    expect(state.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "section_result",
        sectionId: "declarations-1-1",
        runId: ids.runId,
        sourceFingerprint: "fingerprint-1",
        extractorVersion: SECTION_EXTRACTOR_VERSION,
        metadata: expect.objectContaining({ status: "succeeded", planHash: "plan-1" }),
      }),
    ]));
    expect(state.policy).toMatchObject({
      extractionDataStage: "preview",
      carrier: "Example Insurance Company",
      policyNumber: "GL-100",
      insuredName: "Acme Corp",
      extractionPreviewVersion: SECTION_EXTRACTOR_VERSION,
      extractionPreviewModel: "gpt-5.6-terra",
    });
    expect(state.run?.pipelineCheckpoint).toMatchObject({
      nextPhase: "extract_sections",
      state: { previewWritten: true },
    });

    executeDurableRouterRequest.mockResolvedValueOnce(routerResponse(endorsement));
    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    const endorsementRequest = sectionRequest(2);
    expect(endorsementRequest.invocationKey).toMatch(
      new RegExp(`^policy:${ids.runId}:endorsement-2-2:`),
    );
    expect(endorsementRequest.payload.messages[0]!.content[0]!.text).toContain(
      "- Policy number: GL-100",
    );
    state = await readState(t, ids);
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "merge" });
    expect(state.run?.pipelineCheckpoint.state.routerWaitStartedAt).toBeUndefined();
  });

  test("retries a failed section once with a new router job, then fails the run for Resume", async () => {
    slicePdfPages.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t);

    executeDurableRouterRequest.mockRejectedValueOnce(new Error("Router job failed"));
    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    let state = await readState(t, ids);
    expect(state.run?.pipelineStatus).toBe("running");
    expect(state.run?.pipelineCheckpoint.state).toMatchObject({
      sectionAttempts: { "declarations-1-1": 2 },
      sectionRetries: { "declarations-1-1": 1 },
    });
    expect(state.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "section_result",
        metadata: expect.objectContaining({ status: "failed", attempt: 1 }),
      }),
    ]));

    executeDurableRouterRequest.mockRejectedValueOnce(new Error("Router job failed"));
    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    expect(sectionRequest(1).invocationKey).not.toBe(sectionRequest(0).invocationKey);
    state = await readState(t, ids);
    expect(state.run?.pipelineStatus).toBe("error");
    expect(state.run?.pipelineError).toBe(
      "Section extraction failed for declarations pages 1-1: Router job failed. Retry to resume from the completed sections.",
    );
    expect(state.run?.pipelineCheckpoint).toMatchObject({
      nextPhase: "extract_sections",
      state: {
        sectionAttempts: { "declarations-1-1": 3 },
        sectionRetries: { "declarations-1-1": 0 },
      },
    });
  });
});

describe("legacy checkpoints", () => {
  test("restart checkpoints from removed phases or the extraction worker at load_pdf", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedExtraction(t, {
      nextPhase: "extract",
      state: { externalWorker: true, policyVersionKind: "new_policy" },
    });
    await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      await ctx.db.insert("policyExtractionArtifacts", {
        policyId: ids.policyId,
        kind: "external_completion_payload",
        storageId: await ctx.storage.store(new Blob(["{}"])),
        runId: ids.runId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    const state = await readState(t, ids);
    expect(state.run?.pipelineStatus).toBe("running");
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "load_pdf" });
    expect(state.run?.pipelineCheckpoint.state).toEqual({
      sourceKind: "upload",
      fileId: ids.fileId,
      orgId: ids.orgId,
      userId: ids.userId,
      traceId: "trace-1",
      policyVersionKind: "new_policy",
    });
    expect(state.artifacts).toEqual([]);
    expect(state.advances).toHaveLength(1);
  });

  test("continue embed_and_store checkpoints in store_sources without document chunks", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedExtraction(t, { nextPhase: "embed_and_store" });
    await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const payload = {
        documentChunksForEmbedding: [
          { id: "chunk-1", type: "coverage", text: "General Liability", metadata: {} },
        ],
        sourceSpansForStorage: [
          { id: "span-1", documentId: String(ids.policyId), sourceKind: "policy_pdf", pageStart: 1, pageEnd: 1, text: "Policy Number: GL-100" },
        ],
        sourceNodesForStorage: [
          {
            id: "node-1",
            documentId: String(ids.policyId),
            kind: "page",
            title: "Page 1",
            description: "Page 1",
            sourceSpanIds: ["span-1"],
            order: 1,
            path: "1",
          },
        ],
      };
      await ctx.db.insert("policyExtractionArtifacts", {
        policyId: ids.policyId,
        kind: "embedding_payload",
        storageId: await ctx.storage.store(new Blob([JSON.stringify(payload)])),
        runId: ids.runId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    const stored = await t.run(async (ctx) => ({
      spans: await ctx.db.query("sourceSpans").withIndex("policy", (q) => q.eq("policyId", ids.policyId)).collect(),
      nodes: await ctx.db.query("sourceNodes").withIndex("policy", (q) => q.eq("policyId", ids.policyId)).collect(),
      chunks: await ctx.db.query("documentChunks").collect(),
    }));
    expect(stored.spans.map((span) => span.spanId)).toEqual(["span-1"]);
    expect(stored.nodes.map((node) => node.nodeId)).toEqual(["node-1"]);
    expect(stored.chunks).toEqual([]);
    const state = await readState(t, ids);
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "post_process" });
    expect(state.artifacts).toEqual([]);
  });
});

describe("merge", () => {
  const sourceSpans = [
    {
      id: "doc:span:1:0:page",
      documentId: "doc",
      sourceKind: "policy_pdf",
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "page",
      text: "DECLARATIONS\nPolicy Number: GL-100\nNamed Insured: Acme Corp\nInsurer: Example Insurance Company\nGeneral Liability Each Occurrence $1,000,000",
    },
    ...[
      "Policy Number: GL-100",
      "Named Insured: Acme Corp",
      "Insurer: Example Insurance Company",
      "General Liability Each Occurrence $1,000,000",
    ].map((text, index) => ({
      id: `doc:span:1:${index + 1}:line`,
      documentId: "doc",
      sourceKind: "policy_pdf",
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "line",
      parentSpanId: "doc:span:1:0:page",
      text,
    })),
    {
      id: "doc:span:2:5:page",
      documentId: "doc",
      sourceKind: "policy_pdf",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "page",
      text: "VEHICLE SCHEDULE\n1 2022 Ford F-150 1FTFW1E50NFA00001",
    },
    {
      id: "doc:span:2:6:line",
      documentId: "doc",
      sourceKind: "policy_pdf",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "line",
      parentSpanId: "doc:span:2:5:page",
      text: "1 2022 Ford F-150 1FTFW1E50NFA00001",
    },
  ];
  const sectionPlan = {
    ...plan,
    sections: [
      { sectionId: "declarations-1-1", kind: "declarations", pageStart: 1, pageEnd: 1, confidence: 1 },
      { sectionId: "schedule-2-2", kind: "schedule", pageStart: 2, pageEnd: 2, confidence: 1 },
    ],
    planHash: "plan-2",
  };
  const citedDeclarations: DeclarationsSectionOutput = {
    ...declarations,
    namedInsured: { value: "Acme Corp", citations: [{ page: 1, quote: "Named Insured: Acme Corp" }] },
    effectiveDate: null,
    expirationDate: null,
    parties: [
      {
        role: "insurer",
        name: "Example Insurance Company",
        address: null,
        naicNumber: null,
        licenseNumber: null,
        citations: [{ page: 1, quote: "Insurer: Example Insurance Company" }],
      },
    ],
    coverages: [
      {
        name: "General Liability",
        lineOfBusiness: "CGL",
        coverageCode: null,
        limit: "$1,000,000",
        deductible: null,
        premium: null,
        retroactiveDate: null,
        formNumber: null,
        limits: [
          {
            kind: "each_occurrence_limit",
            label: "Each Occurrence",
            value: "$1,000,000",
            appliesTo: null,
            citations: [{ page: 1, quote: "Each Occurrence $1,000,000" }],
          },
        ],
        citations: [{ page: 1, quote: "General Liability" }],
      },
    ],
  };
  const schedule: ScheduleSectionOutput = {
    schedules: [
      {
        name: "Vehicle Schedule",
        kind: "vehicle",
        description: null,
        items: [
          {
            label: "1",
            description: null,
            values: [
              { label: "Year", value: "2022" },
              { label: "Make", value: "Ford" },
              { label: "Model", value: "F-150" },
              { label: "VIN", value: "1FTFW1E50NFA00001" },
            ],
            citations: [{ page: 1, quote: "2022 Ford F-150" }],
          },
        ],
      },
    ],
    coverages: [],
  };

  test("promotes the merged sections with convex-sections-v1 evidence and stores their sources", async () => {
    slicePdfPages.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    generateObjectForOrg.mockRejectedValue(new Error("No model calls in tests"));
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t, sectionPlan, {
      version: "parsed-source-v1",
      pageCount: 2,
      pages: [
        { page: 1, text: sourceSpans[0]!.text },
        { page: 2, text: sourceSpans[5]!.text },
      ],
      sourceSpans,
      textLayerMissing: false,
    });
    executeDurableRouterRequest
      .mockResolvedValueOnce(routerResponse(citedDeclarations))
      .mockResolvedValueOnce(routerResponse(schedule));

    for (let advance = 0; advance < 3; advance += 1) {
      await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });
    }

    let state = await readState(t, ids);
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "store_sources" });
    expect(state.run?.completionManifest).toMatchObject({
      protocolVersion: "convex-sections-v1",
      pageCount: 2,
      sectionPlanHash: "plan-2",
      sections: [
        expect.objectContaining({ id: "declarations-1-1", pageStart: 1, pageEnd: 1 }),
        expect.objectContaining({ id: "schedule-2-2", pageStart: 2, pageEnd: 2 }),
      ],
    });
    expect(state.policy).toMatchObject({
      extractionDataStage: "final",
      policyNumber: "GL-100",
      insuredName: "Acme Corp.",
      coverages: [expect.objectContaining({ name: "General Liability", limit: "$1,000,000" })],
      vehicles: [{ number: 1, year: 2022, make: "Ford", model: "F-150", vin: "1FTFW1E50NFA00001" }],
      coverageSchedules: [expect.objectContaining({ name: "Vehicle Schedule", kind: "vehicle" })],
    });
    expect(state.policy?.operationalProfile.policyNumber.sourceSpanIds).toEqual([
      "doc:span:1:1:line",
    ]);

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    state = await readState(t, ids);
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "post_process" });
    const stored = await t.run(async (ctx) => ({
      spans: await ctx.db.query("sourceSpans").withIndex("policy", (q) => q.eq("policyId", ids.policyId)).collect(),
      chunks: await ctx.db.query("documentChunks").collect(),
    }));
    expect(stored.spans.map((span) => span.spanId).sort()).toEqual(
      sourceSpans.map((span) => span.id).sort(),
    );
    expect(stored.chunks).toEqual([]);
  });

  test("promotes declarations from a scanned PDF on transcribed page evidence", async () => {
    vi.stubEnv("EXTRACTION_PROMOTION_GATE_MODE", "enforce");
    slicePdfPages.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    generateObjectForOrg.mockRejectedValue(new Error("No model calls in tests"));
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(
      t,
      { ...plan, pageCount: 1, sections: [plan.sections[0]!], planHash: "plan-scanned" },
      {
        version: "parsed-source-v1",
        pageCount: 1,
        pages: [{ page: 1, text: "" }],
        sourceSpans: [],
        textLayerMissing: true,
      },
    );
    executeDurableRouterRequest.mockResolvedValueOnce(routerResponse(citedDeclarations));

    for (let advance = 0; advance < 2; advance += 1) {
      await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });
    }

    let state = await readState(t, ids);
    const transcriptionId = expect.stringMatching(
      new RegExp(`^${ids.policyId}:span:1:transcription:[0-9a-f]{12}$`),
    );
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "store_sources" });
    expect(state.policy).toMatchObject({
      extractionDataStage: "final",
      policyNumber: "GL-100",
      coverages: [expect.objectContaining({ name: "General Liability", limit: "$1,000,000" })],
      extractionPromotion: { allowed: true, reasons: [], mode: "enforce" },
    });
    expect(state.policy?.operationalProfile.policyNumber.sourceSpanIds).toEqual([transcriptionId]);
    expect(state.run?.completionManifest.sections).toEqual([
      expect.objectContaining({ id: "declarations-1-1", sourceSpanIds: [transcriptionId] }),
    ]);

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    state = await readState(t, ids);
    expect(state.run?.pipelineCheckpoint).toMatchObject({ nextPhase: "post_process" });
    const stored = await t.run((ctx) =>
      ctx.db.query("sourceSpans").withIndex("policy", (q) => q.eq("policyId", ids.policyId)).collect(),
    );
    expect(stored).toEqual([
      expect.objectContaining({
        spanId: transcriptionId,
        pageStart: 1,
        sourceUnit: "page",
        text: "Policy Number: GL-100 | Named Insured: Acme Corp | Example Insurance Company | Insurer: Example Insurance Company | Each Occurrence $1,000,000 | General Liability",
        metadata: { sourceUnit: "page", textSource: "model_transcription" },
      }),
    ]);
  });
});

describe("cancellation", () => {
  function sectionJobKey(runId: string, section: number, attempt: number) {
    return sectionInvocationKey({
      runId,
      traceId: "trace-1",
      planHash: plan.planHash,
      section: plan.sections[section] as PolicySection,
      attempt,
    });
  }

  async function seedRouterJobs(
    t: TestConvex<typeof schema>,
    jobs: Array<{
      invocationKey: string;
      status: "prepared" | "running" | "succeeded" | "failed" | "cancelled";
    }>,
  ) {
    await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      for (const job of jobs) {
        await ctx.db.insert("routerJobs", {
          ...job,
          operation: "generate",
          fingerprint: "0".repeat(64),
          requestToken: "request-token",
          requestTokenHash: "request-token-hash",
          resultToken: "result-token",
          resultTokenHash: "result-token-hash",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  test("cancelling an extraction cancels the run's in-flight section router jobs", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.policyId, { uploadedBySide: "client" });
      await ctx.db.insert("orgMemberships", { orgId: ids.orgId, userId: ids.userId, role: "admin" });
    });
    const inFlight = [sectionJobKey(ids.runId, 0, 1), sectionJobKey(ids.runId, 1, 1)];
    await seedRouterJobs(t, [
      { invocationKey: inFlight[0]!, status: "running" },
      { invocationKey: inFlight[1]!, status: "prepared" },
      { invocationKey: sectionJobKey(ids.runId, 0, 2), status: "succeeded" },
      { invocationKey: sectionJobKey(ids.runId, 1, 2), status: "cancelled" },
      { invocationKey: "policy:other-run:declarations-1-1:0", status: "running" },
      { invocationKey: "operator:other-run:step-1", status: "running" },
    ]);
    // Best effort: one failed cancellation does not stop the others.
    cancelDurableRouterRequest.mockRejectedValueOnce(new Error("Router unavailable"));

    await t
      .withIdentity({ subject: `${ids.userId}|session` })
      .mutation(api.policies.cancelExtraction, { id: ids.policyId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(cancelDurableRouterRequest.mock.calls.map(([, key]) => key).sort()).toEqual(
      [...inFlight].sort(),
    );
    expect(cancelDurableRouterRequest.mock.settledResults.map((result) => result.type)).toEqual([
      "rejected",
      "fulfilled",
    ]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      scheduled.find((fn) => fn.name === "actions/policyExtraction:cancelSectionJobs")?.state,
    ).toEqual({ kind: "success" });
  });

  test("an advance that finds its run cancelled cancels its in-flight section router jobs", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t);
    const inFlight = sectionJobKey(ids.runId, 0, 1);
    await seedRouterJobs(t, [{ invocationKey: inFlight, status: "running" }]);
    // Operator stops cancel the run and policy without scheduling cancelSectionJobs.
    await t.run(async (ctx) => {
      const cancelled = {
        pipelineStatus: "error" as const,
        pipelineError: "Cancelled by user",
        pipelineCheckpoint: undefined,
      };
      await ctx.db.patch(ids.runId, cancelled);
      await ctx.db.patch(ids.policyId, cancelled);
    });

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    expect(cancelDurableRouterRequest.mock.calls.map(([, key]) => key)).toEqual([inFlight]);
  });

  test("cancels section jobs submitted while a cancel lands mid-advance", async () => {
    slicePdfPages.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const t = convexTest(schema, modules);
    const ids = await seedSectionExtraction(t);
    executeDurableRouterRequest.mockImplementationOnce(
      async (ctx: ActionCtx, operation: "generate", _payload: unknown, invocationKey: string) => {
        await ctx.runMutation(internal.routerJobs.prepare, {
          invocationKey,
          operation,
          fingerprint: "0".repeat(64),
          requestToken: "request-token",
          requestTokenHash: "request-token-hash",
          resultToken: "result-token",
          resultTokenHash: "result-token-hash",
          requestStorageId: await ctx.storage.store(new Blob(["{}"])),
        });
        await ctx.runMutation(internal.policies.pipelineSetStatus, {
          jobId: ids.jobId,
          status: "error",
          error: "Cancelled by user",
        });
        throw new RouterJobPending(invocationKey);
      },
    );

    await t.action(internal.actions.policyExtraction.advance, { jobId: ids.jobId });

    expect(cancelDurableRouterRequest.mock.calls.map(([, key]) => key)).toEqual([
      sectionRequest(0).invocationKey,
    ]);
    const state = await readState(t, ids);
    expect(state.run).toMatchObject({ pipelineStatus: "error", pipelineError: "Cancelled by user" });
    expect(state.artifacts.filter((artifact) => artifact.kind === "section_result")).toEqual([]);
  });
});
