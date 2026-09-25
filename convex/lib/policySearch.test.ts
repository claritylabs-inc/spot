import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  buildPolicySearchCandidates,
  normalizePolicySearchQuery,
  RELEVANCE_CRITERIA,
  rankPolicySearchCandidates,
  searchPolicySources,
  selectRankedResults,
  type PolicySearchCandidate,
  type PolicySearchHits,
  type SearchablePolicy,
} from "./policySearch";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const decide = vi.mocked(clRouterDecide);
const orgId = "org_1" as Id<"organizations">;
const policyA = "policy_a" as Id<"policies">;

type Answers = Awaited<ReturnType<typeof clRouterDecide>>["answers"];

function respond(answers: Answers) {
  decide.mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.14.0",
    answers,
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

function score(value: number) {
  return {
    type: "score" as const,
    score: value,
    legend: {},
    probabilities: {},
    confidence: 0.9,
  };
}

function span(overrides: Partial<Doc<"sourceSpans">> & { spanId: string }): Doc<"sourceSpans"> {
  return {
    _id: `row_${overrides.spanId}` as Id<"sourceSpans">,
    _creationTime: 0,
    orgId,
    policyId: policyA,
    documentId: String(overrides.policyId ?? policyA),
    sourceKind: "policy_pdf",
    pageStart: 1,
    pageEnd: 1,
    text: "",
    textHash: overrides.spanId,
    createdAt: 0,
    ...overrides,
  };
}

function node(overrides: Partial<Doc<"sourceNodes">> & { nodeId: string }): Doc<"sourceNodes"> {
  return {
    _id: `row_${overrides.nodeId}` as Id<"sourceNodes">,
    _creationTime: 0,
    orgId,
    policyId: policyA,
    documentId: String(overrides.policyId ?? policyA),
    kind: "section",
    title: overrides.nodeId,
    description: "",
    sourceSpanIds: [],
    order: 0,
    path: "1",
    createdAt: 0,
    ...overrides,
  };
}

function hits(partial: Partial<PolicySearchHits>): PolicySearchHits {
  return { lineSpans: [], otherSpans: [], parents: [], nodes: [], ...partial };
}

function candidate(key: string, searchRank: number): PolicySearchCandidate {
  return {
    key,
    policyId: policyA,
    title: key,
    kind: "section",
    text: `${key} text`,
    sourceSpanIds: [`${key}-span`],
    sourceNodeIds: [key],
    spans: [],
    searchRank,
  };
}

const policy: SearchablePolicy = {
  _id: policyA,
  carrier: "Hartford",
  policyNumber: "GL-1",
  linesOfBusiness: ["CGL"],
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
};

beforeEach(() => {
  decide.mockReset();
});

describe("normalizePolicySearchQuery", () => {
  it("strips question stop words and adds insurance synonyms", () => {
    expect(normalizePolicySearchQuery("What is my deductible for the GL policy?")).toBe(
      "deductible gl retention general liability",
    );
  });

  it("keeps the original tokens when only stop words remain", () => {
    expect(normalizePolicySearchQuery("What is my policy?")).toBe("what is my policy");
  });

  it("caps the query at the Convex search term limit", () => {
    const query = Array.from({ length: 20 }, (_, index) => `term${index}`).join(" ");
    expect(normalizePolicySearchQuery(query).split(" ")).toHaveLength(16);
  });
});

describe("buildPolicySearchCandidates", () => {
  it("collapses span hits into the node that cites them directly or via the parent page span", () => {
    const candidates = buildPolicySearchCandidates(
      hits({
        nodes: [
          node({ nodeId: "document", kind: "document" }),
          node({
            nodeId: "exclusions",
            title: "Exclusions",
            textExcerpt: "This insurance does not apply to expected or intended injury.",
            sourceSpanIds: ["line-7"],
            pageStart: 4,
            pageEnd: 4,
            path: "1.3",
          }),
          node({
            nodeId: "page-2",
            kind: "page",
            title: "Page 2",
            description: "Page 2 | page | ...",
            sourceSpanIds: ["page-2-span"],
            pageStart: 2,
            pageEnd: 2,
          }),
        ],
        lineSpans: [
          span({ spanId: "line-2a", sourceUnit: "line", parentSpanId: "page-2-span", pageStart: 2, text: "Each Occurrence $1,000,000" }),
          span({ spanId: "line-7", sourceUnit: "line", pageStart: 4, text: "expected or intended injury" }),
        ],
      }),
    );

    // page-2 inherits the rank of its best line hit (0); exclusions ranks 1.
    expect(candidates.map((entry) => entry.key)).toEqual([
      "node:policy_a:page-2",
      "node:policy_a:exclusions",
    ]);
    const [page, exclusions] = candidates;
    expect(exclusions).toMatchObject({
      sourceNodeIds: ["exclusions"],
      sourceSpanIds: ["line-7"],
      pageStart: 4,
      path: "1.3",
      text: "This insurance does not apply to expected or intended injury.",
      searchRank: 1,
    });
    // Hit lines lead so citations highlight the precise line before the page.
    expect(page.sourceSpanIds).toEqual(["line-2a", "page-2-span"]);
    expect(page.spans.map((entry) => entry.spanId)).toEqual(["line-2a"]);
    expect(page.searchRank).toBe(0);
  });

  it("groups uncited spans per page with parent-page context and drops duplicates", () => {
    const pageText =
      "COMMERCIAL GENERAL LIABILITY DECLARATIONS Limits of Insurance Each Occurrence Limit $1,000,000 Damage To Premises Rented $100,000 Medical Expense Limit $5,000";
    const candidates = buildPolicySearchCandidates(
      hits({
        lineSpans: [
          span({ spanId: "l1", sourceUnit: "line", parentSpanId: "p3", pageStart: 3, pageEnd: 3, text: "Each Occurrence Limit $1,000,000" }),
          span({ spanId: "l1", sourceUnit: "line", parentSpanId: "p3", pageStart: 3, text: "Each Occurrence Limit $1,000,000" }),
          span({ spanId: "l2", sourceUnit: "line", parentSpanId: "p3", pageStart: 3, text: "Medical Expense Limit $5,000" }),
        ],
        otherSpans: [
          span({ spanId: "section-dup", sourceUnit: "section_candidate", pageStart: 3, text: "Each Occurrence Limit $1,000,000" }),
          span({ spanId: "no-policy", policyId: undefined, text: "Each Occurrence" }),
        ],
        parents: [{ spanId: "p3", text: pageText }],
      }),
    );

    expect(candidates).toHaveLength(1);
    const [page] = candidates;
    expect(page).toMatchObject({
      key: "span:policy_a:3",
      policyId: policyA,
      kind: "source_span",
      title: "Page 3",
      pageStart: 3,
      sourceNodeIds: [],
      sourceSpanIds: ["l1", "l2"],
      searchRank: 0,
    });
    // The second line already sits inside the first line's page window.
    expect(page.text).toBe(pageText);
  });

  it("cuts long page spans around the first query term", () => {
    const filler = "Lorem ipsum dolor sit amet. ".repeat(100);
    const [page] = buildPolicySearchCandidates(
      hits({
        otherSpans: [
          span({ spanId: "p9", pageStart: 9, text: `${filler}Cancellation: 30 days notice. ${filler}` }),
        ],
      }),
      "cancellation notice",
    );
    expect(page.text.startsWith("…")).toBe(true);
    expect(page.text).toContain("Cancellation: 30 days notice.");
    expect(page.text.length).toBeLessThanOrEqual(1602);
  });
});

describe("selectRankedResults", () => {
  it("keeps relevant candidates ordered by score then search rank", () => {
    const selected = selectRankedResults(
      [
        { ...candidate("a", 0), relevance: 1.2 },
        { ...candidate("b", 1), relevance: 2.4 },
        { ...candidate("c", 2), relevance: 2.9 },
        { ...candidate("d", 3), relevance: 2.4 },
      ],
      2,
    );
    expect(selected.map((entry) => entry.key)).toEqual(["c", "b"]);
  });

  it("falls back to the top three when nothing is relevant", () => {
    const selected = selectRankedResults(
      [0.2, 1.1, 0.4, 1.9, 0].map((relevance, index) => ({
        ...candidate(`c${index}`, index),
        relevance,
      })),
      8,
    );
    expect(selected.map((entry) => entry.key)).toEqual(["c3", "c1", "c2"]);
  });
});

describe("rankPolicySearchCandidates", () => {
  const ctx = {} as ActionCtx;

  it("asks one score question per candidate in a single decide call", async () => {
    respond({ passage_0: score(0.4), passage_1: score(2.8) });
    const { results, ranking } = await rankPolicySearchCandidates(ctx, {
      orgId,
      query: "What is the occurrence limit?",
      candidates: [candidate("a", 0), { ...candidate("b", 1), pageStart: 2 }],
      policyLabel: "Carrier #1",
      maxResults: 5,
      traceId: "trace-1",
    });

    expect(decide).toHaveBeenCalledTimes(1);
    const [request, options] = decide.mock.calls[0]!;
    expect(options).toEqual({ telemetry: ctx });
    expect(request.trace).toEqual({ traceId: "trace-1" });
    expect(Object.keys(request.questions)).toEqual(["passage_0", "passage_1"]);
    expect(request.questions.passage_0).toMatchObject({
      type: "score",
      criteria: RELEVANCE_CRITERIA,
    });
    expect(request.state).toMatchObject({
      question: "What is the occurrence limit?",
      policy: "Carrier #1",
      passages: [
        { id: "passage_0", title: "a", pages: null, text: "a text" },
        { id: "passage_1", title: "b", pages: "2", text: "b text" },
      ],
    });
    expect(ranking).toBe("jev");
    expect(results.map((entry) => [entry.key, entry.relevance])).toEqual([["b", 2.8]]);
  });

  it("falls back to search order when the router fails", async () => {
    decide.mockRejectedValueOnce(new Error("router down"));
    const { results, ranking } = await rankPolicySearchCandidates(ctx, {
      orgId,
      query: "limit",
      candidates: [candidate("a", 0), candidate("b", 1), candidate("c", 2)],
      policyLabel: "Carrier #1",
      maxResults: 2,
    });
    expect(ranking).toBe("search");
    expect(results.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(results[0]!.relevance).toBeUndefined();
  });
});

describe("searchPolicySources", () => {
  function fakeCtx() {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const runQuery = vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      calls.push({ name, args });
      if (name === "sourceNodes:searchInternal") {
        return [
          node({
            nodeId: "limits",
            title: "Limits of Insurance",
            textExcerpt: "Each Occurrence Limit $1,000,000",
            sourceSpanIds: ["span-limits"],
            pageStart: 3,
            pageEnd: 3,
          }),
        ];
      }
      if (name === "sourceSpans:searchInternal") {
        return {
          spans:
            args.sourceUnit === "line"
              ? [span({ spanId: "line-agg", sourceUnit: "line", pageStart: 5, text: "Aggregate Limit" })]
              : [],
          parents: [],
        };
      }
      throw new Error(`unexpected query ${name}`);
    });
    return { ctx: { runQuery } as unknown as ActionCtx, calls };
  }

  it("searches the policy by policyId and returns Jev-ranked, source-backed results", async () => {
    const { ctx, calls } = fakeCtx();
    respond({ passage_0: score(3), passage_1: score(0.5) });

    const outcome = await searchPolicySources(ctx, {
      orgId,
      policy,
      query: "What is my occurrence limit?",
      maxResults: 5,
    });

    expect(calls.map((call) => call.args)).toEqual([
      { policyId: policyA, sourceUnit: "line", query: "occurrence limit", limit: 25 },
      { policyId: policyA, query: "occurrence limit", limit: 15 },
      { policyId: policyA, query: "occurrence limit", limit: 20 },
    ]);
    const [request] = decide.mock.calls[0]!;
    expect(request.task).toBe("policy_source_search");
    expect(request.state).toMatchObject({
      policy: "Hartford #GL-1 | General Liability | 2026-01-01 to 2027-01-01",
    });
    expect(outcome.ranking).toBe("jev");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({
      policyId: policyA,
      sourceNodeIds: ["limits"],
      sourceSpanIds: ["span-limits"],
      pageStart: 3,
      relevance: 3,
    });
  });

  it("returns search-order results when the router fails", async () => {
    const { ctx } = fakeCtx();
    decide.mockRejectedValueOnce(new Error("router down"));

    const outcome = await searchPolicySources(ctx, {
      orgId,
      policy,
      query: "occurrence limit",
      maxResults: 5,
    });

    expect(outcome.ranking).toBe("search");
    expect(outcome.results.map((entry) => entry.key)).toEqual([
      "node:policy_a:limits",
      "span:policy_a:5",
    ]);
  });

  it("skips search and ranking for an empty query", async () => {
    const { ctx, calls } = fakeCtx();
    const outcome = await searchPolicySources(ctx, { orgId, policy, query: "?!", maxResults: 5 });
    expect(outcome).toEqual({ results: [], ranking: "search" });
    expect(calls).toHaveLength(0);
    expect(decide).not.toHaveBeenCalled();
  });
});
