"use node";

import {
  parseDecisionPolicy,
  runDecision,
  type DecisionEvent,
  type DecisionPolicy,
} from "@claritylabs/cl-sdk";
import type {
  DecisionAnswer,
  DecisionEntry,
  DecisionQuestion,
} from "@claritylabs/cl-router-policy";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ClRouterTraceMetadata } from "./clRouterClient";
import { makeDecide } from "./sdkCallbacks";

export type {
  DecisionAnswer,
  DecisionEntry,
  DecisionQuestion,
  JsonValue,
} from "@claritylabs/cl-router-policy";

export function decisionPolicyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DecisionPolicy {
  const configured = environment.SPOT_DECISION_POLICY;
  if (!configured) return { mode: "legacy" };
  try {
    return parseDecisionPolicy(JSON.parse(configured));
  } catch {
    // Invalid rollout configuration must preserve the established reasoning path.
    return { mode: "legacy" };
  }
}

export async function decideWithFallback<T>(options: {
  ctx?: ActionCtx;
  orgId?: Id<"organizations">;
  family: string;
  state: DecisionEntry;
  questions: Record<string, DecisionQuestion>;
  accept: (answers: Record<string, DecisionAnswer>) => T | undefined;
  requiredQuestionIds?: (
    answers: Record<string, DecisionAnswer>,
  ) => readonly string[];
  fallback: () => Promise<T>;
  trace?: ClRouterTraceMetadata;
  abortSignal?: AbortSignal;
  onDecision?: (event: DecisionEvent) => void;
}): Promise<T> {
  const decide = makeDecide({
    ctx: options.ctx,
    orgId: options.orgId,
    traceId: options.trace?.traceId,
  });
  return runDecision({
    decide: (request) =>
      decide({
        ...request,
        ...(options.trace?.parentRequestId
          ? { parentRequestId: options.trace.parentRequestId }
          : {}),
        trace: {
          ...request.trace,
          ...(options.trace?.traceId ? { traceId: options.trace.traceId } : {}),
          ...(options.trace?.parentRequestId
            ? { parentRequestId: options.trace.parentRequestId }
            : {}),
          ...(options.trace?.channel ? { channel: options.trace.channel } : {}),
        },
      }),
    policy: decisionPolicyFromEnvironment(),
    family: options.family,
    state: options.state,
    questions: options.questions,
    accept: options.accept,
    requiredQuestionIds: options.requiredQuestionIds,
    fallback: options.fallback,
    signal: options.abortSignal,
    onDecision: (event) => {
      logDecisionEvent(event);
      options.onDecision?.(event);
    },
  });
}

export function logDecisionEvent(event: DecisionEvent): void {
  const response = event.response;
  console.info(
    "[decision]",
    JSON.stringify({
      family: event.family,
      mode: event.mode,
      outcome: event.outcome,
      reason: event.reason,
      durationMs: event.durationMs,
      policyVersion: event.policyVersion,
      evaluationId: event.evaluationId,
      requestId: response?.requestId,
      parentRequestId: response?.parentRequestId,
      model: response?.model,
      usage: response?.usage,
      cost: response?.cost,
    }),
  );
}
