import { v } from "convex/values";

export const routingSelectionValidator = v.object({
  mode: v.union(
    v.literal("legacy"),
    v.literal("jev_shadow"),
    v.literal("jev_active"),
  ),
  selectorVersion: v.string(),
  outcome: v.union(
    v.literal("bypass"),
    v.literal("default"),
    v.literal("accepted"),
  ),
  reason: v.string(),
  durationMs: v.number(),
  costNanoUsd: v.union(v.number(), v.null()),
  requestId: v.optional(v.string()),
  proposedRoute: v.optional(
    v.object({ provider: v.string(), model: v.string() }),
  ),
  estimatedInputTokens: v.number(),
  estimatedOutputTokens: v.union(v.number(), v.null()),
  expectedFallbackCostNanoUsd: v.union(v.number(), v.null()),
  generationAttemptsCostNanoUsd: v.optional(v.union(v.number(), v.null())),
  totalCostNanoUsd: v.optional(v.union(v.number(), v.null())),
});
