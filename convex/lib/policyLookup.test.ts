import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
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
    search.mockResolvedValueOnce({ results: [nodeResult, spanResult], ranking: "jev" });

    const evidence = await searchPolicySourceEvidence(
      ctx,
      { _id: policyId, orgId, policyNumber: "GL-1" },
      "occurrence limit",
      4,
    );

    expect(search).toHaveBeenCalledWith(ctx, {
      orgId,
      policy: { _id: policyId, orgId, policyNumber: "GL-1" },
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
    search.mockResolvedValueOnce({ results: [], ranking: "search" });
    const evidence = await searchPolicySourceEvidence(ctx, { _id: policyId, orgId }, "flood");
    expect(evidence).toMatch(/^No source evidence in this policy matched "flood"/);
  });
});
