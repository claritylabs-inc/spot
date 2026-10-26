/**
 * Provider and model identifiers are cl-router data from GET /v1/capabilities
 * (`convex/lib/routerCapabilities.ts`); Spot keeps no list of its own.
 */
export type ModelProvider = string;
export type ModelRoute = {
  provider: ModelProvider;
  model: string;
};

/**
 * Spot-owned internal task names. They label telemetry, prompts, and operator
 * settings; cl-router only sees the mapped primitive.
 */
const ALL_MODEL_TASKS = [
  "chat",
  "chat_vision",
  "voice_transcription",
  "email_draft",
  "email_reply",
  "extraction",
  "extraction_preview",
  "extraction_coverage_recovery",
  "classification",
  "requirement_extraction",
  "org_memory_extraction",
  "analysis",
  "summary",
  "triage",
  "email_extraction",
  "document_extraction",
  "security",
  "mailbox_coordinator",
  "embeddings",
] as const;

export type ModelTask = (typeof ALL_MODEL_TASKS)[number];

/**
 * Retrieval modes Spot configures. `model_default` uses a native provider that
 * live capabilities list under `webRetrieval.providers`.
 */
export type WebRetrievalMode = "parallel" | "exa" | "model_default";
export type WebRetrievalApiProvider = Extract<
  WebRetrievalMode,
  "parallel" | "exa"
>;

export function isWebRetrievalApiProvider(
  provider: string,
): provider is WebRetrievalApiProvider {
  return provider === "parallel" || provider === "exa";
}

export type WebRetrievalRoute = { primary: WebRetrievalMode };

/**
 * Retired routes: no longer selectable in operator settings, but kept in
 * ALL_MODEL_TASKS/ModelTask so stored-data compatibility and internal
 * taskKind bucketing (`convex/lib/models.ts`, `convex/lib/sdkCallbacks.ts`)
 * keep working. `extraction_coverage_recovery` is retired cl-sdk coverage
 * recovery; `classification`/`security` decisions now go through
 * clRouterDecide (/v1/decide) instead of a generation route.
 */
const RETIRED_MODEL_TASK_IDS = [
  "extraction_coverage_recovery",
  "classification",
  "security",
] as const satisfies readonly ModelTask[];

export const MODEL_TASKS = ALL_MODEL_TASKS.filter(
  (task) => !(RETIRED_MODEL_TASK_IDS as readonly string[]).includes(task),
);
export const OPERATOR_AGENT_MODEL_ROUTE_ID = "operator_agent" as const;
export type ModelRouteId = ModelTask | typeof OPERATOR_AGENT_MODEL_ROUTE_ID;
export const MODEL_ROUTE_IDS = [
  ...MODEL_TASKS,
  OPERATOR_AGENT_MODEL_ROUTE_ID,
] as ModelRouteId[];

export const WEB_RETRIEVAL_DEFAULT: WebRetrievalRoute = { primary: "parallel" };

/**
 * Model-independent cl-sdk output budgets. cl-sdk prefers these over its
 * built-in hint tokens; cl-router clamps each request to the selected model's
 * output limit.
 */
export const EXTRACTION_MODEL_CAPABILITIES = {
  defaultOutputTokens: 8_192,
  longListOutputTokens: 24_576,
  taskOutputTokens: {
    extraction_classify: 2_048,
    extraction_source_tree: 4_096,
    extraction_page_map: 8_192,
    extraction_focused: 16_384,
    extraction_long_list: 24_576,
    extraction_operational_profile: 32_768,
    extraction_coverage_recovery: 16_384,
    extraction_coverage_cleanup: 4_096,
    extraction_review: 12_288,
    extraction_referential_lookup: 12_288,
    query_classify: 2_048,
    query_reason: 8_192,
    query_verify: 4_096,
    query_respond: 8_192,
    pce_impact_analysis: 8_192,
    pce_packet_generation: 8_192,
  },
};
