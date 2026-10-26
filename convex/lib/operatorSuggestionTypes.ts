import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type OperatorSuggestionPageContext = {
  pageType: string;
  entityId?: string;
  summary?: string;
  href?: string;
};

/**
 * A suggestion built from live data. Labels and focus are templated from real
 * records in code; Jev only ranks and filters candidates.
 */
export type OperatorSuggestionCandidate = {
  /** Stable across recomputes, e.g. `extraction_failures` or `renewal:<policyId>`. */
  key: string;
  /** An id from `OPERATOR_AGENT_INTENTS`. */
  intentId: string;
  /** Concrete, at most 60 characters, e.g. "Acme renews in 12 days". */
  label: string;
  /** Facts appended to the intent objective when launched; at most 500 characters. */
  focus: string;
  /** Context the intent runs in; must satisfy `resolveOperatorAgentIntent`. */
  pageContext?: OperatorSuggestionPageContext;
  /** Deterministic 0–1 baseline used before, or without, Jev ranking. */
  urgency: number;
  source: "live" | "page";
  /** Compact facts for Jev ranking; no record bodies or email content. */
  evidence: Record<string, string | number | boolean | null>;
};

/** Client-facing suggestion returned by `api.operatorSuggestions.list`. */
export type OperatorSuggestion = {
  key: string;
  intentId: string;
  label: string;
};

export type OperatorSuggestionList = {
  suggestions: OperatorSuggestion[];
  /** True when the Jev ranking is missing or older than the cache TTL. */
  stale: boolean;
};

export type CollectGlobalSuggestionCandidates = (
  ctx: QueryCtx,
  args: { operatorUserId: Id<"users">; now: number },
) => Promise<OperatorSuggestionCandidate[]>;

export type CollectEntitySuggestionCandidates = (
  ctx: QueryCtx,
  args: {
    operatorUserId: Id<"users">;
    pageContext: OperatorSuggestionPageContext;
    now: number;
  },
) => Promise<OperatorSuggestionCandidate[]>;

export const OPERATOR_SUGGESTION_LIMIT = 5;
