/**
 * Vendored cl-router /v1/decide contract and primitive vocabulary.
 *
 * Copied from the former published policy package 1.0.0 (`dist/*.js` + `.d.ts`)
 * as TypeScript. Model registry/capability/price tables are not vendored:
 * Spot reads selectable routes from authenticated GET /v1/capabilities.
 *
 * Keep `extraction-worker/src/clRouterPolicy.ts` in sync with this file.
 */

export const PRIMITIVES = [
  "text",
  "reasoning",
  "multimodal",
  "tool_use",
  "embedding",
  "transcription",
] as const;
export type Primitive = (typeof PRIMITIVES)[number];

export const DIFFICULTIES = ["simple", "standard", "complex"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const QUALITY_TIERS = [1, 2, 3] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export type PrimitiveRequirements = {
  vision?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  minInputTokens?: number;
};

export const DIRECT_MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "cohere",
  "fireworks",
  "deepseek",
] as const;
export type DirectModelProvider = (typeof DIRECT_MODEL_PROVIDERS)[number];

/** Response `model` is the actual Jev version TypeSafe served (e.g. "jev-1.14.0"), not a fixed pin. */
export const JEV_MODEL_PATTERN = /^jev-/;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type DecisionEntry =
  | string
  | { [key: string]: JsonValue }
  | JsonValue[]
  | null;

export type DecisionQuestion =
  | {
      type: "choice";
      instructions: DecisionEntry;
      criteria: Record<string, DecisionEntry>;
    }
  | {
      type: "score";
      instructions: DecisionEntry;
      criteria: DecisionEntry[];
    }
  | {
      type: "noul";
      instructions: DecisionEntry;
      criteria?: { true?: DecisionEntry; false?: DecisionEntry };
    };

export type DecisionAnswer =
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, DecisionEntry>;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | { type: "noul"; noul: number };

export interface DecideRequest {
  tenantId: string;
  orgId?: string;
  task?: string;
  state: DecisionEntry;
  questions: Record<string, DecisionQuestion>;
  executionBudgetMs?: number;
  parentRequestId?: string;
  trace?: {
    traceId?: string;
    parentRequestId?: string;
    channel?: string;
  };
}

export interface DecideResponse {
  contractVersion: 1;
  requestId: string;
  parentRequestId?: string;
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  cost: { status: "priced" | "unpriced"; costNanoUsd: number | null };
  durationMs: number;
}

export type RoutingMode = "legacy" | "jev_shadow" | "jev_active";

export interface RoutingSelectionMetadata {
  mode: RoutingMode;
  selectorVersion: string;
  outcome: "bypass" | "default" | "accepted";
  reason: string;
  durationMs: number;
  costNanoUsd: number | null;
  requestId?: string;
  proposedRoute?: { provider: string; model: string };
  estimatedInputTokens: number;
  estimatedOutputTokens: number | null;
  expectedFallbackCostNanoUsd: number | null;
  generationAttemptsCostNanoUsd?: number | null;
  totalCostNanoUsd?: number | null;
}

function invalid(): never {
  throw new Error("Invalid decision contract");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.length || value.length > 256) {
    invalid();
  }
}

function natural(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid();
  }
}

function probability(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    invalid();
  }
}

function json(value: unknown, depth = 0) {
  if (depth > 32) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => json(item, depth + 1));
    return;
  }
  const entries = object(value);
  for (const item of Object.values(entries)) json(item, depth + 1);
}

export function parseDecisionEntry(value: unknown): DecisionEntry {
  if (typeof value === "number" || typeof value === "boolean") invalid();
  json(value);
  return value as DecisionEntry;
}

export function parseDecisionQuestion(value: unknown): DecisionQuestion {
  const q = object(value);
  exact(q, ["type", "instructions", "criteria"]);
  parseDecisionEntry(q.instructions);
  if (q.type === "choice") {
    const criteria = object(q.criteria);
    if (Object.keys(criteria).length < 2 || Object.keys(criteria).length > 128) {
      invalid();
    }
    for (const [key, entry] of Object.entries(criteria)) {
      text(key);
      parseDecisionEntry(entry);
    }
  } else if (q.type === "score") {
    if (
      !Array.isArray(q.criteria) ||
      q.criteria.length < 2 ||
      q.criteria.length > 128
    ) {
      invalid();
    }
    q.criteria.forEach(parseDecisionEntry);
  } else if (q.type === "noul") {
    if (q.criteria !== undefined) {
      const criteria = object(q.criteria);
      exact(criteria, ["true", "false"]);
      Object.values(criteria).forEach(parseDecisionEntry);
    }
  } else {
    invalid();
  }
  return value as DecisionQuestion;
}

export function parseDecideRequest(value: unknown): DecideRequest {
  const r = object(value);
  exact(r, [
    "tenantId",
    "orgId",
    "task",
    "state",
    "questions",
    "executionBudgetMs",
    "parentRequestId",
    "trace",
  ]);
  text(r.tenantId);
  for (const key of ["orgId", "task", "parentRequestId"]) {
    if (r[key] !== undefined) text(r[key]);
  }
  parseDecisionEntry(r.state);
  const questions = object(r.questions);
  if (!Object.keys(questions).length || Object.keys(questions).length > 128) {
    invalid();
  }
  for (const [key, question] of Object.entries(questions)) {
    text(key);
    parseDecisionQuestion(question);
  }
  if (r.executionBudgetMs !== undefined) {
    natural(r.executionBudgetMs);
    if (
      typeof r.executionBudgetMs !== "number" ||
      r.executionBudgetMs < 100 ||
      r.executionBudgetMs > 900_000
    ) {
      invalid();
    }
  }
  if (r.trace !== undefined) {
    const trace = object(r.trace);
    exact(trace, ["traceId", "parentRequestId", "channel"]);
    Object.values(trace).forEach(text);
    if (
      r.parentRequestId !== undefined &&
      trace.parentRequestId !== undefined &&
      r.parentRequestId !== trace.parentRequestId
    ) {
      invalid();
    }
  }
  if (utf8Bytes(JSON.stringify(r)) > 4 * 1024 * 1024) invalid();
  const parsed = r as unknown as DecideRequest;
  const parentRequestId =
    parsed.parentRequestId ?? parsed.trace?.parentRequestId;
  return { ...parsed, ...(parentRequestId ? { parentRequestId } : {}) };
}

function parseAnswer(value: unknown): DecisionAnswer {
  const a = object(value);
  if (a.type === "noul") {
    exact(a, ["type", "noul"]);
    probability(a.noul);
  } else if (a.type === "choice" || a.type === "score") {
    exact(
      a,
      a.type === "choice"
        ? ["type", "choice", "probabilities", "confidence"]
        : ["type", "score", "legend", "probabilities", "confidence"],
    );
    probability(a.confidence);
    const probs = object(a.probabilities);
    const values = Object.values(probs);
    if (values.length < 2) invalid();
    values.forEach(probability);
    if (
      Math.abs(
        values.reduce((sum: number, n) => sum + (n as number), 0) - 1,
      ) > 0.001
    ) {
      invalid();
    }
    if (a.type === "choice") {
      text(a.choice);
      const choice = a.choice as string;
      const chosen = probs[choice];
      if (
        !Object.hasOwn(probs, choice) ||
        typeof chosen !== "number" ||
        chosen < Math.max(...(values as number[]))
      ) {
        invalid();
      }
    } else {
      const legend = object(a.legend);
      Object.values(legend).forEach(parseDecisionEntry);
      if (Object.keys(legend).length !== values.length) invalid();
      for (let i = 0; i < values.length; i++) {
        if (
          !Object.hasOwn(legend, String(i)) ||
          !Object.hasOwn(probs, String(i))
        ) {
          invalid();
        }
      }
      const expected = Object.entries(probs).reduce(
        (sum, [key, p]) => sum + Number(key) * (p as number),
        0,
      );
      if (
        typeof a.score !== "number" ||
        !Number.isFinite(a.score) ||
        Math.abs(a.score - expected) > 0.001
      ) {
        invalid();
      }
    }
  } else {
    invalid();
  }
  return value as DecisionAnswer;
}

export function validateDecisionAnswers(
  questions: Record<string, DecisionQuestion>,
  answers: Record<string, DecisionAnswer>,
) {
  if (Object.keys(questions).length !== Object.keys(answers).length) invalid();
  for (const [id, q] of Object.entries(questions)) {
    if (!Object.hasOwn(answers, id)) invalid();
    const a = parseAnswer(answers[id]);
    if (a.type !== q.type) invalid();
    if (a.type === "choice" && q.type === "choice") {
      if (
        Object.keys(a.probabilities).length !== Object.keys(q.criteria).length ||
        Object.keys(q.criteria).some(
          (key) => !Object.hasOwn(a.probabilities, key),
        )
      ) {
        invalid();
      }
    }
    if (a.type === "score" && q.type === "score") {
      if (
        Object.keys(a.legend).length !== q.criteria.length ||
        q.criteria.some(
          (entry, i) => !jsonEqual(entry, a.legend[String(i)]),
        )
      ) {
        invalid();
      }
    }
  }
}

export function parseDecideResponse(
  value: unknown,
  request?: DecideRequest,
): DecideResponse {
  const r = object(value);
  exact(r, [
    "contractVersion",
    "requestId",
    "parentRequestId",
    "model",
    "answers",
    "usage",
    "cost",
    "durationMs",
  ]);
  if (r.contractVersion !== 1) invalid();
  text(r.requestId);
  text(r.model);
  if (!JEV_MODEL_PATTERN.test(r.model as string)) invalid();
  if (r.parentRequestId !== undefined) text(r.parentRequestId);
  natural(r.durationMs);
  const usage = object(r.usage);
  exact(usage, ["inputTokens", "outputTokens"]);
  natural(usage.inputTokens);
  natural(usage.outputTokens);
  const cost = object(r.cost);
  exact(cost, ["status", "costNanoUsd"]);
  if (cost.status === "priced") natural(cost.costNanoUsd);
  else if (cost.status !== "unpriced" || cost.costNanoUsd !== null) invalid();
  const answers = object(r.answers);
  Object.values(answers).forEach(parseAnswer);
  if (request) {
    if (
      r.parentRequestId !==
      (request.parentRequestId ?? request.trace?.parentRequestId)
    ) {
      invalid();
    }
    validateDecisionAnswers(
      request.questions,
      answers as Record<string, DecisionAnswer>,
    );
  }
  return r as unknown as DecideResponse;
}

function utf8Bytes(value: string) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, i) => jsonEqual(entry, right[i]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]),
    )
  );
}

export function parseRoutingSelectionMetadata(
  value: unknown,
): RoutingSelectionMetadata {
  const metadata = object(value);
  exact(metadata, [
    "mode",
    "selectorVersion",
    "outcome",
    "reason",
    "durationMs",
    "costNanoUsd",
    "requestId",
    "proposedRoute",
    "estimatedInputTokens",
    "estimatedOutputTokens",
    "expectedFallbackCostNanoUsd",
    "generationAttemptsCostNanoUsd",
    "totalCostNanoUsd",
  ]);
  if (!["legacy", "jev_shadow", "jev_active"].includes(String(metadata.mode))) {
    invalid();
  }
  if (!["bypass", "default", "accepted"].includes(String(metadata.outcome))) {
    invalid();
  }
  text(metadata.selectorVersion);
  text(metadata.reason);
  natural(metadata.durationMs);
  natural(metadata.estimatedInputTokens);
  for (const key of [
    "costNanoUsd",
    "estimatedOutputTokens",
    "expectedFallbackCostNanoUsd",
  ]) {
    if (metadata[key] !== null) natural(metadata[key]);
  }
  for (const key of ["generationAttemptsCostNanoUsd", "totalCostNanoUsd"]) {
    if (metadata[key] !== undefined && metadata[key] !== null) {
      natural(metadata[key]);
    }
  }
  if (metadata.requestId !== undefined) text(metadata.requestId);
  if (metadata.proposedRoute !== undefined) {
    const route = object(metadata.proposedRoute);
    exact(route, ["provider", "model"]);
    text(route.provider);
    text(route.model);
  }
  return metadata as unknown as RoutingSelectionMetadata;
}
