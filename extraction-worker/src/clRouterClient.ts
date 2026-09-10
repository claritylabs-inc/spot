import { createHash } from "node:crypto";

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

export const CL_ROUTER_MAX_ASSET_BYTES = 12 * 1024 * 1024;
export const CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES = 16 * 1024 * 1024;
export const CL_ROUTER_MAX_ASSETS = 8;
export const CL_ROUTER_MAX_JSON_BYTES = 4 * 1024 * 1024;

export type ClRouterGenerateRequest = {
  task: string;
  taskKind?: string;
  tenantId: string;
  orgId?: string;
  settings?: ClRouterSettingsSnapshot;
  system?: string;
  messages?: ClRouterMessage[];
  prompt?: string;
  schema: Record<string, unknown>;
  schemaDialect?: "https://json-schema.org/draft/2020-12/schema";
  maxTokens?: number;
  executionBudgetMs?: number;
  sessionKey?: string;
  routing?: { pin?: ClRouterModelRoute; allowFallback?: boolean };
  trace?: Record<string, unknown>;
};

export type ClRouterRoutingMetadata = {
  decision: string;
  candidatesConsidered: ClRouterModelRoute[];
  policyVersion: string | null;
  cacheStickinessApplied: boolean;
  routeSource?: string;
  attemptCount: number;
  shadowMode?: boolean;
  wouldHaveChosen?: ClRouterModelRoute & { decision: string };
  wouldHaveMatched?: boolean;
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
  generate(input: ClRouterGenerateInput): Promise<ClRouterGenerateResponse>;
};

export type ClRouterGenerateInput = Omit<
  ClRouterGenerateRequest,
  "messages" | "prompt"
> & {
  prompt: string;
  assets?: ClRouterProviderAssets;
};

export type ClRouterClientOptions = {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
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
  if (
    !isRecord(value) ||
    !isModelRoute(value.model) ||
    !isRecord(value.usage) ||
    !isRecord(value.routing)
  ) {
    throw new ClRouterProtocolError(
      "cl-router returned an invalid generate response",
    );
  }
  const usage = value.usage;
  const routing = value.routing;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  if (
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
    typeof routing.decision !== "string" ||
    !Array.isArray(routing.candidatesConsidered) ||
    !routing.candidatesConsidered.every(isModelRoute) ||
    !(
      routing.policyVersion === null ||
      typeof routing.policyVersion === "string"
    ) ||
    typeof routing.cacheStickinessApplied !== "boolean" ||
    !isNonNegativeInteger(routing.attemptCount) ||
    routing.attemptCount < 1 ||
    (routing.routeSource !== undefined &&
      typeof routing.routeSource !== "string") ||
    (routing.shadowMode !== undefined &&
      typeof routing.shadowMode !== "boolean") ||
    (routing.wouldHaveMatched !== undefined &&
      typeof routing.wouldHaveMatched !== "boolean") ||
    (routing.wouldHaveChosen !== undefined &&
      (!isRecord(routing.wouldHaveChosen) ||
        !isModelRoute(routing.wouldHaveChosen) ||
        typeof (routing.wouldHaveChosen as Record<string, unknown>).decision !==
          "string"))
  ) {
    throw new ClRouterProtocolError(
      "cl-router returned invalid generate metadata",
    );
  }
  return {
    ...(value as ClRouterGenerateResponse),
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
  const { assets, prompt, settings, ...rest } = input;
  const request: ClRouterGenerateRequest = {
    ...rest,
    ...(settings
      ? {
          settings: {
            ...(settings.routes ? { routes: settings.routes } : {}),
            ...(settings.routeSources
              ? { routeSources: settings.routeSources }
              : {}),
          },
        }
      : {}),
    ...(rest.executionBudgetMs === undefined && executionBudgetMs !== undefined
      ? { executionBudgetMs }
      : {}),
    ...requestInput(prompt, assets),
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
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("CL_ROUTER_TIMEOUT_MS must be a positive integer");
  }
  const fetchImpl = options.fetch ?? fetch;
  const generateUrl = new URL(
    "v1/generate",
    `${baseUrl.toString().replace(/\/$/, "")}/`,
  );
  const executionBudgetMs = Math.min(
    15 * 60_000,
    Math.max(100, options.timeoutMs - 1_000),
  );

  return {
    async generate(input) {
      const signal = AbortSignal.timeout(options.timeoutMs);
      const request = buildClRouterGenerateRequest(input, executionBudgetMs);
      assertRouterCanFetchAssets(request, baseUrl);
      const requestBody = JSON.stringify(request);
      let response: Response;
      try {
        response = await fetchImpl(generateUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.secret}`,
            "content-type": "application/json",
          },
          body: requestBody,
          signal,
        });
      } catch (error) {
        throw new ClRouterConnectionError(
          signal.aborted ? "timeout" : "connection",
          error,
        );
      }
      if (!response.ok) throw await httpError(response);
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new ClRouterProtocolError(
          `cl-router returned non-JSON success response: ${error instanceof Error ? error.name : "unknown"}`,
        );
      }
      return parseGenerateResponse(body);
    },
  };
}
