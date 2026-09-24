/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
    const otherOrgId = await ctx.db.insert("organizations", { name: "Other", type: "client" });
    const insertPolicy = (org: Id<"organizations">, policyNumber: string) =>
      ctx.db.insert("policies", {
        orgId: org,
        carrier: "Hartford",
        policyNumber,
        insuredName: "Cove",
        linesOfBusiness: ["CGL"],
        effectiveDate: "01/01/2026",
        expirationDate: "01/01/2027",
        documentType: "policy",
        policyYear: 2026,
        isRenewal: false,
        coverages: [],
        pipelineStatus: "complete",
        extractionDataStage: "final",
      });
    const policyA = await insertPolicy(orgId, "GL-A");
    const policyB = await insertPolicy(orgId, "GL-B");
    const otherPolicy = await insertPolicy(otherOrgId, "GL-X");

    const insertSpan = (
      org: Id<"organizations">,
      policyId: Id<"policies">,
      spanId: string,
      text: string,
      extra: { sourceUnit?: string; parentSpanId?: string } = {},
    ) =>
      ctx.db.insert("sourceSpans", {
        orgId: org,
        policyId,
        spanId,
        documentId: String(policyId),
        sourceKind: "policy_pdf",
        pageStart: 2,
        pageEnd: 2,
        text,
        textHash: spanId,
        createdAt: 0,
        ...extra,
      });
    await insertSpan(orgId, policyA, "a-page-2", "Limits of Insurance Each Occurrence Limit $1,000,000 General Aggregate $2,000,000");
    await insertSpan(orgId, policyA, "a-line-1", "Each Occurrence Limit $1,000,000", {
      sourceUnit: "line",
      parentSpanId: "a-page-2",
    });
    await insertSpan(orgId, policyB, "b-line-1", "Each Occurrence Limit $500,000", {
      sourceUnit: "line",
    });
    await insertSpan(otherOrgId, otherPolicy, "x-line-1", "Each Occurrence Limit $9,000,000", {
      sourceUnit: "line",
    });

    const insertNode = (org: Id<"organizations">, policyId: Id<"policies">, nodeId: string, description: string) =>
      ctx.db.insert("sourceNodes", {
        orgId: org,
        policyId,
        nodeId,
        documentId: String(policyId),
        kind: "section",
        title: nodeId,
        description,
        sourceSpanIds: [],
        order: 0,
        path: "1",
        createdAt: 0,
      });
    await insertNode(orgId, policyA, "a-exclusions", "Exclusions | section | Expected or intended injury");
    await insertNode(orgId, policyB, "b-exclusions", "Exclusions | section | Contractual liability");
    await insertNode(otherOrgId, otherPolicy, "x-exclusions", "Exclusions | section | Pollution");
    return { policyA, policyB };
  });
  return { t, ...ids };
}

describe("source search indexes", () => {
  test("span search is scoped to one policy and optionally a source unit", async () => {
    const { t, policyA } = await seed();

    const policySpans = await t.query(internal.sourceSpans.searchInternal, {
      policyId: policyA,
      query: "occurrence limit",
      limit: 10,
    });
    expect(policySpans.spans.map((span) => span.spanId).sort()).toEqual([
      "a-line-1",
      "a-page-2",
    ]);

    const policyLines = await t.query(internal.sourceSpans.searchInternal, {
      policyId: policyA,
      sourceUnit: "line",
      query: "occurrence limit",
      limit: 10,
    });
    expect(policyLines.spans.map((span) => span.spanId)).toEqual(["a-line-1"]);
    expect(policyLines.parents).toEqual([
      {
        spanId: "a-page-2",
        text: "Limits of Insurance Each Occurrence Limit $1,000,000 General Aggregate $2,000,000",
      },
    ]);
  });

  test("node search matches descriptions within one policy", async () => {
    const { t, policyA, policyB } = await seed();

    const policyNodes = await t.query(internal.sourceNodes.searchInternal, {
      policyId: policyB,
      query: "exclusions",
      limit: 10,
    });
    expect(policyNodes.map((node) => node.nodeId)).toEqual(["b-exclusions"]);

    const noMatch = await t.query(internal.sourceNodes.searchInternal, {
      policyId: policyA,
      query: "contractual",
      limit: 10,
    });
    expect(noMatch).toEqual([]);
  });
});
