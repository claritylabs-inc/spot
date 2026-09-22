import {
  DIRECT_MODEL_PROVIDERS,
  type DirectModelProvider,
} from "../../contracts/cl-router/policy";

export type ModelProvider = DirectModelProvider | "moonshot";
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

const RETIRED_MODEL_IDS = new Set<string>([
  "accounts/fireworks/models/kimi-k2p6",
  "accounts/fireworks/routers/kimi-k2p6-fast",
]);

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  mistral: "Mistral",
  cohere: "Cohere",
  fireworks: "Fireworks",
  moonshot: "Disabled provider",
  deepseek: "DeepSeek",
};

export const MODEL_TASK_LABELS: Record<ModelTask, string> = {
  chat: "Chat assistant",
  chat_vision: "Chat rich-input understanding",
  voice_transcription: "Voice memo transcription",
  email_draft: "Email drafting",
  email_reply: "Inbound email replies",
  extraction: "Policy extraction",
  extraction_preview: "Fast policy extraction",
  extraction_coverage_recovery: "Coverage recovery",
  classification: "Classification",
  requirement_extraction: "Requirement extraction",
  org_memory_extraction: "Org memory extraction",
  analysis: "Reasoning and review",
  summary: "Summaries",
  triage: "Website enrichment",
  email_extraction: "Email extraction",
  document_extraction: "Document extraction",
  security: "Security checks",
  mailbox_coordinator: "Mailbox coordinator",
  embeddings: "Embeddings",
};

export const MODEL_TASK_DESCRIPTIONS: Record<ModelTask, string> = {
  chat: "Interactive assistant route for web chat, MCP/CLI chat, iMessage/SMS, retrieval orchestration, and tool calls.",
  chat_vision:
    "Rich-input-capable web, iMessage, and operator route for reading user images and parser-empty PDFs while preserving normal chat tools and side effects.",
  voice_transcription:
    "Speech-to-text route for bounded iMessage voice memos before the transcript enters the normal tool-capable chat workflow.",
  email_draft:
    "Outbound email drafting route for chat-requested messages and email subagent drafts.",
  email_reply:
    "Inbound email reply route for tenant-aware email agent responses.",
  extraction:
    "Standard bound-policy extraction route after LiteParse preprocessing: focused fields, source review, and post-processing.",
  extraction_preview:
    "Fast preview route for policy-list fields extracted from LiteParse text before full enrichment completes.",
  extraction_coverage_recovery:
    "Retired route retained for stored settings compatibility; AI coverage recovery is disabled.",
  classification:
    "Legacy generation route retained for stored settings compatibility. Classification decisions use router-owned Jev through /v1/decide.",
  requirement_extraction:
    "Structured extraction route for compliance requirements from leases, client contracts, vendor packets, and pasted requirement text.",
  org_memory_extraction:
    "Durable organization memory extraction route for stable company-profile facts from email and iMessage exchanges.",
  analysis:
    "Deeper reasoning route for coverage analysis, compliance review, partner-program matching, policy reconciliation, and policy-change impact.",
  summary:
    "Summary route for thread titles, COI copy, and compact email/conversation summaries.",
  triage:
    "Website-enrichment synthesis route after public web retrieval; this does not control the web search provider.",
  email_extraction:
    "Low-cost route for extracting structured facts from email body text and supported attachment text.",
  document_extraction:
    "Document-level extraction route for non-policy subtasks and attachment analysis outside full policy extraction.",
  security:
    "Legacy generation route retained for stored settings compatibility. Prompt-injection classification uses router-owned Jev through /v1/decide.",
  mailbox_coordinator:
    "Coordinator route for multi-step connected-mailbox workflows: search mail, inspect attachments, import policies or requirements, and plan follow-up.",
  embeddings:
    "Vector embedding route for policies and source chunks. Must stay compatible with the configured Convex vector dimensions.",
};

export const MODEL_TASKS = ALL_MODEL_TASKS.filter(
  (task) => task !== "extraction_coverage_recovery",
);
export const OPERATOR_AGENT_MODEL_ROUTE_ID = "operator_agent" as const;
export type ModelRouteId = ModelTask | typeof OPERATOR_AGENT_MODEL_ROUTE_ID;
export const MODEL_ROUTE_IDS = [
  ...MODEL_TASKS,
  OPERATOR_AGENT_MODEL_ROUTE_ID,
] as ModelRouteId[];

export const MODEL_ROUTE_LABELS: Record<ModelRouteId, string> = {
  ...MODEL_TASK_LABELS,
  operator_agent: "Operator agent",
};

export const MODEL_ROUTE_DESCRIPTIONS: Record<ModelRouteId, string> = {
  ...MODEL_TASK_DESCRIPTIONS,
  operator_agent:
    "Required manually selected route for the internal operator agent across the portal, Slack, iMessage, and MCP. It must support rich attachment input and is always submitted through /v1/manual, never auto-routed.",
};

export type ModelRouteGroup<RouteId extends string = string> = {
  id: string;
  label: string;
  description: string;
  tasks: readonly RouteId[];
};

export const MODEL_TASK_GROUPS = [
  {
    id: "agent_communication",
    label: "Agent communication",
    description:
      "Routes used when Spot is talking to users or coordinating mailbox workflows.",
    tasks: [
      "chat",
      "chat_vision",
      "voice_transcription",
      "email_reply",
      "email_draft",
      "mailbox_coordinator",
    ],
  },
  {
    id: "reasoning_authoring",
    label: "Reasoning and authoring",
    description:
      "Routes used for deeper policy reasoning, review, and summaries.",
    tasks: ["analysis", "summary"],
  },
  {
    id: "document_ingestion",
    label: "Document ingestion",
    description:
      "Routes used to extract structured facts from policies, files, and email text.",
    tasks: [
      "requirement_extraction",
      "org_memory_extraction",
      "extraction",
      "document_extraction",
      "email_extraction",
    ],
  },
  {
    id: "platform_utilities",
    label: "Platform utilities",
    description: "Routes used for enrichment and vector indexing.",
    tasks: ["triage", "embeddings"],
  },
] as const satisfies readonly ModelRouteGroup<ModelTask>[];

export const OPERATOR_MODEL_ROUTE_GROUPS = [
  {
    id: "internal_operations",
    label: "Internal operations",
    description:
      "Required manually selected /v1/manual routes for Clarity Labs operator workflows.",
    tasks: [OPERATOR_AGENT_MODEL_ROUTE_ID],
  },
  MODEL_TASK_GROUPS[0],
  MODEL_TASK_GROUPS[1],
  MODEL_TASK_GROUPS[2],
  MODEL_TASK_GROUPS[3],
] as const satisfies readonly ModelRouteGroup<ModelRouteId>[];

export const MODEL_PROVIDERS = [
  ...DIRECT_MODEL_PROVIDERS,
  "moonshot",
] as const satisfies readonly ModelProvider[];
export const CONFIGURABLE_MODEL_PROVIDERS = DIRECT_MODEL_PROVIDERS;

export const WEB_RETRIEVAL_LABELS: Record<WebRetrievalProvider, string> = {
  parallel: "Parallel",
  exa: "Exa",
  model_default: "Model default",
  openai: "OpenAI",
  google: "Google",
  anthropic: "Claude",
  xai: "xAI",
};

export const OPERATOR_WEB_RETRIEVAL_PROVIDERS = [
  "parallel",
  "exa",
  "model_default",
] as const satisfies readonly WebRetrievalProvider[];

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

export function isRetiredModelRoute(
  route: ModelRoute | null | undefined,
): boolean {
  return !!route && RETIRED_MODEL_IDS.has(route.model);
}
