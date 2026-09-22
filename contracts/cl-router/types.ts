/**
 * Frozen cl-router HTTP contract types for the primitive-router cutover.
 *
 * TODO(cl-router-policy): replace this Spot-owned overlay with the published
 * `@claritylabs/cl-router-policy` package once it exports primitive/registry
 * vocabulary. The published package is still 0.8.0 (task-family catalog).
 * Spot compiles against these local types so the app can ship without waiting
 * for that publish.
 */

export const CL_ROUTER_PRIMITIVES = [
  "text",
  "reasoning",
  "multimodal",
  "tool_use",
  "embedding",
  "transcription",
] as const;

export type ClRouterPrimitive = (typeof CL_ROUTER_PRIMITIVES)[number];

export type ClRouterRequirements = {
  vision?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  minInputTokens?: number;
};

export type ClRouterDifficulty = "simple" | "standard" | "complex";
export type ClRouterQualityTier = 1 | 2 | 3;
export type ClRouterRoutingDecision = "routed" | "manual";
export type ClRouterRoutingSource = "jev" | "fallback" | "manual";

export type ClRouterRoute = {
  provider: string;
  model: string;
};

export type ClRouterRoutingMetadata = {
  decision: ClRouterRoutingDecision;
  primitive?: string;
  difficulty?: ClRouterDifficulty | null;
  requiredTier?: ClRouterQualityTier;
  selectedTier?: ClRouterQualityTier;
  route: ClRouterRoute;
  source?: ClRouterRoutingSource;
  attemptCount: number;
};

export type ClRouterTraceMetadata = {
  traceId?: string;
  parentRequestId?: string;
  label?: string;
  phase?: string;
  channel?: string;
  [key: string]: unknown;
};

export type ClRouterGenerateBody = {
  tenantId?: string;
  orgId?: string;
  primitive: ClRouterPrimitive;
  requirements?: ClRouterRequirements;
  system?: string;
  prompt?: string;
  schema?: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  trace?: ClRouterTraceMetadata;
};

export type ClRouterManualGenerateBody = ClRouterGenerateBody & {
  route: ClRouterRoute;
};
