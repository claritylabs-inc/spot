"use node";

import {
  runDecision,
  type DecisionEvent,
  type DecisionPolicy,
} from "@claritylabs/cl-sdk/decisions";
import type {
  DecisionAnswer,
  DecisionEntry,
  DecisionQuestion,
} from "@claritylabs/cl-router-policy";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ClRouterTraceMetadata } from "./clRouterClient";
import { makeDecide } from "./sdkCallbacks";
import extractionPolicy from "../../extraction-worker/src/decisionPolicy.json";

export type {
  DecisionAnswer,
  DecisionEntry,
  DecisionQuestion,
  JsonValue,
} from "@claritylabs/cl-router-policy";

/** Fixed SDK compatibility settings, not rollout controls or evaluation evidence. */
export function decisionPolicy(family?: string): DecisionPolicy {
  return {
    ...extractionPolicy,
    mode: "active",
    families: {
      ...extractionPolicy.families,
      ...(family
        ? {
            [family]: Object.prototype.hasOwnProperty.call(
              extractionPolicy.families,
              family,
            )
              ? extractionPolicy.families[
                  family as keyof typeof extractionPolicy.families
                ]
              : extractionPolicy.families["extraction.cleanup"],
          }
        : {}),
    },
  };
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
    policy: decisionPolicy(options.family),
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
