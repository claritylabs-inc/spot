import { createHash } from "node:crypto";
import {
  clRouterMessagesHaveVision,
  mapSpotCallToClRouterPrimitive,
  type ClRouterPrimitive,
  type ClRouterRequirements,
} from "./clRouterPrimitive.js";

export type ClRouterModelRoute = {
  provider: string;
  model: string;
};

export type ClRouterSettingsSnapshot = {
  routes?: Record<string, ClRouterModelRoute | undefined>;
  routeSources?: Record<string, string | undefined>;
};

export type ClRouterAssetReference = {
  url: string;
  mediaType: string;
  filename?: string;
  sizeBytes: number;
  sha256?: string;
};

export type ClRouterMessagePart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "image"; source: ClRouterAssetReference }
  | { type: "file"; data: string; mediaType: string; filename?: string }
  | { type: "file"; source: ClRouterAssetReference };

export type ClRouterMessage = {
  role: "user";
  content: ClRouterMessagePart[];
};

export type ClRouterProviderAssets = {
  pdfUrl?: string;
  pdfBase64?: string;
  pdfBytes?: Uint8Array;
  mimeType?: string;
  images?: Array<
    | { imageBase64: string; mimeType?: string }
    | { source: ClRouterAssetReference }
  >;
};

export type ClRouterTraceTagValue = string | number | boolean | null;

/** Trace metadata as cl-router accepts it; the router validates it strictly. */
export type ClRouterTraceMetadata = {
  traceId?: string;
  parentRequestId?: string;
  caller?: string;
  tags?: Record<string, ClRouterTraceTagValue>;
};

/** Worker-side trace input; extra keys are folded into `tags` on the wire. */
export type ClRouterTraceInput = {
  traceId?: string;
  parentRequestId?: string;
  caller?: string;
  tags?: Record<string, ClRouterTraceTagValue>;
  [key: string]: unknown;
};

export const CL_ROUTER_MAX_ASSET_BYTES = 12 * 1024 * 1024;
export const CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES = 16 * 1024 * 1024;
export const CL_ROUTER_MAX_ASSETS = 8;
export const CL_ROUTER_MAX_JSON_BYTES = 4 * 1024 * 1024;

export type ClRouterGenerateRequest = {
  tenantId: string;
  orgId?: string;
  primitive: ClRouterPrimitive;
  requirements?: ClRouterRequirements;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  route?: ClRouterModelRoute;
  trace?: ClRouterTraceMetadata;
};

export type ClRouterRoutingMetadata = {
  decision: "routed" | "manual";
  primitive?: string;
  difficulty?: "simple" | "standard" | "complex" | null;
  requiredTier?: 1 | 2 | 3;
  selectedTier?: 1 | 2 | 3;
  route: ClRouterModelRoute;
  source?: "jev" | "fallback" | "manual";
  attemptCount: number;
};

export type ClRouterGenerateResponse = {
  output: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };
  costUsd: number | null;
  costStatus: "priced" | "unpriced";
  model: ClRouterModelRoute;
  routing: ClRouterRoutingMetadata;
  finishReason?: string;
  requestId: string;
};

export type ClRouterClient = {
  generate(
    input: ClRouterGenerateInput,
    executeJob?: (request: ClRouterGenerateRequest) => Promise<unknown>,
  ): Promise<ClRouterGenerateResponse>;
};

export type ClRouterGenerateInput = Omit<
  ClRouterGenerateRequest,
  "messages" | "prompt" | "primitive" | "requirements"
> & {
  prompt: string;
  task?: string;
  taskKind?: string;
  trace?: ClRouterTraceInput;
  assets?: ClRouterProviderAssets;
};

export type ClRouterClientOptions = {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
};

export class ClRouterConnectionError extends Error {
  readonly kind: "connection" | "timeout";

  constructor(kind: "connection" | "timeout", cause: unknown) {
    super(
      kind === "timeout"
        ? "cl-router request timed out"
        : "cl-router connection failed",
      {
        cause,
      },
    );
    this.name = "ClRouterConnectionError";
    this.kind = kind;
  }
}

export class ClRouterHttpError extends Error {
  readonly status: number;
  readonly routerCode?: ClRouterFailureCode;
  readonly retryable?: boolean;
  readonly executionStarted?: boolean;
  readonly requestId?: string;

  constructor(
    status: number,
    statusText: string,
    options?: {
      message?: string;
      routerCode?: ClRouterFailureCode;
      retryable?: boolean;
      executionStarted?: boolean;
      requestId?: string;
    },
  ) {
    super(
      options?.message ??
        `cl-router returned HTTP ${status}${statusText ? ` ${statusText}` : ""}`,
    );
    this.name = "ClRouterHttpError";
    this.status = status;
    if (options?.routerCode !== undefined) this.routerCode = options.routerCode;
    if (options?.retryable !== undefined) this.retryable = options.retryable;
    if (options?.executionStarted !== undefined)
      this.executionStarted = options.executionStarted;
    if (options?.requestId !== undefined) this.requestId = options.requestId;
  }
}

export class ClRouterProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClRouterProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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

const GENERATE_WIRE_KEYS = [
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
] as const;

export function wireClRouterGenerateRequest(
  request: ClRouterGenerateRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    tenantId: request.tenantId,
  };
  for (const key of GENERATE_WIRE_KEYS) {
    if (request[key] !== undefined) body[key] = request[key];
  }
  const trace = normalizeClRouterTrace(request.trace);
  if (trace) body.trace = trace;
  if (request.route) {
    body.route = {
      provider: request.route.provider,
      model: request.route.model,
    };
  }
  return body;
}

export const CL_ROUTER_FAILURE_CODES = [
  "router_unavailable",
  "router_candidates_exhausted",
  "router_budget_exhausted",
  "router_rejected",
  "router_internal",
] as const;

export type ClRouterFailureCode = (typeof CL_ROUTER_FAILURE_CODES)[number];

const CL_ROUTER_FAILURE_CODE_SET = new Set<string>(CL_ROUTER_FAILURE_CODES);

function isClRouterFailureCode(value: unknown): value is ClRouterFailureCode {
  return typeof value === "string" && CL_ROUTER_FAILURE_CODE_SET.has(value);
}

async function httpError(response: Response): Promise<ClRouterHttpError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ClRouterHttpError(response.status, response.statusText);
  }
  if (
    isRecord(body) &&
    isRecord(body.error) &&
    isClRouterFailureCode(body.error.code) &&
    typeof body.error.message === "string" &&
    typeof body.error.retryable === "boolean" &&
    typeof body.error.executionStarted === "boolean" &&
    (body.error.requestId === undefined ||
      typeof body.error.requestId === "string")
  ) {
    return new ClRouterHttpError(response.status, response.statusText, {
      message: body.error.message,
      routerCode: body.error.code,
      retryable: body.error.retryable,
      executionStarted: body.error.executionStarted,
      ...(typeof body.error.requestId === "string"
        ? { requestId: body.error.requestId }
        : {}),
    });
  }
  return new ClRouterHttpError(response.status, response.statusText);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isModelRoute(value: unknown): value is ClRouterModelRoute {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    value.provider.length > 0 &&
    typeof value.model === "string" &&
    value.model.length > 0
  );
}

function parseGenerateResponse(value: unknown): ClRouterGenerateResponse {
  if (!isRecord(value) || !isRecord(value.usage) || !isRecord(value.routing)) {
    throw new ClRouterProtocolError(
      "cl-router returned an invalid generate response",
    );
  }
  const usage = value.usage;
  const routing = value.routing;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const model = isModelRoute(value.model)
    ? value.model
    : isModelRoute(routing.route)
      ? routing.route
      : null;
  if (
    !model ||
    !isNonNegativeInteger(usage.inputTokens) ||
    !isNonNegativeInteger(usage.outputTokens) ||
    !isNonNegativeInteger(usage.cachedInputTokens) ||
    !isNonNegativeInteger(cacheWriteTokens) ||
    usage.cachedInputTokens + cacheWriteTokens > usage.inputTokens ||
    (usage.reasoningTokens !== undefined &&
      !isNonNegativeInteger(usage.reasoningTokens)) ||
    !(
      value.costUsd === null ||
      (typeof value.costUsd === "number" && value.costUsd >= 0)
    ) ||
    (value.costStatus !== "priced" && value.costStatus !== "unpriced") ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    (routing.decision !== "routed" && routing.decision !== "manual") ||
    !isModelRoute(routing.route) ||
    !isNonNegativeInteger(routing.attemptCount) ||
    routing.attemptCount < 1
  ) {
    throw new ClRouterProtocolError(
      "cl-router returned invalid generate metadata",
    );
  }
  return {
    ...(value as ClRouterGenerateResponse),
    model,
    routing: {
      decision: routing.decision,
      route: routing.route,
      attemptCount: routing.attemptCount,
      ...(typeof routing.primitive === "string"
        ? { primitive: routing.primitive }
        : {}),
      ...(routing.difficulty === null ||
      routing.difficulty === "simple" ||
      routing.difficulty === "standard" ||
      routing.difficulty === "complex"
        ? { difficulty: routing.difficulty }
        : {}),
      ...(routing.requiredTier === 1 ||
      routing.requiredTier === 2 ||
      routing.requiredTier === 3
        ? { requiredTier: routing.requiredTier }
        : {}),
      ...(routing.selectedTier === 1 ||
      routing.selectedTier === 2 ||
      routing.selectedTier === 3
        ? { selectedTier: routing.selectedTier }
        : {}),
      ...(routing.source === "jev" ||
      routing.source === "fallback" ||
      routing.source === "manual"
        ? { source: routing.source }
        : {}),
    },
    usage: {
      ...(usage as ClRouterGenerateResponse["usage"]),
      cacheWriteTokens,
    },
  };
}

function embeddedPdf(
  prompt: string,
): { text: string; pdfBase64: string } | null {
  const match = prompt.match(/^([\s\S]+?\n)(JVBER[A-Za-z0-9+/=\s]{200,})$/);
  if (!match) return null;
  return {
    text: (match[1] ?? "").trim(),
    pdfBase64: (match[2] ?? "").replace(/\s/g, ""),
  };
}

function assertFetchableAssetUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new ClRouterProtocolError(
      "Referenced router assets require HTTPS URLs unless they target loopback",
    );
  }
  return url.toString();
}

function messageAssetSizes(request: ClRouterGenerateRequest): number[] {
  return (request.messages ?? []).flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "text") return [];
      if ("source" in part) return [part.source.sizeBytes];
      const data = part.type === "image" ? part.image : part.data;
      return [Buffer.from(data, "base64").byteLength];
    }),
  );
}

function assertRequestLimits(request: ClRouterGenerateRequest): void {
  const assetSizes = messageAssetSizes(request);
  if (assetSizes.length > CL_ROUTER_MAX_ASSETS) {
    throw new ClRouterProtocolError(
      `cl-router accepts at most ${CL_ROUTER_MAX_ASSETS} assets per request`,
    );
  }
  if (
    assetSizes.some((size) => size <= 0 || size > CL_ROUTER_MAX_ASSET_BYTES)
  ) {
    throw new ClRouterProtocolError(
      `cl-router assets must be between 1 and ${CL_ROUTER_MAX_ASSET_BYTES} bytes`,
    );
  }
  const aggregateBytes = assetSizes.reduce((total, size) => total + size, 0);
  if (aggregateBytes > CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES) {
    throw new ClRouterProtocolError(
      `cl-router assets exceed the ${CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES}-byte aggregate limit`,
    );
  }
  if (Buffer.byteLength(JSON.stringify(request)) > CL_ROUTER_MAX_JSON_BYTES) {
    throw new ClRouterProtocolError(
      `cl-router request exceeds the ${CL_ROUTER_MAX_JSON_BYTES}-byte JSON limit`,
    );
  }
}

function isLoopbackUrl(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

function assertRouterCanFetchAssets(
  request: ClRouterGenerateRequest,
  routerUrl: URL,
): void {
  if (isLoopbackUrl(routerUrl)) return;
  for (const message of request.messages ?? []) {
    for (const part of message.content) {
      if (part.type === "text" || !("source" in part)) continue;
      if (isLoopbackUrl(new URL(part.source.url))) {
        throw new ClRouterProtocolError(
          "Loopback router assets require a loopback cl-router deployment",
        );
      }
    }
  }
}

function requestInput(
  prompt: string,
  assets: ClRouterProviderAssets | undefined,
): Pick<ClRouterGenerateRequest, "messages" | "prompt"> {
  const images: NonNullable<ClRouterProviderAssets["images"]> = [];
  for (const image of assets?.images ?? []) {
    if ("source" in image) {
      images.push({
        source: {
          ...image.source,
          url: assertFetchableAssetUrl(image.source.url),
        },
      });
      continue;
    }
    const imageBase64 = image.imageBase64.replace(/\s/g, "");
    if (!imageBase64) {
      throw new ClRouterProtocolError(
        "Router image input must contain nonempty base64 data",
      );
    }
    images.push({ ...image, imageBase64 });
  }
  const pdfBase64 = assets?.pdfBytes
    ? Buffer.from(assets.pdfBytes).toString("base64")
    : assets?.pdfBase64?.replace(/\s/g, "");
  const pdfSizeBytes =
    assets?.pdfBytes?.byteLength ??
    (pdfBase64 ? Buffer.from(pdfBase64, "base64").byteLength : undefined);
  const pdfReference =
    assets?.pdfUrl && pdfSizeBytes
      ? {
          url: assertFetchableAssetUrl(assets.pdfUrl),
          mediaType: assets.mimeType ?? "application/pdf",
          filename: "document.pdf",
          sizeBytes: pdfSizeBytes,
          ...(pdfBase64
            ? {
                sha256: createHash("sha256")
                  .update(Buffer.from(pdfBase64, "base64"))
                  .digest("hex"),
              }
            : {}),
        }
      : undefined;
  if (images.length > 0 || pdfBase64 || pdfReference) {
    return {
      messages: [
        {
          role: "user",
          content: [
            ...images.map(
              (image): ClRouterMessagePart =>
                "source" in image
                  ? { type: "image", source: image.source }
                  : {
                      type: "image",
                      image: image.imageBase64,
                      ...(image.mimeType ? { mediaType: image.mimeType } : {}),
                    },
            ),
            ...(pdfReference
              ? [{ type: "file" as const, source: pdfReference }]
              : pdfBase64
                ? [
                    {
                      type: "file" as const,
                      data: pdfBase64,
                      mediaType: assets?.mimeType ?? "application/pdf",
                      filename: "document.pdf",
                    },
                  ]
                : []),
            { type: "text", text: prompt },
          ],
        },
      ],
    };
  }
  const extracted = embeddedPdf(prompt);
  if (extracted) {
    return {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: extracted.text },
            {
              type: "file",
              data: extracted.pdfBase64,
              mediaType: "application/pdf",
              filename: "document.pdf",
            },
          ],
        },
      ],
    };
  }
  return { prompt };
}

export function buildClRouterGenerateRequest(
  input: ClRouterGenerateInput,
  executionBudgetMs?: number,
): ClRouterGenerateRequest {
  const inputFields = requestInput(input.prompt, input.assets);
  const mapping = mapSpotCallToClRouterPrimitive({
    task: input.task,
    taskKind: input.taskKind,
    hasStructuredOutput: true,
    hasVision:
      Boolean(
        input.assets?.pdfUrl ||
          input.assets?.pdfBase64 ||
          input.assets?.pdfBytes,
      ) ||
      (input.assets?.images?.length ?? 0) > 0 ||
      clRouterMessagesHaveVision(inputFields.messages),
  });
  const trace = normalizeClRouterTrace(
    input.trace || input.task || input.taskKind
      ? {
          ...input.trace,
          ...(input.task ? { task: input.task } : {}),
          ...(input.taskKind ? { taskKind: input.taskKind } : {}),
        }
      : undefined,
  );
  const request: ClRouterGenerateRequest = {
    tenantId: input.tenantId,
    ...(input.orgId ? { orgId: input.orgId } : {}),
    primitive: mapping.primitive,
    ...(mapping.requirements ? { requirements: mapping.requirements } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...inputFields,
    schema: input.schema,
    ...(input.schemaDialect ? { schemaDialect: input.schemaDialect } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.executionBudgetMs !== undefined
      ? { executionBudgetMs: input.executionBudgetMs }
      : executionBudgetMs !== undefined
        ? { executionBudgetMs }
        : {}),
    ...(input.route ? { route: input.route } : {}),
    ...(trace ? { trace } : {}),
  };
  assertRequestLimits(request);
  return request;
}

export function createClRouterClient(
  options: ClRouterClientOptions,
): ClRouterClient {
  const baseUrl = new URL(options.baseUrl);
  const isLoopback = isLoopbackUrl(baseUrl);
  if (
    baseUrl.protocol !== "https:" &&
    !(baseUrl.protocol === "http:" && isLoopback)
  ) {
    throw new Error(
      "CL_ROUTER_URL must use HTTPS unless it targets loopback localhost, 127.0.0.1, or ::1",
    );
  }
  if (!options.secret.trim()) throw new Error("CL_ROUTER_SECRET is required");
  const fetchImpl = options.fetch ?? fetch;
  const origin = `${baseUrl.toString().replace(/\/$/, "")}/`;
  return {
    async generate(input, executeJob) {
      const request = buildClRouterGenerateRequest(input);
      if (!executeJob) assertRouterCanFetchAssets(request, baseUrl);
      const body = wireClRouterGenerateRequest(request);
      const requestBody = JSON.stringify(body);
      if (executeJob) {
        return parseGenerateResponse(
          await executeJob(body as ClRouterGenerateRequest),
        );
      }
      const generateUrl = new URL(
        request.route ? "v1/manual" : "v1/generate",
        origin,
      );
      let response: Response;
      try {
        response = await fetchImpl(generateUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.secret}`,
            "content-type": "application/json",
          },
          body: requestBody,
        });
      } catch (error) {
        throw new ClRouterConnectionError("connection", error);
      }
      if (!response.ok) throw await httpError(response);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new ClRouterProtocolError(
          `cl-router returned non-JSON success response: ${error instanceof Error ? error.name : "unknown"}`,
        );
      }
      return parseGenerateResponse(payload);
    },
  };
}
