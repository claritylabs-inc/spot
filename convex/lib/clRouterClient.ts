"use node";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { modelCallContext, modelCallResult } from "./modelCallTelemetry";

import {
  DIFFICULTIES,
  QUALITY_TIERS,
  parseDecideRequest,
  parseDecideResponse,
  type DecideRequest,
  type DecideResponse,
} from "../../contracts/cl-router/policy";

import {
  MODEL_PROVIDERS,
  MODEL_TASKS,
  type ModelProvider,
  type ModelRoute,
} from "./modelCatalog";
import type {
  ClRouterPrimitive,
  ClRouterRequirements,
  ClRouterRoutingDecision,
  ClRouterRoutingSource,
  ClRouterDifficulty,
  ClRouterQualityTier,
} from "./clRouterPrimitive";

// Preserve Spot's original opaque routing key so production policy history,
// controls, ratings, affinity, and telemetry remain one continuous tenant.
const CL_ROUTER_TENANT_ID = "glass";
export const MAX_CL_ROUTER_JSON_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_CL_ROUTER_ASSET_BYTES = 12 * 1024 * 1024;
export const MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES = 16 * 1024 * 1024;
export const MAX_CL_ROUTER_ASSET_COUNT = 8;

/** All model tasks implemented by the cl-router v1 API contract. */
export const CL_ROUTER_SUPPORTED_TASKS = MODEL_TASKS;

export type ClRouterEnvironment = Readonly<Record<string, string | undefined>>;

export type ClRouterSettingsSnapshot = {
  routes?: Record<string, ModelRoute>;
  routeSources?: Record<string, string>;
};

export type {
  ClRouterPrimitive,
  ClRouterRequirements,
} from "./clRouterPrimitive";

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

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "image"; source: ClRouterAssetReference }
  | { type: "file"; data: string; mediaType: string; filename?: string }
  | { type: "file"; source: ClRouterAssetReference }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: unknown;
    };

export type ClRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ClRouterMessagePart[];
};

export type ClRouterGenerateRequest = {
  tenantId?: string;
  orgId?: string;
  primitive: ClRouterPrimitive;
  requirements?: ClRouterRequirements;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema?: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  tools?: ClRouterToolDefinition[];
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

export type ClRouterCapabilities = {
  apiVersion: "v1";
  credentialMode: "router";
  providers: Array<{ provider: ModelProvider; configured: boolean }>;
  webRetrieval: {
    providers: Array<{
      provider: "parallel" | "exa" | "openai" | "google" | "anthropic" | "xai";
      configured: boolean;
    }>;
  };
};

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
    primary:
      | "parallel"
      | "exa"
      | "model_default"
      | "openai"
      | "google"
      | "anthropic"
      | "xai";
    route?: ModelRoute;
  };
  executionBudgetMs?: number;
};

export type ClRouterRetrieveResponse = {
  provider:
    | "parallel"
    | "exa"
    | "model_default"
    | "openai"
    | "google"
    | "anthropic"
    | "xai";
  attempts: Array<{
    provider:
      | "parallel"
      | "exa"
      | "model_default"
      | "openai"
      | "google"
      | "anthropic"
      | "xai";
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

export type ClRouterClientOptions = {
  telemetry?: Pick<ActionCtx, "runMutation">;
  environment?: ClRouterEnvironment;
  fetch?: typeof fetch;
  abortSignal?: AbortSignal;
  executeJob?: (
    operation: "generate" | "manual" | "embed" | "retrieve" | "transcribe",
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
    ["generate", "manual", "embed", "retrieve", "transcribe"].includes(
      operation,
    )
  ) {
    return options.executeJob(
      operation as "generate" | "manual" | "embed" | "retrieve" | "transcribe",
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
      throw new ClRouterRequestError(
        "configuration",
        "Router assets must be nonempty and no larger than 12 MiB",
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
  if (sizes.length > MAX_CL_ROUTER_ASSET_COUNT) {
    throw new ClRouterRequestError(
      "configuration",
      "Router requests may contain at most eight assets",
    );
  }
  if (
    sizes.reduce((sum, size) => sum + size, 0) >
    MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES
  ) {
    throw new ClRouterRequestError(
      "configuration",
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
  "requirements",
  "system",
  "messages",
  "prompt",
  "schema",
  "schemaDialect",
  "maxTokens",
  "executionBudgetMs",
  "tools",
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
  return clRouterGenerationStream(
    "/v1/manual/stream",
    request,
    options,
    (payload, clientOptions) =>
      clRouterGenerateManual(
        payload as ClRouterManualGenerateRequest,
        clientOptions,
      ),
  );
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
  return parseGenerateResponse(
    await postJson("/v1/manual", manualBody(request), options),
  );
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

const MODEL_PROVIDER_SET = new Set<ModelProvider>(MODEL_PROVIDERS);

const WEB_RETRIEVAL_PROVIDER_SET = new Set([
  "parallel",
  "exa",
  "model_default",
  "openai",
  "google",
  "anthropic",
  "xai",
]);

export async function clRouterCapabilities(
  options: ClRouterClientOptions = {},
): Promise<ClRouterCapabilities> {
  const payload = await clRouterFetch(
    "/v1/capabilities",
    { method: "GET" },
    options,
  );
  if (
    !isRecord(payload) ||
    payload.apiVersion !== "v1" ||
    payload.credentialMode !== "router" ||
    !Array.isArray(payload.providers) ||
    !payload.providers.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.provider === "string" &&
        MODEL_PROVIDER_SET.has(entry.provider as ModelProvider) &&
        typeof entry.configured === "boolean",
    ) ||
    !isRecord(payload.webRetrieval) ||
    !Array.isArray(payload.webRetrieval.providers) ||
    !payload.webRetrieval.providers.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.provider === "string" &&
        WEB_RETRIEVAL_PROVIDER_SET.has(entry.provider) &&
        typeof entry.configured === "boolean",
    )
  ) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router capabilities response is invalid",
    );
  }
  return payload as ClRouterCapabilities;
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
    typeof payload.provider !== "string" ||
    !WEB_RETRIEVAL_PROVIDER_SET.has(payload.provider) ||
    !Array.isArray(payload.attempts) ||
    !payload.attempts.every(
      (attempt) =>
        isRecord(attempt) &&
        typeof attempt.provider === "string" &&
        WEB_RETRIEVAL_PROVIDER_SET.has(attempt.provider) &&
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

