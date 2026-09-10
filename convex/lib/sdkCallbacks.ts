"use node";

/**
 * Provider-agnostic callback adapters for cl-sdk.
 *
 * Wraps Spot's existing AI SDK model routing (lib/models.ts) into the
 * simple callback interfaces the new SDK expects: GenerateText, GenerateObject, EmbedText.
 */

import dayjs from "dayjs";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";
import {
  modelTaskForCall,
  MODEL_ROUTING,
  primaryRouteForCall,
  resolveClRouterSettingsForOrg,
  type ModelCallTaskKind,
  type ModelRoute,
  type ModelTask,
} from "./models";
import {
  COVERAGE_CLEANUP_MODEL,
  EXTRACTION_QUALITY_MODEL,
  modelCapabilitiesForRoute,
  modelCapabilitiesForTask,
} from "./modelCatalog";
import { applyCarrierIdentityGuidance } from "./extractionPromptGuidance";
import type {
  GenerateText,
  GenerateObject,
  EmbedText,
  TokenUsage,
} from "@claritylabs/cl-sdk";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  cleanupSignedRouterAssets,
  createSignedActionRouterAsset,
  type RouterAssetCleanup,
} from "../actions/routerAssets";
import {
  ClRouterRequestError,
  MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES,
  MAX_CL_ROUTER_ASSET_BYTES,
  MAX_CL_ROUTER_ASSET_COUNT,
  MAX_CL_ROUTER_JSON_REQUEST_BYTES,
  clRouterAssetReferenceFromUrl,
  clRouterEmbed,
  clRouterGenerate,
  type ClRouterGenerateResponse,
  type ClRouterMessage,
  type ClRouterMessagePart,
  type ClRouterSettingsSnapshot,
  type ClRouterTraceMetadata,
} from "./clRouterClient";

type ExtractionImage = {
  imageBase64: string;
  mimeType: string;
};

type ExtractionProviderOptions = ProviderOptions & {
  pdfBase64?: string;
  pdfUrl?: URL | string;
  pdfBytes?: Uint8Array;
  fileId?: string;
  mimeType?: string;
  images?: ExtractionImage[];
};

type ModelRoutingContext = {
  ctx?: ActionCtx;
  orgId?: Id<"organizations">;
  traceId?: string;
  tracePolicyId?: Id<"policies"> | string;
};

type ParamsWithOptionalTaskKind = {
  taskKind?: unknown;
  trace?: unknown;
};

type GenerateObjectParams = Parameters<GenerateObject>[0];
type SpotGenerateObject = (
  params: Omit<GenerateObjectParams, "taskKind"> & {
    taskKind?: ModelCallTaskKind;
  },
) => ReturnType<GenerateObject>;

type ModelCallTraceDetails = {
  label?: string;
  extractorName?: string;
  startPage?: number;
  endPage?: number;
  batchIndex?: number;
  batchCount?: number;
  phase?: string;
  sourceBacked?: boolean;
};

function readTaskKind(
  params: ParamsWithOptionalTaskKind,
): ModelCallTaskKind | undefined {
  return typeof params.taskKind === "string" ? params.taskKind : undefined;
}

function readTraceDetails(
  params: ParamsWithOptionalTaskKind,
): ModelCallTraceDetails | undefined {
  if (
    !params.trace ||
    typeof params.trace !== "object" ||
    Array.isArray(params.trace)
  )
    return undefined;
  return params.trace as ModelCallTraceDetails;
}

function nowMs(): number {
  return dayjs().valueOf();
}

function modelTraceLabel(
  kind: "generateText" | "generateObject",
  taskKind?: ModelCallTaskKind,
  task?: ModelTask,
  trace?: ModelCallTraceDetails,
) {
  if (trace?.label) return trace.label;
  if (trace?.extractorName) {
    const pageRange = trace.startPage
      ? ` pages ${trace.startPage}${trace.endPage && trace.endPage !== trace.startPage ? `-${trace.endPage}` : ""}`
      : "";
    return `${trace.extractorName}${pageRange}`;
  }
  if (trace?.phase === "format" && trace.batchIndex && trace.batchCount) {
    return `Format extracted content ${trace.batchIndex}/${trace.batchCount}`;
  }
  const labels: Record<string, string> = {
    extraction_classify: "Classify document",
    extraction_coverage_cleanup: "Clean coverage schedules",
    extraction_source_tree: "Build source-native document tree",
    extraction_operational_profile: "Build operational profile",
    extraction_page_map: "Map policy pages",
    extraction_focused: "Extract policy fields",
    extraction_long_list: "Extract long policy lists",
    extraction_referential_lookup: "Resolve policy references",
    extraction_review: "Review extraction evidence",
    extraction_summary: "Summarize extracted policy",
    extraction_format: "Format extracted policy",
    query_attachment: "Read attachment",
    query_classify: "Classify question",
    query_reason: "Reason over documents",
    query_verify: "Verify answer evidence",
    query_respond: "Write answer",
    pce_impact_analysis: "Analyze policy change",
    pce_reply_parse: "Parse policy-change reply",
    pce_packet_generation: "Generate policy-change packet",
  };
  if (taskKind && labels[taskKind]) return labels[taskKind];
  if (taskKind) {
    return taskKind
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (task === "extraction")
    return kind === "generateText"
      ? "Extract policy text"
      : "Extract policy structure";
  if (task === "classification") return "Classify document";
  if (task === "chat")
    return kind === "generateText" ? "Generate answer" : "Analyze chat context";
  return kind === "generateText"
    ? "Generate text"
    : "Generate structured output";
}

const TRACE_TEXT_PREVIEW_LIMIT = 6000;
const TRACE_OUTPUT_PREVIEW_LIMIT = 6000;

function truncateTraceText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function redactEmbeddedPdfBase64(value: string) {
  return value.replace(/JVBER[A-Za-z0-9+/=\s]{200,}/g, (match) => {
    const compact = match.replace(/\s/g, "");
    return `[PDF base64 omitted: ${compact.length} chars]`;
  });
}

function traceTextPreview(value: unknown, limit = TRACE_TEXT_PREVIEW_LIMIT) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return truncateTraceText(redactEmbeddedPdfBase64(value), limit);
}

function traceJsonPreview(value: unknown) {
  try {
    return truncateTraceText(
      JSON.stringify(value, null, 2),
      TRACE_OUTPUT_PREVIEW_LIMIT,
    );
  } catch {
    return truncateTraceText(String(value), TRACE_OUTPUT_PREVIEW_LIMIT);
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function providerInputSummary(providerOptions: ProviderOptions | undefined) {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  if (!options) return undefined;
  return {
    hasPdfBase64: typeof options.pdfBase64 === "string",
    pdfBase64Chars:
      typeof options.pdfBase64 === "string"
        ? options.pdfBase64.length
        : undefined,
    hasPdfUrl: !!options.pdfUrl,
    pdfUrl:
      typeof options.pdfUrl === "string"
        ? options.pdfUrl
        : options.pdfUrl instanceof URL
          ? options.pdfUrl.toString()
          : undefined,
    hasPdfBytes: options.pdfBytes instanceof Uint8Array,
    pdfBytes:
      options.pdfBytes instanceof Uint8Array
        ? options.pdfBytes.byteLength
        : undefined,
    fileId: typeof options.fileId === "string" ? options.fileId : undefined,
    mimeType:
      typeof options.mimeType === "string" ? options.mimeType : undefined,
    images: Array.isArray(options.images)
      ? options.images.map((image) => ({
          mimeType: image.mimeType,
          base64Chars: image.imageBase64.length,
        }))
      : undefined,
  };
}

function modelTraceDetails(params: {
  kind: "generateText" | "generateObject";
  label: string;
  task: ModelTask;
  taskKind?: ModelCallTaskKind;
  prompt: string;
  system?: string;
  maxOutputTokens: number;
  routePurpose?: string;
  providerOptions?: ProviderOptions;
  trace?: ModelCallTraceDetails;
  output?: unknown;
  outputKind?: "text" | "object";
}) {
  return stripUndefined({
    purpose: params.label,
    callKind: params.kind,
    task: params.task,
    taskKind: params.taskKind,
    trace: params.trace,
    maxOutputTokens: params.maxOutputTokens,
    routePurpose: params.routePurpose,
    systemPreview: traceTextPreview(params.system),
    promptPreview: traceTextPreview(params.prompt),
    inputSummary: providerInputSummary(params.providerOptions),
    outputKind: params.outputKind,
    outputPreview:
      params.outputKind === "object"
        ? traceJsonPreview(params.output)
        : traceTextPreview(params.output, TRACE_OUTPUT_PREVIEW_LIMIT),
  }) as Record<string, unknown>;
}

const SECTIONS_EXTRACTOR_PROMPT_MARKER =
  "Build a compact source-backed section index for this document";

function getEffectiveMaxTokens(
  task: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  maxTokens: number,
  route?: ModelRoute,
): number {
  const routeCapabilities = route
    ? modelCapabilitiesForRoute(route)
    : modelCapabilitiesForTask(task);
  const routeMax = taskKind
    ? (routeCapabilities?.taskOutputTokens?.[taskKind] ??
      routeCapabilities?.maxOutputTokens)
    : routeCapabilities?.maxOutputTokens;
  return routeMax ? Math.min(maxTokens, routeMax) : maxTokens;
}

function coverageCleanupRouteOverride(
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
  coverageCleanupRoute: ModelRoute | undefined,
): ModelRoute | null {
  if (
    taskKind !== "extraction_coverage_cleanup" &&
    trace?.phase !== "coverage_cleanup"
  ) {
    return null;
  }
  return coverageCleanupRoute ?? COVERAGE_CLEANUP_MODEL;
}

type GenerationRoutePlan = {
  primaryRoute: ModelRoute;
  qualityRoute?: ModelRoute;
  coverageCleanupRoute?: ModelRoute;
  fallbackRoute?: ModelRoute;
  routeSource: string;
  routePurpose?: string;
  transport?: string;
};

type TextGenerationResult = {
  text: string;
  usage: TokenUsage;
  router?: ClRouterGenerateResponse;
};

type ObjectGenerationResult = {
  object: unknown;
  usage: TokenUsage;
  router?: ClRouterGenerateResponse;
};

function resolveRouterGenerationPlan(
  effectiveTask: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
  settings: ClRouterSettingsSnapshot | null,
): GenerationRoutePlan {
  const primaryRoute =
    settings?.routes?.[effectiveTask] ?? MODEL_ROUTING[effectiveTask];
  const qualityRoute =
    settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  const fallbackRoute = settings?.routes?.fallback;
  const plan: GenerationRoutePlan = {
    primaryRoute,
    qualityRoute,
    coverageCleanupRoute,
    fallbackRoute,
    routeSource: settings?.routeSources?.[effectiveTask] ?? "static",
    transport: "cl-router",
  };
  const qualityOverride = primaryRouteForCall({
    task: effectiveTask,
    taskKind,
    primaryRoute,
    qualityRoute,
  });
  if (qualityOverride) {
    plan.primaryRoute = qualityOverride;
    plan.routeSource =
      settings?.routeSources?.extraction_quality ?? plan.routeSource;
    plan.routePurpose = "extraction_quality";
  }
  const coverageOverride = coverageCleanupRouteOverride(
    taskKind,
    trace,
    coverageCleanupRoute,
  );
  if (coverageOverride) {
    plan.primaryRoute = coverageOverride;
    plan.routeSource =
      settings?.routeSources?.extraction_coverage_cleanup ?? plan.routeSource;
    plan.routePurpose = "extraction_coverage_cleanup";
  }
  return plan;
}

function knownPdfSize(
  providerOptions: Record<string, unknown> | undefined,
): number | undefined {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  if (options?.pdfBytes instanceof Uint8Array)
    return options.pdfBytes.byteLength;
  if (typeof options?.pdfBase64 === "string") {
    return Buffer.from(options.pdfBase64.replace(/\s/g, ""), "base64")
      .byteLength;
  }
  return undefined;
}

async function withClRouterPromptInput<T>(
  routing: ModelRoutingContext | undefined,
  prompt: string,
  providerOptions: Record<string, unknown> | undefined,
  execute: (
    input: Pick<Parameters<typeof clRouterGenerate>[0], "messages" | "prompt">,
  ) => Promise<T>,
): Promise<T> {
  const options = providerOptions as ExtractionProviderOptions | undefined;
  const cleanup: RouterAssetCleanup[] = [];
  let assetCount = 0;
  let decodedAssetBytes = 0;
  let estimatedInlineBytes = new TextEncoder().encode(prompt).byteLength + 1024;
  const sessionKey =
    routing?.traceId ??
    (routing?.tracePolicyId
      ? String(routing.tracePolicyId)
      : crypto.randomUUID());
  const stage = async (
    bytes: Uint8Array,
    mediaType: string,
    filename?: string,
  ): Promise<ClRouterMessagePart> => {
    assetCount += 1;
    decodedAssetBytes += bytes.byteLength;
    if (
      !bytes.byteLength ||
      bytes.byteLength > MAX_CL_ROUTER_ASSET_BYTES ||
      assetCount > MAX_CL_ROUTER_ASSET_COUNT ||
      decodedAssetBytes > MAX_CL_ROUTER_ASSET_AGGREGATE_BYTES
    ) {
      throw new ClRouterRequestError(
        "configuration",
        "Router model assets exceed the request limits",
      );
    }
    const data = Buffer.from(bytes).toString("base64");
    const inlinePart: ClRouterMessagePart = mediaType.startsWith("image/")
      ? { type: "image", image: data, mediaType }
      : { type: "file", data, mediaType, ...(filename ? { filename } : {}) };
    const inlineBytes = new TextEncoder().encode(
      JSON.stringify(inlinePart),
    ).byteLength;
    if (
      !routing?.ctx ||
      estimatedInlineBytes + inlineBytes <=
        MAX_CL_ROUTER_JSON_REQUEST_BYTES - 512 * 1024
    ) {
      estimatedInlineBytes += inlineBytes;
      return inlinePart;
    }
    const staged = await createSignedActionRouterAsset(routing.ctx, {
      bytes,
      mediaType,
      ...(filename ? { filename } : {}),
      ...(routing.orgId ? { orgId: routing.orgId } : {}),
      surface: "sdk_generation",
      sessionKey,
    });
    cleanup.push(staged.cleanup);
    return mediaType.startsWith("image/")
      ? { type: "image", source: staged.reference }
      : { type: "file", source: staged.reference };
  };

  try {
    const parts: ClRouterMessagePart[] = [];
    for (const image of options?.images ?? []) {
      parts.push(
        await stage(
          new Uint8Array(
            Buffer.from(image.imageBase64.replace(/\s/g, ""), "base64"),
          ),
          image.mimeType,
        ),
      );
    }

    let text = prompt;
    const embeddedPdf =
      !options?.pdfUrl && !options?.pdfBytes && !options?.pdfBase64
        ? extractEmbeddedPdf(prompt)
        : null;
    if (embeddedPdf) text = embeddedPdf.text;
    parts.push({ type: "text", text });

    const mediaType = options?.mimeType ?? "application/pdf";
    if (options?.pdfUrl) {
      const url =
        options.pdfUrl instanceof URL
          ? options.pdfUrl
          : new URL(options.pdfUrl);
      parts.push({
        type: "file",
        source: await clRouterAssetReferenceFromUrl({
          url,
          mediaType,
          filename: "document.pdf",
          sizeBytes: knownPdfSize(providerOptions),
        }),
      });
    } else {
      const pdfBytes =
        options?.pdfBytes ??
        (typeof options?.pdfBase64 === "string"
          ? new Uint8Array(
              Buffer.from(options.pdfBase64.replace(/\s/g, ""), "base64"),
            )
          : embeddedPdf
            ? new Uint8Array(Buffer.from(embeddedPdf.pdfBase64, "base64"))
            : undefined);
      if (pdfBytes) {
        parts.push(await stage(pdfBytes, mediaType, "document.pdf"));
      }
    }

    return await execute(
      parts.length === 1 && parts[0]?.type === "text"
        ? { prompt: parts[0].text }
        : { messages: [{ role: "user", content: parts }] as ClRouterMessage[] },
    );
  } finally {
    if (routing?.ctx) {
      await cleanupSignedRouterAssets(routing.ctx, cleanup);
    }
  }
}

function clRouterTrace(
  routing: ModelRoutingContext | undefined,
  label: string,
  taskKind: ModelCallTaskKind | undefined,
  trace: ModelCallTraceDetails | undefined,
): ClRouterTraceMetadata {
  return stripUndefined({
    traceId: routing?.traceId,
    label,
    phase: trace?.phase,
    taskKind,
    policyId: routing?.tracePolicyId
      ? String(routing.tracePolicyId)
      : undefined,
    channel: "convex",
  }) as ClRouterTraceMetadata;
}

function mapClRouterUsage(response: ClRouterGenerateResponse): TokenUsage {
  return {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };
}

async function resolveClRouterSettings(
  routing: ModelRoutingContext | undefined,
): Promise<ClRouterSettingsSnapshot | null> {
  if (!routing?.ctx || !routing.orgId) return null;
  return resolveClRouterSettingsForOrg(routing.ctx, routing.orgId);
}

/**
 * Detect base64 PDF content embedded directly in prompt text.
 * Older cl-sdk calls can concatenate raw pdfBase64 into prompts.
 * We detect this by looking for the PDF magic bytes in base64 ("JVBER" = "%PDF").
 */
function extractEmbeddedPdf(
  prompt: string,
): { text: string; pdfBase64: string } | null {
  // Match a long base64 PDF blob at the end of the prompt (after a newline)
  const match = prompt.match(/^([\s\S]+?\n)(JVBER[A-Za-z0-9+/=\s]{200,})$/);
  if (!match) return null;
  const text = match[1].trim();
  const pdfBase64 = match[2].replace(/\s/g, "");
  return { text, pdfBase64 };
}

async function recordModelTrace(
  routing: ModelRoutingContext | undefined,
  event: {
    label: string;
    task: ModelTask;
    taskKind?: ModelCallTaskKind;
    route?: ModelRoute;
    routeSource?: string;
    transport?: string;
    attempt?: number;
    durationMs: number;
    usage?: TokenUsage;
    cachedInputTokens?: number;
    routerRequestId?: string;
    costUsd?: number | null;
    costStatus?: "priced" | "unpriced";
    routingDecision?: string;
    routing?: ClRouterGenerateResponse["routing"];
    status: "complete" | "error" | "soft_failed";
    error?: string;
    details?: Record<string, unknown>;
  },
) {
  if (!routing?.ctx || !routing.traceId) return;
  try {
    await routing.ctx.runMutation(
      (internal as any).extractionTraces.recordEvent,
      {
        traceId: routing.traceId,
        kind: "model_call",
        label: event.label,
        task: event.task,
        taskKind: event.taskKind,
        provider: event.route?.provider,
        model: event.route?.model,
        routeSource: event.routeSource,
        transport: event.transport,
        attempt: event.attempt ?? 1,
        status: event.status,
        durationMs: event.durationMs,
        inputTokens: event.usage?.inputTokens,
        outputTokens: event.usage?.outputTokens,
        cachedInputTokens: event.cachedInputTokens,
        routerRequestId: event.routerRequestId,
        costUsd: event.costUsd,
        costStatus: event.costStatus,
        routingDecision: event.routingDecision,
        routing: event.routing,
        error: event.error,
        details: event.details,
      },
    );
  } catch {
    // Telemetry should never fail a user-facing extraction.
  }
}

/**
 * Create a GenerateText callback backed by Spot's model router.
 * The task parameter selects which model to use (extraction, classification, etc.).
 */
export function makeGenerateText(
  task: ModelTask = "extraction",
  routing?: ModelRoutingContext,
): GenerateText {
  let settingsPromise: ReturnType<typeof resolveClRouterSettings> | null = null;
  const getRouterSettings = () => {
    settingsPromise ??= resolveClRouterSettings(routing);
    return settingsPromise;
  };

  return async (params) => {
    const { prompt, system, maxTokens, providerOptions } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const effectiveTask = modelTaskForCall(task, taskKind);
    let traceRoute: ModelRoute = MODEL_ROUTING[effectiveTask];
    let routeSource = "static";
    let routePurpose: string | undefined;
    let transport: string | undefined;
    let effectiveMaxTokens = maxTokens;
    const startedAt = nowMs();
    const label = modelTraceLabel(
      "generateText",
      taskKind,
      effectiveTask,
      trace,
    );
    try {
      const result = await (async () => {
        const settings = await getRouterSettings();
        const plan = resolveRouterGenerationPlan(
          effectiveTask,
          taskKind,
          trace,
          settings,
        );
        traceRoute = plan.primaryRoute;
        routeSource = plan.routeSource;
        routePurpose = plan.routePurpose;
        transport = "cl-router";
        effectiveMaxTokens = getEffectiveMaxTokens(
          effectiveTask,
          taskKind,
          maxTokens,
          plan.primaryRoute,
        );
        return withClRouterPromptInput(
          routing,
          prompt,
          providerOptions as Record<string, unknown> | undefined,
          async (input): Promise<TextGenerationResult> => {
            const response = await clRouterGenerate({
              task: effectiveTask,
              taskKind,
              orgId: routing?.orgId ? String(routing.orgId) : undefined,
              settings,
              system,
              ...input,
              maxTokens: effectiveMaxTokens,
              sessionKey:
                routing?.traceId ??
                (routing?.tracePolicyId
                  ? String(routing.tracePolicyId)
                  : undefined),
              routing: {
                ...(plan.routeSource === "global"
                  ? { pin: plan.primaryRoute }
                  : {}),
                allowFallback: true,
              },
              trace: clRouterTrace(routing, label, taskKind, trace),
            });
            if (typeof response.output !== "string") {
              throw new ClRouterRequestError(
                "invalid_response",
                "cl-router text generation returned a non-text output",
              );
            }
            traceRoute = response.model;
            routeSource =
              response.routing.routeSource ?? response.routing.decision;
            routePurpose = plan.routePurpose;
            transport = "cl-router";
            return {
              text: response.output,
              usage: mapClRouterUsage(response),
              router: response,
            };
          },
        );
      })();
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport,
        attempt: result.router?.routing.attemptCount,
        durationMs: nowMs() - startedAt,
        usage: result.usage,
        cachedInputTokens: result.router?.usage.cachedInputTokens,
        routerRequestId: result.router?.requestId,
        costUsd: result.router?.costUsd,
        costStatus: result.router?.costStatus,
        routingDecision: result.router?.routing.decision,
        routing: result.router?.routing,
        status: "complete",
        details: modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.text,
          outputKind: "text",
        }),
      });
      return {
        text: result.text,
        usage: result.usage,
      };
    } catch (error) {
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        details: modelTraceDetails({
          kind: "generateText",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }),
      });
      throw error;
    }
  };
}

/**
 * Create a GenerateObject callback backed by Spot's model router.
 * Uses AI SDK v6's generateText + Output.object() for structured output.
 */
export function makeGenerateObject(
  task: ModelTask = "extraction",
  routing?: ModelRoutingContext,
): SpotGenerateObject {
  let settingsPromise: ReturnType<typeof resolveClRouterSettings> | null = null;
  const getRouterSettings = () => {
    settingsPromise ??= resolveClRouterSettings(routing);
    return settingsPromise;
  };

  return async (params) => {
    const {
      prompt: rawPrompt,
      system,
      schema,
      maxTokens,
      providerOptions,
    } = params;
    const taskKind = readTaskKind(params as ParamsWithOptionalTaskKind);
    const trace = readTraceDetails(params as ParamsWithOptionalTaskKind);
    const prompt = applyCarrierIdentityGuidance(
      rawPrompt,
      taskKind,
      trace?.extractorName,
    );
    const effectiveTask = modelTaskForCall(task, taskKind);
    let traceRoute: ModelRoute = MODEL_ROUTING[effectiveTask];
    let routeSource = "static";
    let routePurpose: string | undefined;
    let transport: string | undefined;
    let effectiveMaxTokens = maxTokens;
    const startedAt = nowMs();
    const label = modelTraceLabel(
      "generateObject",
      taskKind,
      effectiveTask,
      trace,
    );
    try {
      const result = await (async () => {
        const settings = await getRouterSettings();
        const plan = resolveRouterGenerationPlan(
          effectiveTask,
          taskKind,
          trace,
          settings,
        );
        traceRoute = plan.primaryRoute;
        routeSource = plan.routeSource;
        routePurpose = plan.routePurpose;
        transport = "cl-router";
        effectiveMaxTokens = getEffectiveMaxTokens(
          effectiveTask,
          taskKind,
          maxTokens,
          plan.primaryRoute,
        );
        return withClRouterPromptInput(
          routing,
          prompt,
          providerOptions as Record<string, unknown> | undefined,
          async (input): Promise<ObjectGenerationResult> => {
            const response = await clRouterGenerate({
              task: effectiveTask,
              taskKind,
              orgId: routing?.orgId ? String(routing.orgId) : undefined,
              settings,
              system,
              ...input,
              schema: z.toJSONSchema(schema) as Record<string, unknown>,
              schemaDialect: "https://json-schema.org/draft/2020-12/schema",
              maxTokens: effectiveMaxTokens,
              sessionKey:
                routing?.traceId ??
                (routing?.tracePolicyId
                  ? String(routing.tracePolicyId)
                  : undefined),
              routing: {
                ...(plan.routeSource === "global"
                  ? { pin: plan.primaryRoute }
                  : {}),
                allowFallback: true,
              },
              trace: clRouterTrace(routing, label, taskKind, trace),
            });
            const parsed = schema.safeParse(response.output);
            if (!parsed.success) {
              throw new ClRouterRequestError(
                "invalid_response",
                "cl-router structured generation returned invalid output",
                { cause: parsed.error },
              );
            }
            traceRoute = response.model;
            routeSource =
              response.routing.routeSource ?? response.routing.decision;
            routePurpose = plan.routePurpose;
            transport = "cl-router";
            return {
              object: parsed.data,
              usage: mapClRouterUsage(response),
              router: response,
            };
          },
        );
      })();
      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport,
        attempt: result.router?.routing.attemptCount,
        durationMs: nowMs() - startedAt,
        usage: result.usage,
        cachedInputTokens: result.router?.usage.cachedInputTokens,
        routerRequestId: result.router?.requestId,
        costUsd: result.router?.costUsd,
        costStatus: result.router?.costStatus,
        routingDecision: result.router?.routing.decision,
        routing: result.router?.routing,
        status: "complete",
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
          output: result.object,
          outputKind: "object",
        }),
      });
      return {
        object: result.object,
        usage: result.usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isSectionsExtractor =
        effectiveTask === "extraction" &&
        prompt.includes(SECTIONS_EXTRACTOR_PROMPT_MARKER);

      if (isSectionsExtractor && message.includes("No output generated")) {
        await recordModelTrace(routing, {
          label,
          task: effectiveTask,
          taskKind,
          route: traceRoute,
          routeSource,
          transport,
          durationMs: nowMs() - startedAt,
          status: "soft_failed",
          error: message,
          details: modelTraceDetails({
            kind: "generateObject",
            label,
            task: effectiveTask,
            taskKind,
            prompt,
            system,
            maxOutputTokens: effectiveMaxTokens,
            routePurpose,
            providerOptions: providerOptions as ProviderOptions,
            trace,
            output: { sections: [] },
            outputKind: "object",
          }),
        });
        return {
          object: { sections: [] } as unknown,
          usage: undefined,
        };
      }

      await recordModelTrace(routing, {
        label,
        task: effectiveTask,
        taskKind,
        route: traceRoute,
        routeSource,
        transport,
        durationMs: nowMs() - startedAt,
        status: "error",
        error: message,
        details: modelTraceDetails({
          kind: "generateObject",
          label,
          task: effectiveTask,
          taskKind,
          prompt,
          system,
          maxOutputTokens: effectiveMaxTokens,
          routePurpose,
          providerOptions: providerOptions as ProviderOptions,
          trace,
        }),
      });
      throw error;
    }
  };
}

async function resolveClRouterEmbeddingSettings(
  ctx?: ActionCtx,
  orgId?: Id<"organizations">,
): Promise<ClRouterSettingsSnapshot | null> {
  if (!ctx || !orgId) return null;
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
    orgId,
  });
  if (!settings) return null;
  return {
    routes: settings.routes,
    routeSources: settings.routeSources,
  };
}

export type EmbedTexts = (texts: string[]) => Promise<number[][]>;

const MAX_CL_ROUTER_EMBEDDING_VALUES = 200_000;

/**
 * Create an embedding callback. Routing is resolved once per callback instance,
 * then reused across all single or batched embedding requests.
 */
export function makeEmbedTexts(
  ctx?: ActionCtx,
  orgId?: Id<"organizations">,
  _options?: { maxParallelCalls?: number },
): EmbedTexts {
  let routerSettingsPromise: ReturnType<
    typeof resolveClRouterEmbeddingSettings
  > | null = null;
  const getRouterSettings = () => {
    routerSettingsPromise ??= resolveClRouterEmbeddingSettings(ctx, orgId);
    return routerSettingsPromise;
  };

  return async (texts: string[]) => {
    if (!texts.length) return [];
    const settings = await getRouterSettings();
    const maxTextsPerRequest = Math.max(
      1,
      Math.floor(MAX_CL_ROUTER_EMBEDDING_VALUES / EMBEDDING_DIMENSIONS),
    );
    const batchCount = Math.ceil(texts.length / maxTextsPerRequest);
    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += maxTextsPerRequest) {
      const batchIndex = Math.floor(offset / maxTextsPerRequest) + 1;
      const response = await clRouterEmbed({
        orgId,
        settings,
        texts: texts.slice(offset, offset + maxTextsPerRequest),
        dimensions: EMBEDDING_DIMENSIONS,
        trace: {
          label: "convex.sdkCallbacks.makeEmbedTexts",
          batchIndex,
          batchCount,
        },
      });
      embeddings.push(...response.embeddings);
    }
    return embeddings;
  };
}

/**
 * Create an EmbedText callback using the resolved global/static route.
 */
export function makeEmbedText(
  ctx?: ActionCtx,
  orgId?: Id<"organizations">,
): EmbedText {
  let routerSettingsPromise: ReturnType<
    typeof resolveClRouterEmbeddingSettings
  > | null = null;
  const getRouterSettings = () => {
    routerSettingsPromise ??= resolveClRouterEmbeddingSettings(ctx, orgId);
    return routerSettingsPromise;
  };

  return async (text: string) => {
    const settings = await getRouterSettings();
    const response = await clRouterEmbed({
      orgId,
      settings,
      texts: [text],
      dimensions: EMBEDDING_DIMENSIONS,
      trace: { label: "convex.sdkCallbacks.makeEmbedText" },
    });
    const embedding = response.embeddings[0];
    if (!embedding) throw new Error("cl-router returned no embedding");
    return embedding;
  };
}

/** Embedding dimensions — must match the vector index in schema.ts. */
export const EMBEDDING_DIMENSIONS = 1536;
