import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildDocumentContext, formatSourceResultTag } from "./agentPrompts";
import { searchPolicySourceEvidence } from "./policyLookup";
import { searchPolicySources, type PolicySearchResult } from "./policySearch";

vi.mock("./policySearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./policySearch")>()),
  searchPolicySources: vi.fn(),
}));

const search = vi.mocked(searchPolicySources);
const ctx = {} as ActionCtx;
const orgId = "org_1" as Id<"organizations">;
const policyId = "policy_a" as Id<"policies">;

const nodeResult: PolicySearchResult = {
  key: "node:policy_a:limits",
  policyId,
  title: "Limits of Insurance",
  kind: "section",
  path: "1.2",
  text: "Each Occurrence Limit $1,000,000",
  pageStart: 3,
  pageEnd: 4,
  sourceSpanIds: ["line-1", "page-3"],
  sourceNodeIds: ["limits"],
  spans: [
    {
      spanId: "line-1",
      pageStart: 3,
      pageEnd: 3,
      sourceUnit: "line",
      parentSpanId: "page-3",
      bbox: [{ page: 3, x: 1, y: 2, width: 3, height: 4 }],
      text: "Each Occurrence Limit $1,000,000",
    },
  ],
  searchRank: 0,
  relevance: 2.8,
};

const spanResult: PolicySearchResult = {
  key: "span:policy_a:7",
  policyId,
  title: "Page 7",
  kind: "source_span",
  text: "Cancellation: 30 days notice.",
  pageStart: 7,
  pageEnd: 7,
  sourceSpanIds: ["line-9"],
  sourceNodeIds: [],
  spans: [],
  searchRank: 1,
};

beforeEach(() => {
  search.mockReset();
});

describe("searchPolicySourceEvidence", () => {
  it("keeps policy lookup result shapes and citation ids", async () => {
    search.mockResolvedValueOnce({
      results: [nodeResult, spanResult],
      ranking: "jev",
      searchedPolicyIds: [policyId],
    });

    const evidence = await searchPolicySourceEvidence(
      ctx,
      { _id: policyId, orgId, policyNumber: "GL-1" },
      "occurrence limit",
      4,
    );

    expect(search).toHaveBeenCalledWith(ctx, {
      orgId,
      policies: [{ _id: policyId, orgId, policyNumber: "GL-1" }],
      query: "occurrence limit",
      maxResults: 4,
    });
    expect(evidence).toEqual([
      {
        title: "Limits of Insurance",
        type: "policy_source_node",
        evidenceSource: "source_tree",
        originalPdfChecked: true,
        confidence: "high",
        pages: "3-4",
        content: "Each Occurrence Limit $1,000,000",
        sourceNodeIds: ["limits"],
        sourceSpanIds: ["line-1", "page-3"],
        sourceSpans: [
          {
            id: "line-1",
            pageStart: 3,
            pageEnd: 3,
            sourceUnit: "line",
            parentSpanId: "page-3",
            bbox: [{ page: 3, x: 1, y: 2, width: 3, height: 4 }],
            text: "Each Occurrence Limit $1,000,000",
          },
        ],
        sourceNodes: [
          {
            id: "limits",
            kind: "section",
            path: "1.2",
            title: "Limits of Insurance",
            sourceSpanIds: ["line-1", "page-3"],
            pageStart: 3,
            pageEnd: 4,
          },
        ],
      },
      {
        title: "Page 7",
        type: "original_pdf_source_span",
        evidenceSource: "original_pdf",
        originalPdfChecked: true,
        confidence: undefined,
        pages: "7",
        content: "Cancellation: 30 days notice.",
        sourceNodeIds: [],
        sourceSpanIds: ["line-9"],
        sourceSpans: [],
      },
    ]);
  });

  it("returns a no-match message instead of an empty list", async () => {
    search.mockResolvedValueOnce({ results: [], ranking: "search", searchedPolicyIds: [policyId] });
    const evidence = await searchPolicySourceEvidence(ctx, { _id: policyId, orgId }, "flood");
    expect(evidence).toMatch(/^No source evidence in this policy matched "flood"/);
  });
});

describe("buildDocumentContext", () => {
  const policy = {
    _id: policyId,
    orgId,
    carrier: "Hartford",
    policyNumber: "GL-1",
    insuredName: "Cove",
    linesOfBusiness: ["CGL"],
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    coverages: [],
    operationalProfile: { coverages: [{ name: "General Liability" }] },
  } as unknown as Doc<"policies">;
  const otherPolicy = {
    ...policy,
    _id: "policy_b" as Id<"policies">,
    policyNumber: "AU-2",
    operationalProfile: undefined,
  } as unknown as Doc<"policies">;

  it("groups ranked source evidence per policy with its operational profile and citation tags", async () => {
    search.mockResolvedValueOnce({
      results: [nodeResult, spanResult],
      ranking: "jev",
      searchedPolicyIds: [policyId, otherPolicy._id],
    });

    const { context, relevantPolicyIds } = await buildDocumentContext(
      ctx,
      orgId,
      [policy, otherPolicy],
      "What is the occurrence limit?",
    );

    expect(relevantPolicyIds).toEqual([policyId]);
    expect(context).toContain("POLICY INDEX (2 bound policies):");
    expect(context).toContain("--- POLICY SOURCE TREE: Hartford #GL-1 (ID:policy_a) ---");
    expect(context).toContain('"name": "General Liability"');
    expect(context).toContain(
      '[sourceNode:limits kind:section path:1.2 title:"Limits of Insurance" pages:3-4 sourceSpanIds:line-1,page-3 score:2.80]\nEach Occurrence Limit $1,000,000',
    );
    expect(context).toContain(
      '[sourceSpan:line-9 title:"Page 7" pages:7 sourceSpanIds:line-9]\nCancellation: 30 days notice.',
    );
    expect(context).not.toContain("#AU-2 (ID:");
  });

  it("falls back to the pre-selected policies when nothing matched", async () => {
    search.mockResolvedValueOnce({ results: [], ranking: "jev", searchedPolicyIds: [policyId] });
    const { context, relevantPolicyIds } = await buildDocumentContext(
      ctx,
      orgId,
      [policy, otherPolicy],
      "flood",
    );
    expect(relevantPolicyIds).toEqual([policyId]);
    expect(context).toContain("Operational profile:");
  });

  it("formats span-only results without a node id", () => {
    expect(formatSourceResultTag({ ...spanResult, relevance: 2 })).toBe(
      '[sourceSpan:line-9 title:"Page 7" pages:7 sourceSpanIds:line-9 score:2.00]',
    );
  });
});
