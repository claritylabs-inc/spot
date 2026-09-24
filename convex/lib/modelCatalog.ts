import {
  DIRECT_MODEL_PROVIDERS,
  type DirectModelProvider,
} from "../../contracts/cl-router/policy";

export type ModelProvider = DirectModelProvider;
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

export type WebRetrievalProvider =
  | "parallel"
  | "exa"
  | "model_default"
  | "openai"
  | "google"
  | "anthropic"
  | "xai";

export type WebRetrievalApiProvider = Extract<
  WebRetrievalProvider,
  "parallel" | "exa"
>;

export function isWebRetrievalApiProvider(
  provider: WebRetrievalProvider,
): provider is WebRetrievalApiProvider {
  return provider === "parallel" || provider === "exa";
}

export type NativeWebRetrievalProvider = Extract<
  ModelProvider,
  "openai" | "google" | "anthropic" | "xai"
>;

export function isNativeWebRetrievalProvider(
  provider: ModelProvider,
): provider is NativeWebRetrievalProvider {
  return (
    provider === "openai" ||
    provider === "google" ||
    provider === "anthropic" ||
    provider === "xai"
  );
}

export type WebRetrievalRoute = {
  primary: WebRetrievalProvider;
  route?: ModelRoute;
};

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  mistral: "Mistral",
  cohere: "Cohere",
  fireworks: "Fireworks",
  deepseek: "DeepSeek",
};

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

export const MODEL_PROVIDERS = [
  ...DIRECT_MODEL_PROVIDERS,
] as const satisfies readonly ModelProvider[];

export const WEB_RETRIEVAL_DEFAULT: WebRetrievalRoute = { primary: "parallel" };

export const WEB_RETRIEVAL_DEFAULT_ROUTES: Record<
  NativeWebRetrievalProvider,
  ModelRoute
> = {
  openai: { provider: "openai", model: "gpt-5.4-mini" },
  google: { provider: "google", model: "gemini-2.5-flash" },
  anthropic: { provider: "anthropic", model: "claude-sonnet-4.5" },
  xai: { provider: "xai", model: "grok-4.20-non-reasoning" },
};

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "accounts/fireworks/models/deepseek-v4-pro": "DeepSeek V4 Pro",
  "accounts/fireworks/models/deepseek-v4-flash-0731": "DeepSeek V4 Flash",
  "accounts/fireworks/models/glm-5p2": "GLM 5.2",
  "accounts/fireworks/models/qwen3p7-plus": "Qwen 3.7 Plus",
  "accounts/fireworks/models/muse-glimmer-30b": "Muse Glimmer 30B",
  "accounts/fireworks/models/inkling": "Inkling",
  "accounts/fireworks/models/gpt-oss-safeguard-20b": "GPT-OSS Safeguard 20B",
  "accounts/fireworks/models/qwen3-embedding-8b": "Qwen3 Embedding 8B",
  "nomic-ai/nomic-embed-text-v1.5": "Nomic Embed Text v1.5",
  "gpt-5.6": "GPT 5.6 Sol",
  "gpt-5.6-sol": "GPT 5.6 Sol",
  "gpt-5.6-terra": "GPT 5.6 Terra",
  "gpt-5.6-luna": "GPT 5.6 Luna",
  "gpt-5.5": "GPT 5.5",
  "gpt-5.5-pro": "GPT 5.5 Pro",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gpt-5.4-nano": "GPT 5.4 Nano",
  "gpt-4o-transcribe": "GPT-4o Transcribe",
  "gpt-4o-mini-transcribe": "GPT-4o Mini Transcribe",
  "text-embedding-3-small": "Text Embedding 3 Small",
  "text-embedding-3-large": "Text Embedding 3 Large",
  "claude-sonnet-4.5": "Claude Sonnet 4.5",
  "claude-haiku-4.5": "Claude Haiku 4.5",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
};

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

export function isConfigurableModelProvider(
  value: string,
): value is DirectModelProvider {
  return (DIRECT_MODEL_PROVIDERS as readonly string[]).includes(value);
}
