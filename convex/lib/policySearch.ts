"use node";

// Agent policy search: Convex full-text search over source spans and source
// nodes for candidates, then one batched Jev (clRouterDecide) relevance pass.
// Results stay source-backed (policyId, sourceSpanIds, sourceNodeIds, pages).

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import { clRouterDecide } from "./clRouterClient";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import { normalizedSearchText, tokenizeSearchText } from "./searchTokenizer";

const LINE_SPAN_LIMIT = 25;
const OTHER_SPAN_LIMIT = 15;
const NODE_LIMIT = 20;
const MAX_CANDIDATES = 60;
const MAX_QUERY_TERMS = 16;
const CANDIDATE_TEXT_CHARS = 1600;
const JEV_PASSAGE_CHARS = 700;
const LINE_CONTEXT_BEFORE_CHARS = 200;
const LINE_CONTEXT_AFTER_CHARS = 300;

/** Minimum Jev relevance (expected rubric level) for a candidate to count as an answer. */
export const MIN_RELEVANCE = 2;
/** Results kept, by relevance, when no candidate reaches MIN_RELEVANCE. */
export const FALLBACK_RESULT_COUNT = 3;
/** Orgs with more policies than this get a Jev policy pre-selection before search. */
export const POLICY_PRESELECTION_THRESHOLD = 8;
const MAX_PRESELECTED_POLICIES = 5;
const MIN_POLICY_RELEVANCE = 1;

export const RELEVANCE_CRITERIA = [
  "Irrelevant: the passage does not concern the question.",
  "Related topic: the passage is about the same subject but does not help answer the question.",
  "Partially answers: the passage contains some of the wording or values needed to answer the question.",
  "Directly answers: the passage contains the specific wording or value that answers the question.",
];

const POLICY_RELEVANCE_CRITERIA = [
  "Unrelated: this policy cannot contain the answer.",
  "Possibly relevant: this policy might contain the answer.",
  "Likely relevant: this policy's lines of business, coverages, or terms match the question.",
];

const QUERY_STOP_WORDS = new Set([
  "a", "am", "an", "and", "any", "are", "can", "could", "did", "do", "does",
  "for", "from", "has", "have", "how", "i", "in", "is", "it", "me", "my", "of",
  "on", "or", "our", "please", "policies", "policy", "show", "tell", "that",
  "the", "there", "this", "to", "us", "we", "what", "whats", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your",
]);

const QUERY_SYNONYMS: Record<string, string[]> = {
  auto: ["automobile"],
  cancel: ["cancellation"],
  comp: ["compensation"],
  deductible: ["retention"],
  gl: ["general", "liability"],
  retention: ["deductible"],
  wc: ["workers", "compensation"],
};

export type SearchablePolicy = {
  _id: Id<"policies">;
  carrier?: string;
  security?: string;
  policyNumber?: string;
  linesOfBusiness?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  insuredName?: string;
  summary?: string;
};

export type PolicySearchSpan = {
  spanId: string;
  pageStart?: number;
  pageEnd?: number;
  sourceUnit?: string;
  parentSpanId?: string;
  bbox?: unknown;
  text: string;
};

export type PolicySearchCandidate = {
  key: string;
  policyId: Id<"policies">;
  title: string;
  /** Source-node kind, or "source_span" for spans with no matching node. */
  kind: string;
  path?: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  sourceSpanIds: string[];
  sourceNodeIds: string[];
  /** Span hits collapsed into this candidate. */
  spans: PolicySearchSpan[];
  /** Best position among the search hits behind this candidate (0 = best). */
  searchRank: number;
};

export type PolicySearchResult = PolicySearchCandidate & {
  /** Jev expected rubric level (0-3); absent when ranking fell back to search order. */
  relevance?: number;
};

export type PolicySearchOutcome = {
  results: PolicySearchResult[];
  ranking: "jev" | "search";
  searchedPolicyIds: Id<"policies">[];
};

export type PolicySearchHits = {
  lineSpans: Doc<"sourceSpans">[];
  otherSpans: Doc<"sourceSpans">[];
  parents: Array<{ spanId: string; text: string }>;
  nodes: Doc<"sourceNodes">[];
};

export function normalizePolicySearchQuery(query: string): string {
  const tokens = tokenizeSearchText(query);
  const kept = tokens.filter((token) => !QUERY_STOP_WORDS.has(token));
  const base = kept.length > 0 ? kept : tokens;
  const terms = new Set(base);
  for (const token of base) {
    for (const synonym of QUERY_SYNONYMS[token] ?? []) terms.add(synonym);
  }
  return [...terms].slice(0, MAX_QUERY_TERMS).join(" ");
}

export function policySearchLabel(policy: SearchablePolicy): string {
  const lines =
    policyLobCodes(policy)
      .map((code) => lobLabel(code))
      .join(", ") || "unknown";
  return `${policy.carrier || policy.security || "Unknown carrier"} #${policy.policyNumber ?? "unknown"} | ${lines} | ${policy.effectiveDate ?? "?"} to ${policy.expirationDate ?? "continuous"}`;
}

export function candidatePages(candidate: {
  pageStart?: number;
  pageEnd?: number;
}): string | undefined {
  if (!candidate.pageStart) return undefined;
  return candidate.pageEnd && candidate.pageEnd !== candidate.pageStart
    ? `${candidate.pageStart}-${candidate.pageEnd}`
    : String(candidate.pageStart);
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toSearchSpan(span: Doc<"sourceSpans">): PolicySearchSpan {
  return {
    spanId: span.spanId,
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sourceUnit: span.sourceUnit,
    parentSpanId: span.parentSpanId,
    bbox: span.bbox,
    text: span.text,
  };
}

function excerpt(text: string, start: number, end: number): string {
  const from = Math.max(0, start);
  const to = Math.min(text.length, end);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/** A line hit inside its surrounding page text, so the ranker sees more than one PDF line. */
function lineContext(span: PolicySearchSpan, parentText?: string): string {
  const index = parentText ? parentText.indexOf(span.text) : -1;
  if (!parentText || index < 0) return span.text;
  return excerpt(
    parentText,
    index - LINE_CONTEXT_BEFORE_CHARS,
    index + span.text.length + LINE_CONTEXT_AFTER_CHARS,
  );
}

/** Long page/section spans are cut around the first query term instead of from the top of the page. */
function focusedText(text: string, queryTerms: string[]): string {
  if (text.length <= CANDIDATE_TEXT_CHARS) return text;
  const lower = text.toLocaleLowerCase("und");
  const hits = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0);
  const first = hits.length > 0 ? Math.min(...hits) : 0;
  const start = Math.max(0, first - LINE_CONTEXT_BEFORE_CHARS);
  return excerpt(text, start, start + CANDIDATE_TEXT_CHARS);
}

function spanCandidateText(
  spans: PolicySearchSpan[],
  parentTextBySpanId: Map<string, string>,
  queryTerms: string[],
): string {
  const snippets: string[] = [];
  for (const span of spans) {
    if (snippets.some((snippet) => snippet.includes(span.text))) continue;
    snippets.push(
      span.sourceUnit === "line"
        ? lineContext(
            span,
            span.parentSpanId ? parentTextBySpanId.get(span.parentSpanId) : undefined,
          )
        : focusedText(span.text, queryTerms),
    );
  }
  return truncate(snippets.join("\n"), CANDIDATE_TEXT_CHARS);
}

/**
 * Turns raw search hits into ranked-ready candidates: nodes first, span hits
 * collapsed into the node that cites them (directly or via their parent page
 * span), remaining spans grouped per policy page, duplicates dropped.
 */
export function buildPolicySearchCandidates(
  hits: PolicySearchHits,
  options: { allowedPolicyIds?: ReadonlySet<string>; searchText?: string } = {},
): PolicySearchCandidate[] {
  const { allowedPolicyIds } = options;
  const queryTerms = tokenizeSearchText(options.searchText ?? "", { minimumLength: 3 });
  const allowed = (policyId: Id<"policies"> | undefined): policyId is Id<"policies"> =>
    Boolean(policyId) && (!allowedPolicyIds || allowedPolicyIds.has(String(policyId)));
  const candidates: PolicySearchCandidate[] = [];
  const nodeCandidateBySpan = new Map<string, PolicySearchCandidate>();
  const seenNodes = new Set<string>();

  hits.nodes.forEach((node, rank) => {
    if (!allowed(node.policyId) || node.kind === "document") return;
    const key = `node:${node.policyId}:${node.nodeId}`;
    if (seenNodes.has(key)) return;
    seenNodes.add(key);
    const candidate: PolicySearchCandidate = {
      key,
      policyId: node.policyId,
      title: node.title,
      kind: node.kind,
      path: node.path || undefined,
      text: truncate(node.textExcerpt || node.description, CANDIDATE_TEXT_CHARS),
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      sourceSpanIds: [...node.sourceSpanIds],
      sourceNodeIds: [node.nodeId],
      spans: [],
      searchRank: rank,
    };
    candidates.push(candidate);
    for (const spanId of node.sourceSpanIds) {
      const spanKey = `${node.policyId}:${spanId}`;
      if (!nodeCandidateBySpan.has(spanKey)) nodeCandidateBySpan.set(spanKey, candidate);
    }
  });

  const spanHits = [
    ...hits.lineSpans.map((span, rank) => ({ span, rank })),
    ...hits.otherSpans.map((span, rank) => ({ span, rank })),
  ].sort((left, right) => left.rank - right.rank);
  const spanCandidates = new Map<string, PolicySearchCandidate>();
  const seenSpans = new Set<string>();
  const seenTexts = new Set<string>();

  for (const { span, rank } of spanHits) {
    const policyId = span.policyId;
    if (!allowed(policyId)) continue;
    const spanKey = `${policyId}:${span.spanId}`;
    const textKey = `${policyId}:${span.pageStart ?? ""}:${normalizedSearchText(span.text)}`;
    if (seenSpans.has(spanKey) || seenTexts.has(textKey)) continue;
    seenSpans.add(spanKey);
    seenTexts.add(textKey);

    let candidate =
      nodeCandidateBySpan.get(spanKey) ??
      (span.parentSpanId
        ? nodeCandidateBySpan.get(`${policyId}:${span.parentSpanId}`)
        : undefined);
    if (!candidate) {
      const groupKey = `span:${policyId}:${span.pageStart ?? span.spanId}`;
      candidate = spanCandidates.get(groupKey);
      if (!candidate) {
        candidate = {
          key: groupKey,
          policyId,
          title: span.pageStart ? `Page ${span.pageStart}` : "Source text",
          kind: "source_span",
          text: "",
          pageStart: span.pageStart,
          pageEnd: span.pageEnd,
          sourceSpanIds: [],
          sourceNodeIds: [],
          spans: [],
          searchRank: rank,
        };
        spanCandidates.set(groupKey, candidate);
        candidates.push(candidate);
      }
    }
    candidate.spans.push(toSearchSpan(span));
    candidate.searchRank = Math.min(candidate.searchRank, rank);
  }

  const parentTextBySpanId = new Map(
    hits.parents.map((parent) => [parent.spanId, parent.text]),
  );
  for (const candidate of candidates) {
    candidate.sourceSpanIds = unique([
      ...candidate.spans.map((span) => span.spanId),
      ...candidate.sourceSpanIds,
    ]);
    if (candidate.kind === "source_span") {
      candidate.text = spanCandidateText(
        candidate.spans,
        parentTextBySpanId,
        queryTerms,
      );
    }
  }

  // Stable sort keeps nodes ahead of span groups on equal rank.
  return candidates
    .sort((left, right) => left.searchRank - right.searchRank)
    .slice(0, MAX_CANDIDATES);
}

/** Orders Jev-scored candidates: relevant (>= MIN_RELEVANCE) by score then search rank, else the best few. */
export function selectRankedResults(
  scored: Array<PolicySearchCandidate & { relevance: number }>,
  maxResults: number,
): PolicySearchResult[] {
  const ordered = [...scored].sort(
    (left, right) =>
      right.relevance - left.relevance || left.searchRank - right.searchRank,
  );
  const relevant = ordered.filter(
    (candidate) => candidate.relevance >= MIN_RELEVANCE,
  );
  return (relevant.length > 0 ? relevant : ordered.slice(0, FALLBACK_RESULT_COUNT)).slice(
    0,
    maxResults,
  );
}

export async function rankPolicySearchCandidates(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    query: string;
    candidates: PolicySearchCandidate[];
    policyLabels: Map<string, string>;
    maxResults: number;
    traceId?: string;
  },
): Promise<{ results: PolicySearchResult[]; ranking: "jev" | "search" }> {
  const { candidates } = args;
  if (candidates.length === 0) return { results: [], ranking: "search" };
  const questions: Record<string, DecisionQuestion> = {};
  candidates.forEach((_, index) => {
    questions[`passage_${index}`] = {
      type: "score",
      instructions: `How well does passage passage_${index} in state.passages answer state.question? Judge only the passage text.`,
      criteria: RELEVANCE_CRITERIA,
    };
  });

  try {
    const result = await clRouterDecide(
      {
        orgId: String(args.orgId),
        task: "policy_source_search",
        state: {
          question: args.query,
          passages: candidates.map((candidate, index) => ({
            id: `passage_${index}`,
            policy: args.policyLabels.get(String(candidate.policyId)) ?? null,
            title: candidate.title,
            pages: candidatePages(candidate) ?? null,
            text: truncate(candidate.text, JEV_PASSAGE_CHARS),
          })),
        },
        questions,
        trace: args.traceId ? { traceId: args.traceId } : undefined,
      },
      { telemetry: ctx },
    );
    const scored = candidates.map((candidate, index) => {
      const answer = result.answers[`passage_${index}`];
      return {
        ...candidate,
        relevance: answer?.type === "score" ? answer.score : 0,
      };
    });
    return { results: selectRankedResults(scored, args.maxResults), ranking: "jev" };
  } catch {
    return { results: candidates.slice(0, args.maxResults), ranking: "search" };
  }
}

/** Jev pick of the policies worth searching in a large org; null when the router fails. */
export async function preselectPoliciesForQuery(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    query: string;
    policies: SearchablePolicy[];
    traceId?: string;
  },
): Promise<SearchablePolicy[] | null> {
  const questions: Record<string, DecisionQuestion> = {};
  args.policies.forEach((_, index) => {
    questions[`policy_${index}`] = {
      type: "score",
      instructions: `How likely is policy policy_${index} in state.policies to contain the answer to state.question?`,
      criteria: POLICY_RELEVANCE_CRITERIA,
    };
  });
  try {
    const result = await clRouterDecide(
      {
        orgId: String(args.orgId),
        task: "policy_search_scope",
        state: {
          question: args.query,
          policies: args.policies.map((policy, index) => ({
            id: `policy_${index}`,
            policy: policySearchLabel(policy),
            insured: policy.insuredName ?? null,
            summary: policy.summary ? truncate(policy.summary, 300) : null,
          })),
        },
        questions,
        trace: args.traceId ? { traceId: args.traceId } : undefined,
      },
      { telemetry: ctx },
    );
    const ordered = args.policies
      .map((policy, index) => {
        const answer = result.answers[`policy_${index}`];
        return { policy, index, score: answer?.type === "score" ? answer.score : 0 };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const likely = ordered.filter((entry) => entry.score >= MIN_POLICY_RELEVANCE);
    return (likely.length > 0 ? likely : ordered.slice(0, FALLBACK_RESULT_COUNT))
      .slice(0, MAX_PRESELECTED_POLICIES)
      .map((entry) => entry.policy);
  } catch {
    return null;
  }
}

function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) if (index < list.length) merged.push(list[index]);
  }
  return merged;
}

async function searchHits(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policyId: Id<"policies"> | undefined,
  query: string,
): Promise<PolicySearchHits> {
  const [lines, others, nodes] = await Promise.all([
    ctx.runQuery(internal.sourceSpans.searchInternal, {
      orgId,
      policyId,
      sourceUnit: "line",
      query,
      limit: LINE_SPAN_LIMIT,
    }),
    ctx.runQuery(internal.sourceSpans.searchInternal, {
      orgId,
      policyId,
      query,
      limit: OTHER_SPAN_LIMIT,
    }),
    ctx.runQuery(internal.sourceNodes.searchInternal, {
      orgId,
      policyId,
      query,
      limit: NODE_LIMIT,
    }),
  ]);
  return {
    lineSpans: lines.spans,
    otherSpans: others.spans,
    parents: [...lines.parents, ...others.parents],
    nodes,
  };
}

/**
 * Searches the given policies' source evidence for `query` and returns the
 * Jev-ranked, source-backed results. Never throws on router failure.
 */
export async function searchPolicySources(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    policies: SearchablePolicy[];
    query: string;
    maxResults: number;
    traceId?: string;
  },
): Promise<PolicySearchOutcome> {
  const searchText = normalizePolicySearchQuery(args.query);
  if (!searchText || args.policies.length === 0) {
    return { results: [], ranking: "search", searchedPolicyIds: [] };
  }

  const preselected =
    args.policies.length > POLICY_PRESELECTION_THRESHOLD
      ? await preselectPoliciesForQuery(ctx, {
          orgId: args.orgId,
          query: args.query,
          policies: args.policies,
          traceId: args.traceId,
        })
      : null;
  const scope = preselected ?? args.policies;
  const allowedPolicyIds = new Set(scope.map((policy) => String(policy._id)));

  let hits: PolicySearchHits;
  if (scope.length === 1 || preselected) {
    const perPolicy = await Promise.all(
      scope.map((policy) => searchHits(ctx, args.orgId, policy._id, searchText)),
    );
    hits = {
      lineSpans: interleave(perPolicy.map((entry) => entry.lineSpans)),
      otherSpans: interleave(perPolicy.map((entry) => entry.otherSpans)),
      parents: perPolicy.flatMap((entry) => entry.parents),
      nodes: interleave(perPolicy.map((entry) => entry.nodes)),
    };
  } else {
    hits = await searchHits(ctx, args.orgId, undefined, searchText);
  }

  const candidates = buildPolicySearchCandidates(hits, {
    allowedPolicyIds,
    searchText,
  });
  const { results, ranking } = await rankPolicySearchCandidates(ctx, {
    orgId: args.orgId,
    query: args.query,
    candidates,
    policyLabels: new Map(
      scope.map((policy) => [String(policy._id), policySearchLabel(policy)]),
    ),
    maxResults: args.maxResults,
    traceId: args.traceId,
  });
  return {
    results,
    ranking,
    searchedPolicyIds: scope.map((policy) => policy._id),
  };
}
