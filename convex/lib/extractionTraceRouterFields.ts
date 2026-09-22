import { v } from "convex/values";
import { parseRoutingSelectionMetadata, type RoutingSelectionMetadata } from "../../contracts/cl-router/policy";

export const routingSelectionValidator = v.object({
  mode: v.union(v.literal("legacy"), v.literal("jev_shadow"), v.literal("jev_active")),
  selectorVersion: v.string(),
  outcome: v.union(v.literal("bypass"), v.literal("default"), v.literal("accepted")),
  reason: v.string(),
  durationMs: v.number(),
  costNanoUsd: v.union(v.number(), v.null()),
  requestId: v.optional(v.string()),
  proposedRoute: v.optional(v.object({ provider: v.string(), model: v.string() })),
  estimatedInputTokens: v.number(),
  estimatedOutputTokens: v.union(v.number(), v.null()),
  expectedFallbackCostNanoUsd: v.union(v.number(), v.null()),
  generationAttemptsCostNanoUsd: v.optional(v.union(v.number(), v.null())),
  totalCostNanoUsd: v.optional(v.union(v.number(), v.null())),
});

export type ExtractionTraceRouterRoute = {
  provider: string;
  model: string;
};

export type ExtractionTraceRouting = {
  decision: string;
  attemptCount?: number;
  primitive?: string;
  difficulty?: "simple" | "standard" | "complex" | null;
  requiredTier?: 1 | 2 | 3;
  selectedTier?: 1 | 2 | 3;
  route?: ExtractionTraceRouterRoute;
  source?: string;
  candidatesConsidered?: ExtractionTraceRouterRoute[];
  policyVersion?: string | null;
  cacheStickinessApplied?: boolean;
  routeSource?: string;
  shadowMode?: boolean;
  wouldHaveChosen?: ExtractionTraceRouterRoute & { decision: string };
  wouldHaveMatched?: boolean;
  selection?: RoutingSelectionMetadata;
};

export type ExtractionTraceRouterFields = {
  routerRequestId?: string;
  cachedInputTokens?: number;
  costUsd?: number | null;
  costStatus?: "priced" | "unpriced";
  routingDecision?: string;
  routing?: ExtractionTraceRouting;
  details?: unknown;
};

export type ExtractionTraceOriginEvent = {
  kind: string;
  taskKind?: string;
  status?: string;
  routerRequestId?: string;
  timestamp: number;
};

type ExtractionTraceRouterInput = ExtractionTraceRouterFields & {
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function route(value: unknown): ExtractionTraceRouterRoute | null {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.model !== "string") {
    return null;
  }
  return { provider: value.provider, model: value.model };
}

function routing(value: unknown): ExtractionTraceRouting | undefined {
  if (!isRecord(value) || typeof value.decision !== "string") {
    return undefined;
  }
  const attemptCount = nonNegativeInteger(value.attemptCount);
  const selectedRoute = route(value.route);
  const candidatesConsidered = Array.isArray(value.candidatesConsidered)
    ? value.candidatesConsidered.map(route)
    : undefined;
  if (candidatesConsidered?.some((candidate) => candidate === null)) {
    return undefined;
  }
  const routeSource =
    typeof value.source === "string"
      ? value.source
      : typeof value.routeSource === "string"
        ? value.routeSource
        : undefined;
  let selection: RoutingSelectionMetadata | undefined;
  if (value.selection !== undefined) {
    try {
      selection = parseRoutingSelectionMetadata(value.selection);
    } catch {
      selection = undefined;
    }
  }
  return {
    decision: value.decision,
    ...(attemptCount !== undefined ? { attemptCount } : {}),
    ...(typeof value.primitive === "string" ? { primitive: value.primitive } : {}),
    ...(value.difficulty === null ||
    value.difficulty === "simple" ||
    value.difficulty === "standard" ||
    value.difficulty === "complex"
      ? { difficulty: value.difficulty }
      : {}),
    ...(value.requiredTier === 1 ||
    value.requiredTier === 2 ||
    value.requiredTier === 3
      ? { requiredTier: value.requiredTier }
      : {}),
    ...(value.selectedTier === 1 ||
    value.selectedTier === 2 ||
    value.selectedTier === 3
      ? { selectedTier: value.selectedTier }
      : {}),
    ...(selectedRoute ? { route: selectedRoute } : {}),
    ...(routeSource ? { source: routeSource, routeSource } : {}),
    ...(candidatesConsidered
      ? { candidatesConsidered: candidatesConsidered as ExtractionTraceRouterRoute[] }
      : {}),
    ...(typeof value.policyVersion === "string" || value.policyVersion === null
      ? { policyVersion: value.policyVersion }
      : {}),
    ...(typeof value.cacheStickinessApplied === "boolean"
      ? { cacheStickinessApplied: value.cacheStickinessApplied }
      : {}),
    ...(selection ? { selection } : {}),
  };
}

function costStatus(value: unknown): "priced" | "unpriced" | undefined {
  return value === "priced" || value === "unpriced" ? value : undefined;
}

function costUsd(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeExtractionTraceRouterFields(
  input: ExtractionTraceRouterInput,
): ExtractionTraceRouterFields {
  const details = isRecord(input.details) ? input.details : null;
  const nested = details && isRecord(details.clRouter) ? details.clRouter : null;
  const sanitizedDetails = details
    ? Object.fromEntries(Object.entries(details).filter(([key]) => key !== "clRouter"))
    : input.details;
  const normalizedRouting = routing(input.routing ?? nested?.routing);
  const normalizedCostStatus = input.costStatus ?? costStatus(nested?.costStatus);
  const normalizedCostUsd = input.costUsd !== undefined ? costUsd(input.costUsd) : costUsd(nested?.costUsd);
  const routerRequestId = input.routerRequestId
    ?? (typeof nested?.requestId === "string" ? nested.requestId : undefined);
  const cachedInputTokens = input.cachedInputTokens
    ?? nonNegativeInteger(nested?.cachedInputTokens);

  return {
    ...(routerRequestId ? { routerRequestId } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(normalizedCostUsd !== undefined ? { costUsd: normalizedCostUsd } : {}),
    ...(normalizedCostStatus ? { costStatus: normalizedCostStatus } : {}),
    ...(input.routingDecision ?? normalizedRouting?.decision
      ? { routingDecision: input.routingDecision ?? normalizedRouting!.decision }
      : {}),
    ...(normalizedRouting ? { routing: normalizedRouting } : {}),
    ...(sanitizedDetails !== undefined ? { details: sanitizedDetails } : {}),
  };
}

export function latestCompletedRouterRequest(
  events: readonly ExtractionTraceOriginEvent[],
  taskKind: string,
  beforeTimestamp: number,
): { requestId: string; timestamp: number } | null {
  const origin = [...events]
    .filter((event) => event.timestamp <= beforeTimestamp)
    .filter((event) => event.kind === "model_call")
    .filter((event) => event.taskKind === taskKind)
    .filter((event) => event.status === "complete")
    .filter((event): event is ExtractionTraceOriginEvent & { routerRequestId: string } =>
      typeof event.routerRequestId === "string" && event.routerRequestId.length > 0
    )
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  return origin ? { requestId: origin.routerRequestId, timestamp: origin.timestamp } : null;
}
