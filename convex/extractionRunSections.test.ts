/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const declarationsOutput = {
  policyNumber: {
    value: "POL-77",
    citations: [{ page: 1, quote: "Policy Number: POL-77" }],
  },
  coverages: [
    {
      name: "General Liability",
      limit: "$1,000,000",
      citations: [{ page: 2, quote: "not on this page" }],
      limits: [
        {
          label: "Aggregate",
          value: "$2,000,000",
          citations: [{ page: 2, quote: "Aggregate $2,000,000" }],
        },
      ],
    },
  ],
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const clientUserId = await ctx.db.insert("users", {
      email: "member@client.example",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: clientUserId,
      role: "member",
    });
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const policyId = await ctx.db.insert("policies", {
      orgId,
      carrier: "Carrier",
      policyNumber: "POL-77",
      linesOfBusiness: [],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Client",
      pipelineStatus: "running",
    });
    const runId = await ctx.db.insert("policyExtractionRuns", {
      policyId,
      pipelineStatus: "running",
      createdAt: 1,
      updatedAt: 1,
    });
    const sessionId = await ctx.db.insert("policyExtractionTraceSessions", {
      traceId: "trace-1",
      policyId,
      orgId,
      trigger: "upload",
      status: "running",
      startedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      updatedAt: 1,
    });
    const store = async (value: unknown) =>
      await ctx.storage.store(new Blob([JSON.stringify(value)]));
    await ctx.db.insert("policyExtractionArtifacts", {
      policyId,
      runId,
      kind: "section_plan",
      storageId: await store({}),
      metadata: { planHash: "plan-2", sectionCount: 3 },
      createdAt: 1,
      updatedAt: 1,
    });
    const sections = [
      ["declarations-1-2", "declarations", 1, 2, "succeeded", "plan-2"],
      ["endorsement-3-3", "endorsement", 3, 3, "failed", "plan-2"],
      // A result from an older plan of the same run is not current.
      ["other-1-3", "other", 1, 3, "succeeded", "plan-1"],
    ] as const;
    for (const [sectionId, kind, pageStart, pageEnd, status, planHash] of sections) {
      await ctx.db.insert("policyExtractionArtifacts", {
        policyId,
        runId,
        kind: "section_result",
        sectionId,
        sourceFingerprint: "fp",
        extractorVersion: "v",
        storageId: await store({
          version: "section-result-v1",
          sectionId,
          kind,
          pageStart,
          pageEnd,
          status,
          output: kind === "declarations" ? declarationsOutput : undefined,
        }),
        metadata: { sectionId, status, planHash, kind, pageStart, pageEnd },
        createdAt: 2,
        updatedAt: 2,
      });
    }
    const span = (spanId: string, page: number, text: string, y: number) => ({
      orgId,
      policyId,
      spanId,
      documentId: "doc",
      sourceKind: "policy_pdf" as const,
      pageStart: page,
      pageEnd: page,
      sourceUnit: "line",
      text,
      textHash: spanId,
      bbox: [{ page, x: 10, y, width: 100, height: 12 }],
      createdAt: 1,
    });
    await ctx.db.insert("sourceSpans", span("s1", 1, "Policy Number: POL-77", 40));
    await ctx.db.insert("sourceSpans", span("s2", 2, "Aggregate $2,000,000", 80));
    await ctx.db.insert("sourceSpans", span("s3", 5, "Policy Number: POL-77", 40));
    return { clientUserId, operatorUserId, policyId, sessionId };
  });
  const as = (userId: Id<"users">) =>
    t.withIdentity({ subject: `${userId}|session` });
  return { t, as, ...ids };
}

test("lists the current plan's sections and progress for the latest run", async () => {
  const { as, operatorUserId, clientUserId, policyId } = await setup();

  const runs = await as(operatorUserId).query(api.operator.listExtractionRuns, {
    policyId,
  });
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ status: "running", sectionTotal: 3 });
  expect(runs[0].sections).toEqual([
    {
      sectionId: "declarations-1-2",
      kind: "declarations",
      pageStart: 1,
      pageEnd: 2,
      status: "succeeded",
    },
    {
      sectionId: "endorsement-3-3",
      kind: "endorsement",
      pageStart: 3,
      pageEnd: 3,
      status: "failed",
    },
  ]);

  await expect(
    as(clientUserId).query(api.extractionProgress.get, { policyId }),
  ).resolves.toEqual({ done: 1, total: 3 });
  await expect(
    as(clientUserId).query(api.operator.listExtractionRuns, { policyId }),
  ).rejects.toThrow();
});

test("reads section facts with citations resolved to stored spans", async () => {
  const { as, operatorUserId, clientUserId, sessionId } = await setup();
  const args = { runId: sessionId, sectionId: "declarations-1-2" };

  const detail = await as(operatorUserId).action(
    api.operator.getExtractionRunSection,
    args,
  );
  expect(detail?.section).toMatchObject({ kind: "declarations", factCount: 3 });
  expect(detail?.facts).toEqual([
    {
      label: "Policy number",
      value: "POL-77",
      citations: [
        {
          page: 1,
          sourceSpanIds: ["s1"],
          bbox: [{ page: 1, x: 10, y: 40, width: 100, height: 12 }],
        },
      ],
    },
    {
      label: "General Liability",
      value: "$1,000,000",
      // Quote not found on the page: page-level evidence, no span IDs.
      citations: [
        {
          page: 2,
          sourceSpanIds: [],
          bbox: [{ page: 2, x: 10, y: 80, width: 100, height: 12 }],
        },
      ],
    },
    {
      label: "General Liability · Aggregate",
      value: "$2,000,000",
      citations: [
        {
          page: 2,
          sourceSpanIds: ["s2"],
          bbox: [{ page: 2, x: 10, y: 80, width: 100, height: 12 }],
        },
      ],
    },
  ]);

  await expect(
    as(clientUserId).action(api.operator.getExtractionRunSection, args),
  ).rejects.toThrow();
});
