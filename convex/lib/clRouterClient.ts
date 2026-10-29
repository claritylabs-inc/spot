"use node";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { modelCallContext, modelCallResult } from "./modelCallTelemetry";
import {
  parseRouterCapabilities,
  type RouterCapabilities,
  type RouterModelEntry,
} from "./routerCapabilities";
import type { RouterJobFailure } from "./routerJobFailure";

import {
  DIFFICULTIES,
  QUALITY_TIERS,
  parseExtractRequest,
  parseExtractResponse,
  type ExtractRequest,
  type ExtractResponse,
  parseDecideRequest,
  parseDecideResponse,
  type DecideRequest,
  type DecideResponse,
} from "../../contracts/cl-router/policy";

import {
  MODEL_TASKS,
  type ModelProvider,
  type ModelRoute,
  type WebRetrievalMode,
} from "./modelCatalog";
import type {
  ClRouterPrimitive,
  ClRouterRoutingDecision,
  ClRouterRoutingSource,
  ClRouterDifficulty,
  ClRouterQualityTier,
} from "./clRouterPrimitive";

// Preserve Spot's original opaque routing key so production policy history,
// controls, ratings, affinity, and telemetry remain one continuous tenant.
const CL_ROUTER_TENANT_ID = "glass";
export const MAX_CL_ROUTER_JSON_REQUEST_BYTES = 4 * 1024 * 1024;
/**
 * cl-router accepts any number of assets up to 16 MiB decoded per request (see
 * the cl-router README). Oversized work fails with router_payload_too_large;
 * callers split it with `runWithPayloadSplitting` and retry.
 */
export const MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES = 16 * 1024 * 1024;
export const MAX_CL_ROUTER_ASSET_BYTES = MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES;

/** All model tasks implemented by the cl-router v1 API contract. */
export const CL_ROUTER_SUPPORTED_TASKS = MODEL_TASKS;

export type ClRouterEnvironment = Readonly<Record<string, string | undefined>>;

export type ClRouterSettingsSnapshot = {
  routes?: Record<string, ModelRoute>;
  routeSources?: Record<string, string>;
};

export type { ClRouterPrimitive } from "./clRouterPrimitive";

export type ClRouterTraceTagValue = string | number | boolean | null;

/**
 * Trace metadata as cl-router accepts it. The router validates this shape with
 * a strict schema, so anything outside these four keys has to travel in `tags`.
 */
export type ClRouterTraceMetadata = {
  traceId?: string;
  parentRequestId?: string;
  caller?: string;
  tags?: Record<string, ClRouterTraceTagValue>;
};

/**
 * What Spot call sites may hand the client. Spot labels (`label`, `phase`,
 * `channel`, `taskKind`, ...) are folded into `tags` before the request is
 * serialized so the router never sees an unknown key.
 */
export type ClRouterTraceInput = {
  traceId?: string;
  parentRequestId?: string;
  caller?: string;
  tags?: Record<string, ClRouterTraceTagValue>;
  [key: string]: unknown;
};

function traceTagValue(value: unknown): ClRouterTraceTagValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    default:
      return undefined;
  }
}

export function normalizeClRouterTrace(
  trace: ClRouterTraceInput | undefined,
): ClRouterTraceMetadata | undefined {
  if (!trace) return undefined;
  const normalized: ClRouterTraceMetadata = {};
  const tags: Record<string, ClRouterTraceTagValue> = {};
  for (const [key, value] of Object.entries(trace)) {
    if (value === undefined) continue;
    if (key === "tags") {
      if (!isRecord(value)) continue;
      for (const [tagKey, tagValue] of Object.entries(value)) {
        const tag = traceTagValue(tagValue);
        if (tag !== undefined) tags[tagKey] = tag;
      }
      continue;
    }
    if (
      (key === "traceId" || key === "parentRequestId" || key === "caller") &&
      typeof value === "string"
    ) {
      normalized[key] = value;
      continue;
    }
    if (key === "label" && typeof value === "string" && !normalized.caller) {
      normalized.caller = value;
    }
    const tag = traceTagValue(value);
    if (tag !== undefined) tags[key] = tag;
  }
  if (Object.keys(tags).length > 0) normalized.tags = tags;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export type ClRouterUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens?: number;
};

export type ClRouterRoutingMetadata = {
  decision: ClRouterRoutingDecision;
  primitive?: string;
  difficulty?: ClRouterDifficulty | null;
  requiredTier?: ClRouterQualityTier;
  selectedTier?: ClRouterQualityTier;
  route: ModelRoute;
  source?: ClRouterRoutingSource;
  attemptCount: number;
};

export type ClRouterResponseMetadata = {
  requestId: string;
  model: ModelRoute;
  routing: ClRouterRoutingMetadata;
  usage: ClRouterUsage;
  costUsd: number | null;
  costStatus: "priced" | "unpriced";
};

export type ClRouterFailureAttempt = {
  attempt: number;
  provider: ModelProvider;
  model: string;
  outcome: "error" | "timeout";
  errorCode?: string;
};

export type ClRouterAssetReference = {
  url: string;
  mediaType: string;
  filename?: string;
  sizeBytes: number;
  sha256?: string;
};

export function assertSpotRouterAssetUrl(
  url: URL,
  environment: ClRouterEnvironment = process.env,
): void {
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  const spotEnvironment = clean(environment.SPOT_ENV)?.toLowerCase() ?? "local";
  const hostAllowed =
    spotEnvironment === "production"
      ? url.hostname === "merry-platypus-82.convex.cloud" ||
        url.hostname === "actions.spot.insure"
      : spotEnvironment === "dev"
        ? url.hostname === "acoustic-caiman-755.convex.cloud" ||
          url.hostname === "acoustic-caiman-755.convex.site"
        : loopback;
  const pathAllowed =
    url.pathname.startsWith("/api/storage/") ||
    url.pathname === "/router-assets";
  const transportAllowed =
    spotEnvironment === "local"
      ? url.protocol === "http:"
      : url.protocol === "https:" && url.port === "";
  if (
    url.username ||
    url.password ||
    !hostAllowed ||
    !pathAllowed ||
    !transportAllowed
  ) {
    throw new ClRouterRequestError(
      "configuration",
      "Referenced router assets must use an approved Spot storage host",
    );
  }
  if (spotEnvironment === "local") {
    const configuredRouterUrl = clean(environment.CL_ROUTER_URL);
    let routerIsLoopback = false;
    if (configuredRouterUrl) {
      try {
        const routerUrl = new URL(configuredRouterUrl);
        routerIsLoopback =
          routerUrl.protocol === "http:" &&
          (routerUrl.hostname === "localhost" ||
            routerUrl.hostname === "127.0.0.1" ||
            routerUrl.hostname === "::1" ||
            routerUrl.hostname === "[::1]");
      } catch {
        routerIsLoopback = false;
      }
    }
    const callbackUrl = clean(environment.SPOT_ROUTER_CALLBACK_URL);
    let durableCallbackConfigured = false;
    if (callbackUrl) {
      try {
        const callback = new URL(callbackUrl);
        durableCallbackConfigured =
          callback.protocol === "https:" &&
          !callback.username &&
          !callback.password &&
          !callback.search &&
          !callback.hash &&
          callback.pathname === "/";
      } catch {
        /* Invalid callback configuration cannot authorize local snapshots. */
      }
    }
    if (!routerIsLoopback && !durableCallbackConfigured) {
      throw new ClRouterRequestError(
        "configuration",
        "Loopback assets require a local router or a durable callback tunnel",
      );
    }
  }
}

export async function clRouterAssetReferenceFromUrl(options: {
  url: URL;
  mediaType: string;
  filename?: string;
  sizeBytes?: number;
  fetch?: typeof globalThis.fetch;
  environment?: ClRouterEnvironment;
}): Promise<ClRouterAssetReference> {
  assertSpotRouterAssetUrl(options.url, options.environment);
  let sizeBytes = options.sizeBytes;
  if (sizeBytes === undefined) {
    const response = await (options.fetch ?? globalThis.fetch)(options.url, {
      method: "HEAD",
      redirect: "manual",
    });
    if (!response.ok) {
      throw new ClRouterRequestError(
        "connection",
        `Unable to inspect referenced router asset (${response.status})`,
      );
    }
    sizeBytes = Number(response.headers.get("content-length"));
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ClRouterRequestError(
      "configuration",
      "Referenced router assets require a positive content length",
    );
  }
  return {
    url: options.url.toString(),
    mediaType: options.mediaType,
    ...(options.filename ? { filename: options.filename } : {}),
    sizeBytes,
  };
}

/** Opaque provider continuation data; cl-router expects it back unchanged. */
export type ClRouterProviderMetadata = Record<string, Record<string, unknown>>;

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "image"; source: ClRouterAssetReference }
  | { type: "file"; data: string; mediaType: string; filename?: string }
  | { type: "file"; source: ClRouterAssetReference }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      providerMetadata?: ClRouterProviderMetadata;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | {
      type: "reasoning";
      text: string;
      /** cl-router sends reasoning only back to the provider that produced it. */
      provider: ModelProvider;
      providerMetadata?: ClRouterProviderMetadata;
    };

export type ClRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ClRouterMessagePart[];
};

export type ClRouterReasoningEffort = "low" | "medium" | "high";

export type ClRouterReasoningOptions = {
  /** Omitted uses the routed model's default effort. */
  effort?: ClRouterReasoningEffort;
  /** Return the assistant `message` with reasoning and provider metadata. */
  include?: boolean;
};

/** Optional request fields a router advertises in `/v1/capabilities` `features`. */
export type ClRouterFeature =
  | "inline_job_input"
  | "prompt_cache_key"
  | "agent_loop"
  | "parallel_tool_calls";

/**
 * One agent-loop step: the router asks no tool questions and offers every
 * tool with automatic choice. On a tool-result continuation, `previous` (the
 * prior step's `routing.route` and `routing.difficulty`) is reused without Jev.
 */
export type ClRouterAgentLoop = {
  previous?: { route: ModelRoute; difficulty: ClRouterDifficulty };
};

/**
 * Model-quality hint for generate/manual requests. Its field names follow
 * cl-router's benchmark-based quality rollout; send it only to a router that
 * advertises the matching capabilities feature.
 */
export type ClRouterRequirements = Readonly<Record<string, string | number>>;

export type ClRouterGenerateRequest = {
  tenantId?: string;
  orgId?: string;
  primitive: ClRouterPrimitive;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema?: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  reasoning?: ClRouterReasoningOptions;
  /** Prompt-cache affinity for requests sharing a prefix; hashed by the router. */
  cache?: { key: string };
  loop?: ClRouterAgentLoop;
  parallelToolCalls?: boolean;
  requirements?: ClRouterRequirements;
  tools?: ClRouterToolDefinition[];
  /** `caller`: Spot already chose the offered tools; cl-router skips its own tool selection. */
  toolSelection?: "router" | "caller";
  trace?: ClRouterTraceInput;
};

export type ClRouterManualGenerateRequest = ClRouterGenerateRequest & {
  route: ModelRoute;
};

export type ClRouterToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type ClRouterGenerateResponse = ClRouterResponseMetadata & {
  output: unknown;
  finishReason?: string;
  /** With `reasoning.include`: the assistant message to send back next turn. */
  message?: unknown;
};

export type ClRouterStreamEvent =
  | { type: "text-delta"; id: string; delta: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | ({ type: "done"; finishReason: string } & ClRouterResponseMetadata)
  | {
      type: "error";
      error: {
        code: string;
        message: string;
        retryable: boolean;
        executionStarted?: boolean;
        requestId?: string;
        attempts?: ClRouterFailureAttempt[];
      };
    };

export type ClRouterGenerateStreamResponse = {
  events: AsyncIterable<ClRouterStreamEvent>;
  headers: Headers;
};

export type ClRouterEmbedRequest = {
  tenantId?: string;
  orgId?: string;
  texts: string[];
  dimensions?: number;
  trace?: ClRouterTraceInput;
};

export type ClRouterEmbedResponse = ClRouterResponseMetadata & {
  embeddings: number[][];
};

export type ClRouterTranscribeRequest = {
  tenantId?: string;
  orgId?: string;
  audio: ClRouterAssetReference;
  prompt?: string;
  trace?: ClRouterTraceInput;
};

export type ClRouterTranscribeResponse = ClRouterResponseMetadata & {
  text: string;
  durationSeconds?: number;
};

export type ClRouterCapabilities = RouterCapabilities;

export type ClRouterRetrieveRequest = {
  tenantId?: string;
  orgId?: string;
  input: {
    query?: string;
    url?: string;
    goal?: string;
    allowedDomains?: string[];
    maxResults?: number;
  };
  config?: {
    primary: WebRetrievalMode;
    route?: ModelRoute;
  };
  executionBudgetMs?: number;
};

export type ClRouterBrowseSkillName =
  | "inbox.wait_for_email"
  | "account.signup"
  | "account.sign_in"
  | "account.verify_email"
  | "account.enter_otp"
  | "account.cleanup"
  | "challenge.captcha"
  | "site.find_pages"
  | "page.dismiss_overlays"
  | "checkout.observe_payment";

export type ClRouterBrowseRequest = {
  tenantId?: string;
  orgId?: string;
  trace?: ClRouterTraceInput;
  input: {
    url: string;
    goal: string;
    allowedDomains: string[];
    maxSteps?: number;
    outputSchema?: Record<string, unknown>;
    signup?: {
      email: string;
      password: string;
      name: string;
      inboxUrl?: string;
    };
  };
  config?: { skills?: ClRouterBrowseSkillName[] };
  executionBudgetMs?: number;
};

export type ClRouterBrowseSkillOutcome = {
  name: string;
  version: string;
  status: "succeeded" | "blocked" | "failed" | "skipped";
  summary: string;
  steps: number;
};

export type ClRouterBrowseResponse = {
  provider: string;
  model: string;
  output?: unknown;
  text: string;
  finished: boolean;
  steps: number;
  pages: Array<{ url: string; title: string; text: string }>;
  networkHosts: string[];
  redirects?: string[];
  adoptedDomains?: string[];
  signupSubmitted?: boolean;
  actions?: Array<{ tool: string; input: string; result: string }>;
  skills?: ClRouterBrowseSkillOutcome[];
  error?: string;
};

export type ClRouterRetrieveResponse = {
  provider: string;
  attempts: Array<{
    provider: string;
    ok: boolean;
    error?: string;
  }>;
  text: string;
  sources: Array<{ title?: string; url: string; snippet?: string }>;
  warnings?: string[];
};

export type ClRouterErrorKind =
  | "configuration"
  | "connection"
  | "timeout"
  | "aborted"
  | "server"
  | "client"
  | "invalid_response";

export const CL_ROUTER_FAILURE_CODES = [
  "router_unavailable",
  "router_candidates_exhausted",
  "router_budget_exhausted",
  "router_rejected",
  "router_payload_too_large",
  "router_internal",
] as const;

export type ClRouterFailureCode = (typeof CL_ROUTER_FAILURE_CODES)[number];

const CL_ROUTER_FAILURE_CODE_SET = new Set<string>(CL_ROUTER_FAILURE_CODES);

export class ClRouterRequestError extends Error {
  readonly kind: ClRouterErrorKind;
  readonly status?: number;
  readonly routerCode?: ClRouterFailureCode;
  readonly retryable?: boolean;
  readonly executionStarted?: boolean;
  readonly requestId?: string;
  readonly attempts: readonly ClRouterFailureAttempt[];

  constructor(
    kind: ClRouterErrorKind,
    message: string,
    options?: {
      status?: number;
      cause?: unknown;
      routerCode?: ClRouterFailureCode;
      retryable?: boolean;
      executionStarted?: boolean;
      requestId?: string;
      attempts?: readonly ClRouterFailureAttempt[];
    },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ClRouterRequestError";
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.routerCode !== undefined) this.routerCode = options.routerCode;
    if (options?.retryable !== undefined) this.retryable = options.retryable;
    if (options?.executionStarted !== undefined)
      this.executionStarted = options.executionStarted;
    if (options?.requestId !== undefined) this.requestId = options.requestId;
    this.attempts = options?.attempts ?? [];
  }
}

/** Request too large for one router call; the caller should split its input. */
export function clRouterPayloadTooLargeError(message: string): ClRouterRequestError {
  return new ClRouterRequestError("configuration", message, {
    status: 413,
    routerCode: "router_payload_too_large",
    retryable: false,
    executionStarted: false,
  });
}

/** True when the error, or an error it wraps (AI SDK retries/causes), is a too-large failure. */
export function isClRouterPayloadTooLarge(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof ClRouterRequestError &&
      current.routerCode === "router_payload_too_large"
    )
      return true;
    const record = current as { lastError?: unknown; cause?: unknown };
    current = record.lastError ?? record.cause;
  }
  return false;
}

/**
 * Runs `run` over all items; when the router reports the request is too large,
 * splits the items in half and retries each half, recursively. Results are in
 * item order. A single item that is still too large rethrows.
 */
export async function runWithPayloadSplitting<T, R>(
  items: readonly T[],
  run: (part: T[]) => Promise<R>,
): Promise<R[]> {
  try {
    return [await run([...items])];
  } catch (error) {
    if (!isClRouterPayloadTooLarge(error) || items.length <= 1) throw error;
    const middle = Math.ceil(items.length / 2);
    return [
      ...(await runWithPayloadSplitting(items.slice(0, middle), run)),
      ...(await runWithPayloadSplitting(items.slice(middle), run)),
    ];
  }
}

export type ClRouterClientOptions = {
  telemetry?: Pick<ActionCtx, "runMutation">;
  environment?: ClRouterEnvironment;
  fetch?: typeof fetch;
  abortSignal?: AbortSignal;
  executeJob?: (
    operation: "generate" | "manual" | "embed" | "retrieve" | "transcribe" | "browse",
    payload: unknown,
    abortSignal?: AbortSignal,
  ) => Promise<unknown>;
};

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function clientConfig(environment: ClRouterEnvironment) {
  const rawUrl = clean(environment.CL_ROUTER_URL)?.replace(/\/+$/, "");
  const secret = clean(environment.CL_ROUTER_SECRET);
  if (!rawUrl || !secret) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL and CL_ROUTER_SECRET are required when a router task is enabled",
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL must be a valid HTTP or HTTPS URL",
      { cause: error },
    );
  }
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ClRouterRequestError(
      "configuration",
      "CL_ROUTER_URL must use HTTPS unless it targets loopback localhost, 127.0.0.1, or ::1",
    );
  }
  return {
    url: url.toString().replace(/\/+$/, ""),
    secret,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClRouterFailureCode(
  value: unknown,
): value is ClRouterFailureCode {
  return typeof value === "string" && CL_ROUTER_FAILURE_CODE_SET.has(value);
}

function readClRouterFailure(value: unknown):
  | (Pick<
      ClRouterRequestError,
      "routerCode" | "retryable" | "executionStarted" | "requestId" | "attempts"
    > & {
      message: string;
    })
  | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const error = value.error;
  if (
    !isClRouterFailureCode(error.code) ||
    typeof error.message !== "string" ||
    typeof error.retryable !== "boolean" ||
    typeof error.executionStarted !== "boolean" ||
    (error.requestId !== undefined && typeof error.requestId !== "string")
  ) {
    return null;
  }
  return {
    routerCode: error.code,
    message: error.message,
    retryable: error.retryable,
    executionStarted: error.executionStarted,
    ...(typeof error.requestId === "string"
      ? { requestId: error.requestId }
      : {}),
    attempts: readFailureAttempts(error.attempts),
  };
}

async function responseFailure(
  response: Response,
): Promise<ClRouterRequestError> {
  let failure: ReturnType<typeof readClRouterFailure> = null;
  try {
    failure = readClRouterFailure(await response.json());
  } catch {
    // The status still determines the untyped transport error below.
  }
  if (failure) {
    const { message, ...metadata } = failure;
    return new ClRouterRequestError(
      response.status >= 500 ? "server" : "client",
      message,
      { status: response.status, ...metadata },
    );
  }
  return new ClRouterRequestError(
    response.status >= 500 ? "server" : "client",
    `cl-router returned HTTP ${response.status}`,
    { status: response.status },
  );
}

function isModelRoute(value: unknown): value is ModelRoute {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.model === "string" &&
    value.model.length > 0
  );
}

function readFailureAttempts(value: unknown): ClRouterFailureAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ClRouterFailureAttempt[] => {
    if (!isRecord(item)) return [];
    const attempt = item.attempt;
    const outcome = item.outcome;
    const failureErrorCode = item.errorCode;
    if (
      !isModelRoute(item) ||
      !isNonNegativeInteger(attempt) ||
      attempt === 0 ||
      (outcome !== "error" && outcome !== "timeout") ||
      (failureErrorCode !== undefined && typeof failureErrorCode !== "string")
    ) {
      return [];
    }
    return [
      {
        attempt,
        provider: item.provider,
        model: item.model,
        outcome,
        ...(typeof failureErrorCode === "string"
          ? { errorCode: failureErrorCode }
          : {}),
      },
    ];
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readUsage(value: unknown): ClRouterUsage | null {
  if (!isRecord(value)) return null;
  const inputTokens = value.inputTokens;
  const outputTokens = value.outputTokens;
  const cachedInputTokens = value.cachedInputTokens;
  const cacheWriteTokens = value.cacheWriteTokens ?? 0;
  if (
    !isNonNegativeInteger(inputTokens) ||
    !isNonNegativeInteger(outputTokens) ||
    !isNonNegativeInteger(cachedInputTokens) ||
    !isNonNegativeInteger(cacheWriteTokens) ||
    cachedInputTokens + cacheWriteTokens > inputTokens ||
    (value.reasoningTokens !== undefined &&
      !isNonNegativeInteger(value.reasoningTokens))
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    ...(typeof value.reasoningTokens === "number"
      ? { reasoningTokens: value.reasoningTokens }
      : {}),
  };
}

const ROUTING_DECISIONS = new Set<ClRouterRoutingDecision>([
  "routed",
  "manual",
]);
const ROUTING_SOURCES = new Set<ClRouterRoutingSource>([
  "jev",
  "fallback",
  "manual",
  "loop",
]);
const ROUTING_DIFFICULTIES = new Set<ClRouterDifficulty>(DIFFICULTIES);

function isQualityTier(value: unknown): value is ClRouterQualityTier {
  return QUALITY_TIERS.includes(value as ClRouterQualityTier);
}

function readRouting(value: unknown): ClRouterRoutingMetadata | null {
  if (!isRecord(value)) return null;
  if (
    !ROUTING_DECISIONS.has(value.decision as ClRouterRoutingDecision) ||
    !isModelRoute(value.route) ||
    !isNonNegativeInteger(value.attemptCount) ||
    value.attemptCount < 1
  ) {
    return null;
  }
  if (
    (value.primitive !== undefined && typeof value.primitive !== "string") ||
    (value.difficulty !== undefined &&
      value.difficulty !== null &&
      !ROUTING_DIFFICULTIES.has(value.difficulty as ClRouterDifficulty)) ||
    (value.requiredTier !== undefined && !isQualityTier(value.requiredTier)) ||
    (value.selectedTier !== undefined && !isQualityTier(value.selectedTier)) ||
    (value.source !== undefined &&
      !ROUTING_SOURCES.has(value.source as ClRouterRoutingSource))
  ) {
    return null;
  }
  return {
    decision: value.decision as ClRouterRoutingDecision,
    route: { provider: value.route.provider, model: value.route.model },
    attemptCount: value.attemptCount,
    ...(typeof value.primitive === "string"
      ? { primitive: value.primitive }
      : {}),
    ...(value.difficulty === null ||
    ROUTING_DIFFICULTIES.has(value.difficulty as ClRouterDifficulty)
      ? { difficulty: value.difficulty as ClRouterDifficulty | null }
      : {}),
    ...(isQualityTier(value.requiredTier)
      ? { requiredTier: value.requiredTier }
      : {}),
    ...(isQualityTier(value.selectedTier)
      ? { selectedTier: value.selectedTier }
      : {}),
    ...(ROUTING_SOURCES.has(value.source as ClRouterRoutingSource)
      ? { source: value.source as ClRouterRoutingSource }
      : {}),
  };
}

function readResponseMetadata(
  value: Record<string, unknown>,
): ClRouterResponseMetadata | null {
  const usage = readUsage(value.usage);
  const routing = readRouting(value.routing);
  const model = isModelRoute(value.model) ? value.model : routing?.route;
  if (
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    !model ||
    !usage ||
    !routing ||
    !(
      value.costUsd === null ||
      (typeof value.costUsd === "number" &&
        Number.isFinite(value.costUsd) &&
        value.costUsd >= 0)
    ) ||
    (value.costStatus !== "priced" && value.costStatus !== "unpriced")
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    model,
    usage,
    routing,
    costUsd: value.costUsd,
    costStatus: value.costStatus,
  };
}

async function clRouterFetch(
  path: string,
  init: RequestInit,
  options: ClRouterClientOptions,
): Promise<unknown> {
  const environment = options.environment ?? process.env;
  const config = clientConfig(environment);
  const fetchImplementation = options.fetch ?? fetch;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.abortSignal?.aborted) controller.abort();
  else
    options.abortSignal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  try {
    let response: Response;
    try {
      response = await fetchImplementation(`${config.url}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.secret}`,
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new ClRouterRequestError(
        options.abortSignal?.aborted ? "aborted" : "connection",
        options.abortSignal?.aborted
          ? "cl-router request aborted"
          : "cl-router connection failed",
        { cause: error },
      );
    }
    if (!response.ok) throw await responseFailure(response);
    try {
      return await response.json();
    } catch (error) {
      throw new ClRouterRequestError(
        "invalid_response",
        "cl-router returned invalid JSON",
        { cause: error },
      );
    }
  } finally {
    options.abortSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function postJson(
  path: string,
  body: unknown,
  options: ClRouterClientOptions,
): Promise<unknown> {
  validateRouterAssets(body, options.environment ?? process.env);
  const serialized = serializeRouterRequest(body);
  const operation = path.replace(/^\/v1\//, "").split("/")[0];
  if (
    options.executeJob &&
    ["generate", "manual", "embed", "retrieve", "transcribe", "browse"].includes(
      operation,
    )
  ) {
    return options.executeJob(
      operation as "generate" | "manual" | "embed" | "retrieve" | "transcribe" | "browse",
      body,
      options.abortSignal,
    );
  }
  return clRouterFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    },
    options,
  );
}

function serializeRouterRequest(body: unknown): string {
  const serialized = JSON.stringify(body);
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_CL_ROUTER_JSON_REQUEST_BYTES
  ) {
    throw new ClRouterRequestError(
      "configuration",
      "cl-router JSON requests may not exceed 4 MiB",
    );
  }
  return serialized;
}

function inlineAssetBytes(data: string): number {
  const compact = data.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new ClRouterRequestError(
      "configuration",
      "Router inline assets require base64 data",
    );
  }
  return Buffer.from(compact, "base64").byteLength;
}

function validateRouterAssets(
  body: unknown,
  environment: ClRouterEnvironment,
): void {
  if (!isRecord(body)) return;
  const sizes: number[] = [];
  const add = (size: number) => {
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_CL_ROUTER_ASSET_BYTES
    ) {
      if (Number.isSafeInteger(size) && size > 0)
        throw clRouterPayloadTooLargeError(
          "A router asset exceeds the 16 MiB request limit",
        );
      throw new ClRouterRequestError(
        "configuration",
        "Router assets must be nonempty",
      );
    }
    sizes.push(size);
  };
  const addSource = (source: Record<string, unknown>) => {
    if (typeof source.url !== "string") {
      throw new ClRouterRequestError(
        "configuration",
        "Router asset references require a URL",
      );
    }
    let url: URL;
    try {
      url = new URL(source.url);
    } catch (error) {
      throw new ClRouterRequestError(
        "configuration",
        "Router asset reference URL is invalid",
        { cause: error },
      );
    }
    assertSpotRouterAssetUrl(url, environment);
    add(Number(source.sizeBytes));
  };
  if (isRecord(body.audio)) addSource(body.audio);
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!isRecord(message) || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (!isRecord(part) || (part.type !== "image" && part.type !== "file"))
          continue;
        if (isRecord(part.source)) addSource(part.source);
        else if (typeof part.data === "string")
          add(inlineAssetBytes(part.data));
        else if (typeof part.image === "string")
          add(inlineAssetBytes(part.image));
      }
    }
  }
  if (
    sizes.reduce((sum, size) => sum + size, 0) >
    MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES
  ) {
    throw clRouterPayloadTooLargeError(
      "Router request assets may contain at most 16 MiB decoded data",
    );
  }
}

function pickDefined<T extends object, K extends keyof T>(
  request: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (request[key] !== undefined) picked[key] = request[key];
  }
  return picked;
}

// cl-router validates generate/manual bodies with a strict schema, so the wire
// body is built from an explicit key list instead of spreading the request.
const GENERATE_BODY_KEYS = [
  "orgId",
  "primitive",
  "system",
  "messages",
  "prompt",
  "schema",
  "schemaDialect",
  "maxTokens",
  "executionBudgetMs",
  "reasoning",
  "cache",
  "loop",
  "parallelToolCalls",
  "tools",
  "toolSelection",
] as const satisfies readonly (keyof ClRouterGenerateRequest)[];

const EMBED_BODY_KEYS = [
  "orgId",
  "texts",
  "dimensions",
] as const satisfies readonly (keyof ClRouterEmbedRequest)[];

const TRANSCRIBE_BODY_KEYS = [
  "orgId",
  "audio",
  "prompt",
] as const satisfies readonly (keyof ClRouterTranscribeRequest)[];

const RETRIEVE_BODY_KEYS = [
  "orgId",
  "input",
  "config",
  "executionBudgetMs",
] as const satisfies readonly (keyof ClRouterRetrieveRequest)[];

function requestBody<
  T extends { tenantId?: string; trace?: ClRouterTraceInput },
  K extends keyof T,
>(
  request: T,
  keys: readonly K[],
): Partial<Pick<T, K>> & { tenantId: string; trace?: ClRouterTraceMetadata } {
  const trace = normalizeClRouterTrace(request.trace);
  return {
    tenantId: request.tenantId ?? CL_ROUTER_TENANT_ID,
    ...pickDefined(request, keys),
    ...(trace ? { trace } : {}),
  };
}

function omitEmptyTools<T extends { tools?: unknown[] }>(
  body: T,
): T | Omit<T, "tools"> {
  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    const { tools: _tools, ...rest } = body;
    return rest;
  }
  return body;
}

function generateBody(request: ClRouterGenerateRequest) {
  return omitEmptyTools(requestBody(request, GENERATE_BODY_KEYS));
}

function manualBody(request: ClRouterManualGenerateRequest) {
  return {
    ...generateBody(request),
    route: {
      provider: request.route.provider,
      model: request.route.model,
    },
  };
}

function generationBody(
  path:
    | "/v1/generate"
    | "/v1/manual"
    | "/v1/generate/stream"
    | "/v1/manual/stream",
  request: ClRouterGenerateRequest | ClRouterManualGenerateRequest,
) {
  return path.startsWith("/v1/manual")
    ? manualBody(request as ClRouterManualGenerateRequest)
    : generateBody(request);
}

function invalidStreamResponse(
  message: string,
  cause?: unknown,
): ClRouterRequestError {
  return new ClRouterRequestError(
    "invalid_response",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseStreamEventBlock(block: string): ClRouterStreamEvent | null {
  const lines = block.split(/\r?\n/);
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!eventName && dataLines.length === 0) return null;
  if (!eventName || dataLines.length === 0) {
    throw invalidStreamResponse("cl-router returned a malformed SSE event");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch (error) {
    throw invalidStreamResponse("cl-router returned invalid SSE JSON", error);
  }
  if (!isRecord(payload) || payload.type !== eventName) {
    throw invalidStreamResponse(
      "cl-router SSE event name and payload do not match",
    );
  }
  switch (payload.type) {
    case "text-delta":
      if (typeof payload.id !== "string" || typeof payload.delta !== "string") {
        throw invalidStreamResponse(
          "cl-router returned an invalid text stream event",
        );
      }
      return { type: "text-delta", id: payload.id, delta: payload.delta };
    case "tool-call":
      if (
        typeof payload.toolCallId !== "string" ||
        !payload.toolCallId ||
        typeof payload.toolName !== "string" ||
        !payload.toolName ||
        !("input" in payload)
      ) {
        throw invalidStreamResponse(
          "cl-router returned an invalid tool-call stream event",
        );
      }
      return {
        type: "tool-call",
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        input: payload.input,
      };
    case "done": {
      const metadata = readResponseMetadata(payload);
      if (!metadata || typeof payload.finishReason !== "string") {
        throw invalidStreamResponse(
          "cl-router returned an invalid done stream event",
        );
      }
      return { type: "done", finishReason: payload.finishReason, ...metadata };
    }
    case "error":
      if (
        !isRecord(payload.error) ||
        typeof payload.error.code !== "string" ||
        typeof payload.error.message !== "string" ||
        typeof payload.error.retryable !== "boolean" ||
        (payload.error.executionStarted !== undefined &&
          typeof payload.error.executionStarted !== "boolean") ||
        (payload.error.requestId !== undefined &&
          typeof payload.error.requestId !== "string")
      ) {
        throw invalidStreamResponse(
          "cl-router returned an invalid error stream event",
        );
      }
      return {
        type: "error",
        error: {
          code: payload.error.code,
          message: payload.error.message,
          retryable: payload.error.retryable,
          ...(typeof payload.error.executionStarted === "boolean"
            ? { executionStarted: payload.error.executionStarted }
            : {}),
          ...(typeof payload.error.requestId === "string"
            ? { requestId: payload.error.requestId }
            : {}),
          attempts: readFailureAttempts(payload.error.attempts),
        },
      };
    default:
      throw invalidStreamResponse("cl-router returned an unknown stream event");
  }
}

function parseGenerateResponse(payload: unknown): ClRouterGenerateResponse {
  if (!isRecord(payload)) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router generate response is invalid",
    );
  }
  const metadata = readResponseMetadata(payload);
  if (!metadata || !("output" in payload)) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router generate response is invalid",
    );
  }
  return {
    ...metadata,
    output: payload.output,
    ...(typeof payload.finishReason === "string"
      ? { finishReason: payload.finishReason }
      : {}),
    ...(payload.message === undefined ? {} : { message: payload.message }),
  };
}

export async function clRouterGenerateStream(
  request: ClRouterGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateStreamResponse> {
  return clRouterGenerationStream(
    "/v1/generate/stream",
    request,
    options,
    (payload, clientOptions) => clRouterGenerate(payload, clientOptions),
  );
}

export async function clRouterGenerateManualStream(
  request: ClRouterManualGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateStreamResponse> {
  if (
    !options.executeJob &&
    !(await clRouterRouteIsAvailable(request.route, options))
  ) {
    return clRouterGenerateStream(request, options);
  }
  let response: ClRouterGenerateStreamResponse;
  try {
    response = await clRouterGenerationStream(
      "/v1/manual/stream",
      request,
      options,
      (payload, clientOptions) =>
        clRouterGenerateManual(
          payload as ClRouterManualGenerateRequest,
          clientOptions,
        ),
    );
  } catch (error) {
    if (!isUnknownRouteRequestError(error) || options.abortSignal?.aborted)
      throw error;
    logIgnoredClRouterPin(request.route, "unknown_route");
    return clRouterGenerateStream(request, options);
  }
  const events = (async function* () {
    let outputStarted = false;
    for await (const event of response.events) {
      if (
        !outputStarted &&
        event.type === "error" &&
        !options.abortSignal?.aborted &&
        isUnknownClRouterRouteFailure(
          event.error.code,
          event.error.executionStarted,
          event.error.message,
        )
      ) {
        logIgnoredClRouterPin(request.route, "unknown_route");
        yield* (await clRouterGenerateStream(request, options)).events;
        return;
      }
      if (event.type !== "error") outputStarted = true;
      yield event;
    }
  })();
  return { ...response, events };
}

export async function clRouterGenerateMaybeManualStream(
  request: ClRouterGenerateRequest,
  route: ModelRoute | undefined,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateStreamResponse> {
  return route
    ? clRouterGenerateManualStream({ ...request, route }, options)
    : clRouterGenerateStream(request, options);
}

async function clRouterGenerationStream(
  path: "/v1/generate/stream" | "/v1/manual/stream",
  request: ClRouterGenerateRequest | ClRouterManualGenerateRequest,
  options: ClRouterClientOptions,
  complete: (
    request: ClRouterGenerateRequest | ClRouterManualGenerateRequest,
    options: ClRouterClientOptions,
  ) => Promise<ClRouterGenerateResponse>,
): Promise<ClRouterGenerateStreamResponse> {
  if (options.executeJob) {
    const response = await complete(request, options);
    const events = (async function* (): AsyncIterable<ClRouterStreamEvent> {
      const output = response.output;
      if (isRecord(output) && Array.isArray(output.toolCalls)) {
        if (typeof output.text === "string" && output.text) {
          yield {
            type: "text-delta",
            id: response.requestId,
            delta: output.text,
          };
        }
        for (const call of output.toolCalls) {
          if (
            !isRecord(call) ||
            typeof call.toolCallId !== "string" ||
            typeof call.toolName !== "string"
          ) {
            throw invalidStreamResponse(
              "cl-router returned an invalid generated tool call",
            );
          }
          yield {
            type: "tool-call",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          };
        }
      } else {
        const text =
          typeof output === "string" ? output : JSON.stringify(output);
        if (text)
          yield { type: "text-delta", id: response.requestId, delta: text };
      }
      yield {
        ...response,
        type: "done",
        finishReason: response.finishReason ?? "stop",
      };
    })();
    return { events, headers: new Headers() };
  }
  const environment = options.environment ?? process.env;
  const config = clientConfig(environment);
  const fetchImplementation = options.fetch ?? fetch;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.abortSignal?.aborted) controller.abort();
  else
    options.abortSignal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  const cleanup = () => {
    options.abortSignal?.removeEventListener("abort", abortFromCaller);
  };

  let response: Response;
  try {
    const payload = generationBody(path, request);
    validateRouterAssets(payload, environment);
    response = await fetchImplementation(`${config.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: serializeRouterRequest(payload),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    if (error instanceof ClRouterRequestError) throw error;
    throw new ClRouterRequestError(
      options.abortSignal?.aborted ? "aborted" : "connection",
      options.abortSignal?.aborted
        ? "cl-router request aborted"
        : "cl-router connection failed",
      { cause: error },
    );
  }
  if (!response.ok) {
    cleanup();
    throw await responseFailure(response);
  }
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/event-stream")
  ) {
    cleanup();
    throw invalidStreamResponse("cl-router returned a non-SSE stream response");
  }
  if (!response.body) {
    cleanup();
    throw invalidStreamResponse("cl-router returned an empty stream response");
  }

  const events = (async function* (): AsyncIterable<ClRouterStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const delimiter = /\r?\n\r?\n/.exec(buffer);
          if (!delimiter || delimiter.index === undefined) break;
          const block = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter[0].length);
          const event = parseStreamEventBlock(block);
          if (event) yield event;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseStreamEventBlock(buffer);
        if (event) yield event;
      }
    } catch (error) {
      if (error instanceof ClRouterRequestError) throw error;
      throw new ClRouterRequestError(
        options.abortSignal?.aborted ? "aborted" : "connection",
        options.abortSignal?.aborted
          ? "cl-router stream aborted"
          : "cl-router stream connection failed",
        { cause: error },
      );
    } finally {
      cleanup();
      reader.releaseLock();
    }
  })();

  return { events, headers: response.headers };
}

export async function clRouterDecide(
  request: Omit<DecideRequest, "tenantId">,
  options: ClRouterClientOptions = {},
): Promise<DecideResponse> {
  const assetBytes = Object.values(request.assets ?? {}).reduce(
    (total, asset) =>
      total +
      ("source" in asset
        ? asset.source.sizeBytes
        : Math.floor((asset.dataBase64.length * 3) / 4)),
    0,
  );
  if (assetBytes > MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES) {
    throw clRouterPayloadTooLargeError(
      "Decision images exceed the 16 MiB request limit",
    );
  }
  const body = parseDecideRequest({
    ...request,
    tenantId: CL_ROUTER_TENANT_ID,
  });
  const callKey = crypto.randomUUID();
  const telemetry = options.telemetry;
  if (telemetry)
    await telemetry.runMutation(internal.modelRoutingEvents.startCall, {
      callKey,
      operation: "decide",
      context: {
        ...modelCallContext(body),
        orgId: body.orgId as Id<"organizations"> | undefined,
      },
    });
  try {
    const payload = await postJson("/v1/decide", body, options);
    let result: DecideResponse;
    try {
      result = parseDecideResponse(payload, body);
    } catch (error) {
      throw new ClRouterRequestError(
        "invalid_response",
        "cl-router decision response is invalid",
        { cause: error },
      );
    }
    if (telemetry)
      await telemetry.runMutation(internal.modelRoutingEvents.finishCall, {
        callKey,
        status: "complete",
        result: modelCallResult(payload),
      });
    return result;
  } catch (error) {
    if (telemetry)
      await telemetry.runMutation(internal.modelRoutingEvents.finishCall, {
        callKey,
        status: "error",
        error: error instanceof Error ? error.message : "Decision failed",
      });
    throw error;
  }
}

export async function clRouterExtract(
  request: Omit<ExtractRequest, "tenantId">,
  options: ClRouterClientOptions & { orgId?: Id<"organizations"> } = {},
): Promise<ExtractResponse> {
  const body = parseExtractRequest({ ...request, tenantId: CL_ROUTER_TENANT_ID });
  const callKey = crypto.randomUUID();
  const telemetry = options.telemetry;
  if (telemetry) {
    await telemetry.runMutation(internal.modelRoutingEvents.startCall, {
      callKey,
      operation: "extract",
      context: {
        ...modelCallContext(body, "extract"),
        orgId: options.orgId,
        model: "clairic",
        callProvider: "cloudflare",
        routeSource: "fixed",
      },
    });
  }
  try {
    const payload = await postJson("/v1/extract", body, options);
    let result: ExtractResponse;
    try {
      result = parseExtractResponse(payload, body);
    } catch (error) {
      throw new ClRouterRequestError("invalid_response", "cl-router extraction response is invalid", { cause: error });
    }
    if (telemetry) {
      await telemetry.runMutation(internal.modelRoutingEvents.finishCall, {
        callKey,
        status: "complete",
        result: {
          ...modelCallResult(result),
          model: "clairic",
          callProvider: "cloudflare",
          routeSource: "fixed",
        },
      });
    }
    return result;
  } catch (error) {
    if (telemetry) {
      await telemetry.runMutation(internal.modelRoutingEvents.finishCall, {
        callKey,
        status: "error",
        error: error instanceof Error ? error.message : "Extraction failed",
      });
    }
    throw error;
  }
}

export async function clRouterGenerate(
  request: ClRouterGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateResponse> {
  return parseGenerateResponse(
    await postJson("/v1/generate", generateBody(request), options),
  );
}

export async function clRouterGenerateManual(
  request: ClRouterManualGenerateRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateResponse> {
  // Durable execution owns pin checks so a resumed invocation first reconnects
  // to its existing job, regardless of subsequent registry changes.
  if (
    !options.executeJob &&
    !(await clRouterRouteIsAvailable(request.route, options))
  ) {
    return clRouterGenerate(request, options);
  }
  try {
    return parseGenerateResponse(
      await postJson("/v1/manual", manualBody(request), options),
    );
  } catch (error) {
    if (
      options.executeJob ||
      !isUnknownRouteRequestError(error) ||
      options.abortSignal?.aborted
    )
      throw error;
    logIgnoredClRouterPin(request.route, "unknown_route");
    return clRouterGenerate(request, options);
  }
}

export function isUnknownClRouterRouteFailure(
  code: unknown,
  executionStarted: unknown,
  message: string,
): boolean {
  return (
    code === "router_rejected" &&
    executionStarted === false &&
    /not in (?:the )?model registry|unknown (?:model|route)|(?:model|route).*(?:not found|not available in (?:the )?(?:model )?registry)/i.test(
      message,
    )
  );
}

/**
 * Whether Spot should retry a failed router job step. Beyond the router's own
 * verdict, `router_candidates_exhausted` is retried even after execution
 * started: no candidate produced a result, and callers key retries by step so
 * a repeat is idempotent. Failures carry no streamed-output signal, so this
 * relies on the router reporting candidates_exhausted only when every attempt
 * failed (attempt outcomes are only ever "error" or "timeout").
 */
export function isRetryableClRouterJobFailure(
  failure: Pick<RouterJobFailure, "code" | "retryable"> | undefined,
): boolean {
  return Boolean(
    failure?.retryable || failure?.code === "router_candidates_exhausted",
  );
}

function isUnknownRouteRequestError(error: unknown): boolean {
  return (
    error instanceof ClRouterRequestError &&
    isUnknownClRouterRouteFailure(
      error.routerCode,
      error.executionStarted,
      error.message,
    )
  );
}

export function logIgnoredClRouterPin(
  route: ModelRoute | undefined,
  reason: string,
): void {
  console.warn(
    "[cl-router] Ignoring unavailable pin; using routed generation",
    { route, reason },
  );
}

export async function clRouterRouteIsAvailable(
  route: ModelRoute,
  options: ClRouterClientOptions = {},
): Promise<boolean> {
  let models: RouterModelEntry[] | undefined;
  try {
    models = (await clRouterCapabilities(options)).models;
  } catch (error) {
    if (options.abortSignal?.aborted) throw error;
    console.warn(
      "[cl-router] Pin availability check unavailable; deferring validation to manual execution",
      { route },
    );
    return true;
  }
  if (!models) return true;
  const available = models.some(
    (entry) =>
      entry.configured &&
      entry.provider === route.provider &&
      entry.model === route.model,
  );
  if (!available) logIgnoredClRouterPin(route, "capabilities");
  return available;
}

export async function clRouterGenerateMaybeManual(
  request: ClRouterGenerateRequest,
  route: ModelRoute | undefined,
  options: ClRouterClientOptions = {},
): Promise<ClRouterGenerateResponse> {
  return route
    ? clRouterGenerateManual({ ...request, route }, options)
    : clRouterGenerate(request, options);
}

/** Unavailable capabilities advertise no optional features. */
export function clRouterSupports(
  capabilities: ClRouterCapabilities | undefined,
  feature: ClRouterFeature,
): boolean {
  return capabilities?.features?.includes(feature) ?? false;
}

const CAPABILITIES_CACHE_TTL_MS = 60_000;
let cachedCapabilities:
  | { url: string; expiresAt: number; value: ClRouterCapabilities }
  | undefined;

/**
 * Live provider/model catalog. Successful reads are cached briefly per router
 * URL; injected transports (tests) always fetch. Failures throw so callers
 * choose their own unavailable state.
 */
export async function clRouterCapabilities(
  options: ClRouterClientOptions = {},
): Promise<ClRouterCapabilities> {
  const url = options.fetch
    ? undefined
    : clientConfig(options.environment ?? process.env).url;
  if (
    url &&
    cachedCapabilities?.url === url &&
    cachedCapabilities.expiresAt > dayjs().valueOf()
  ) {
    return cachedCapabilities.value;
  }
  const capabilities = parseRouterCapabilities(
    await clRouterFetch("/v1/capabilities", { method: "GET" }, options),
  );
  if (!capabilities) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router capabilities response is invalid",
    );
  }
  if (url) {
    cachedCapabilities = {
      url,
      expiresAt: dayjs().add(CAPABILITIES_CACHE_TTL_MS, "ms").valueOf(),
      value: capabilities,
    };
  }
  return capabilities;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function clRouterRetrieve(
  request: ClRouterRetrieveRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterRetrieveResponse> {
  const payload = await postJson(
    "/v1/retrieve",
    requestBody(request, RETRIEVE_BODY_KEYS),
    options,
  );
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.provider) ||
    !Array.isArray(payload.attempts) ||
    !payload.attempts.every(
      (attempt) =>
        isRecord(attempt) &&
        isNonEmptyString(attempt.provider) &&
        typeof attempt.ok === "boolean" &&
        (attempt.error === undefined || typeof attempt.error === "string"),
    ) ||
    typeof payload.text !== "string" ||
    !Array.isArray(payload.sources) ||
    !payload.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.url === "string" &&
        (source.title === undefined || typeof source.title === "string") &&
        (source.snippet === undefined || typeof source.snippet === "string"),
    ) ||
    (payload.warnings !== undefined &&
      (!Array.isArray(payload.warnings) ||
        !payload.warnings.every((warning) => typeof warning === "string")))
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router retrieval response is invalid",
    );
  }
  return payload as ClRouterRetrieveResponse;
}

const BROWSE_BODY_KEYS = [
  "orgId",
  "input",
  "config",
  "executionBudgetMs",
] as const satisfies readonly (keyof ClRouterBrowseRequest)[];

/** Hosted-browser agent run. Browse is durable-only, so options must come from a durable job client. */
export async function clRouterBrowse(
  request: ClRouterBrowseRequest,
  options: ClRouterClientOptions,
): Promise<ClRouterBrowseResponse> {
  if (!options.executeJob)
    throw new ClRouterRequestError(
      "configuration",
      "cl-router browse requires a durable job client",
    );
  const payload = await postJson(
    "/v1/browse",
    requestBody(request, BROWSE_BODY_KEYS),
    options,
  );
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.provider) ||
    typeof payload.text !== "string" ||
    typeof payload.finished !== "boolean" ||
    !Array.isArray(payload.networkHosts) ||
    !payload.networkHosts.every((host) => typeof host === "string") ||
    !Array.isArray(payload.pages) ||
    !payload.pages.every(
      (page) =>
        isRecord(page) &&
        typeof page.url === "string" &&
        typeof page.title === "string" &&
        typeof page.text === "string",
    ) ||
    (payload.skills !== undefined &&
      (!Array.isArray(payload.skills) ||
        payload.skills.length > 40 ||
        !payload.skills.every(
          (skill) =>
            isRecord(skill) &&
            typeof skill.name === "string" &&
            skill.name.length <= 100 &&
            typeof skill.version === "string" &&
            skill.version.length <= 40 &&
            typeof skill.status === "string" &&
            ["succeeded", "blocked", "failed", "skipped"].includes(
              skill.status,
            ) &&
            typeof skill.summary === "string" &&
            skill.summary.length <= 500 &&
            typeof skill.steps === "number" &&
            Number.isInteger(skill.steps) &&
            skill.steps >= 0,
        )))
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router browse response is invalid",
    );
  }
  return payload as ClRouterBrowseResponse;
}

export async function clRouterEmbed(
  request: ClRouterEmbedRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterEmbedResponse> {
  const payload = await postJson(
    "/v1/embed",
    requestBody(request, EMBED_BODY_KEYS),
    options,
  );
  if (!isRecord(payload)) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router embed response is invalid",
    );
  }
  const metadata = readResponseMetadata(payload);
  if (
    !metadata ||
    !Array.isArray(payload.embeddings) ||
    !payload.embeddings.every(
      (embedding) =>
        Array.isArray(embedding) &&
        embedding.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router embed response is invalid",
    );
  }
  const embeddings = payload.embeddings as number[][];
  if (
    embeddings.length !== request.texts.length ||
    (request.dimensions !== undefined &&
      embeddings.some((embedding) => embedding.length !== request.dimensions))
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router embed response dimensions do not match the request",
    );
  }
  return { ...metadata, embeddings };
}

export async function clRouterTranscribe(
  request: ClRouterTranscribeRequest,
  options: ClRouterClientOptions = {},
): Promise<ClRouterTranscribeResponse> {
  const payload = await postJson(
    "/v1/transcribe",
    requestBody(request, TRANSCRIBE_BODY_KEYS),
    options,
  );
  if (!isRecord(payload)) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router transcription response is invalid",
    );
  }
  const responseMetadata = readResponseMetadata(payload);
  if (!responseMetadata || typeof payload.text !== "string") {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router transcription response is invalid",
    );
  }
  return {
    ...responseMetadata,
    text: payload.text,
    ...(typeof payload.durationSeconds === "number"
      ? { durationSeconds: payload.durationSeconds }
      : {}),
  };
}

