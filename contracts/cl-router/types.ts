/**
 * cl-router HTTP wire types for Spot callers. Primitive, requirement,
 * difficulty, and quality-tier vocabulary comes from the published
 * `@claritylabs/cl-router-policy` package; the request/response shapes mirror
 * the checked-in `openapi.v1.json` snapshot.
 */

import type {
  Difficulty,
  Primitive,
  PrimitiveRequirements,
  QualityTier,
} from "@claritylabs/cl-router-policy";

export type ClRouterPrimitive = Primitive;
export type ClRouterRequirements = PrimitiveRequirements;
export type ClRouterDifficulty = Difficulty;
export type ClRouterQualityTier = QualityTier;
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

export type ClRouterTraceTagValue = string | number | boolean | null;

export type ClRouterTraceMetadata = {
  traceId?: string;
  parentRequestId?: string;
  caller?: string;
  tags?: Record<string, ClRouterTraceTagValue>;
};

export type ClRouterGenerateBody = {
  tenantId?: string;
  orgId?: string;
  primitive: ClRouterPrimitive;
  requirements?: ClRouterRequirements;
  system?: string;
  messages?: unknown;
  prompt?: string;
  schema?: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  tools?: unknown[];
  trace?: ClRouterTraceMetadata;
};

export type ClRouterManualGenerateBody = ClRouterGenerateBody & {
  route: ClRouterRoute;
};
