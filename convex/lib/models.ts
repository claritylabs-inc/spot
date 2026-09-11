"use node";

import type { LanguageModel, LanguageModelUsage } from "ai";
import {
  modelTaskForCall as policyModelTaskForCall,
  primaryRouteForCall as policyPrimaryRouteForCall,
} from "@claritylabs/cl-router-policy";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  createSignedActionRouterAsset,
  deleteSignedRouterAsset,
} from "../actions/routerAssets";
import {
  ClRouterRequestError,
  clRouterGenerate,
  clRouterTranscribe,
  type ClRouterAssetReference,
  type ClRouterGenerateRequest,
  type ClRouterFailureAttempt,
  type ClRouterMessage,
  type ClRouterResponseMetadata,
  type ClRouterSettingsSnapshot,
  type ClRouterUsage,
} from "./clRouterClient";
import {
  createClRouterLanguageModel,
  type ClRouterLanguageModelOptions,
} from "./clRouterLanguageModel";
import {
  EXTRACTION_QUALITY_MODEL,
  FALLBACK_MODEL,
  COVERAGE_CLEANUP_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  modelRouteSupportsTask,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
} from "./modelCatalog";
import { collectToolAudit, type AgentToolAudit } from "./agentToolAudit";

/** Spot delegates every AI execution to cl-router. */

export {
  FALLBACK_MODEL,
  FIREWORKS_MODEL_IDS,
  MODEL_ROUTING,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  type ModelProvider,
  type ModelRoute,
  type ModelTask,
};

export type ModelCallTaskKind =
  | "extraction_classify"
  | "extraction_source_tree"
  | "extraction_operational_profile"
  | "extraction_coverage_cleanup"
  | "extraction_page_map"
  | "extraction_focused"
  | "extraction_long_list"
  | "extraction_referential_lookup"
  | "extraction_review"
  | "extraction_summary"
  | "extraction_format"
  | "query_attachment"
  | "query_classify"
  | "query_reason"
  | "query_verify"
  | "query_respond"
  | "pce_impact_analysis"
  | "pce_reply_parse"
  | "pce_packet_generation"
  | (string & {});

type ModelFallbackContext = {
  task?: ModelTask;
  taskKind?: ModelCallTaskKind;
  primaryRoute?: ModelRoute;
  qualityRoute?: ModelRoute;
  fallbackRoute?: ModelRoute;
  allowFallback?: boolean;
};

type ResolvedModelRoute = {
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  allowFallback?: boolean;
};

type AiGenerateTextOptions = Parameters<typeof import("ai").generateText>[0];
type AiGenerateTextResult = Awaited<
  ReturnType<typeof import("ai").generateText>
>;
type RoutedGenerateTextOptions = Omit<AiGenerateTextOptions, "model">;
type RoutedGenerateObjectOptions<T> = Omit<
  AiGenerateTextOptions,
  "model" | "output"
> & {
  schema: z.ZodType<T>;
};
type RoutedGenerateTextResult = AiGenerateTextResult & {
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
  clRouterFailure?: ClRouterFailureMetadata;
};
type AgentModelRouteTelemetry = {
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
};
const INTERACTIVE_AGENT_INITIAL_EXECUTION_BUDGET_MS = 60_000;
class AgentIncompleteOutputError extends Error {
  constructor(readonly finishReason: string | undefined) {
    super(
      finishReason === "length"
        ? "Model reached its output limit before producing a usable response"
        : "Model completed without producing a usable response",
    );
    this.name = "AgentIncompleteOutputError";
  }
}
export type AgentModelRunOptions = {
  sessionKey: string;
  taskKind: ModelCallTaskKind;
  trace: {
    traceId: string;
    parentRequestId?: string;
    label: string;
    phase: string;
    channel:
      | "web"
      | "imessage"
      | "slack"
      | "mcp"
      | "email"
      | "mailbox"
      | "public_demo";
  };
  onResponse?: ClRouterLanguageModelOptions["onResponse"];
};
export type ResolvedAgentLanguageModel = ResolvedModelRoute & {
  model: LanguageModel;
  transport: ModelTransport;
  routerResponses: ClRouterResponseMetadata[];
};
type RoutedGenerateObjectResult<T> = Omit<
  AiGenerateTextResult,
  "output" | "object"
> & {
  output: T;
  object: T;
  route: ModelRoute;
  routeSource?: string;
  transport?: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
};

export type ModelTransport = "cl-router";
export type ModelRouteSource = "broker" | "global" | "static" | "default";

export function generatedTextFromResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;

  const steps = Array.isArray(record.steps) ? record.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || typeof step !== "object") continue;
    const text = (step as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }

  return "";
}

function withGeneratedText<T extends AiGenerateTextResult>(
  result: T,
  preserveStructuredOutput = false,
): T {
  const finishReason = generatedFinishReasonFromResult(result);
  const output = preserveStructuredOutput ? result.output : undefined;
  return {
    ...result,
    text: generatedTextFromResult(result),
    ...(finishReason ? { finishReason } : {}),
    ...(preserveStructuredOutput ? { output } : {}),
  } as T;
}

function generatedFinishReasonFromResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.finishReason === "string") return record.finishReason;

  const steps = Array.isArray(record.steps) ? record.steps : [];
  const finalStep = steps.at(-1);
  if (!finalStep || typeof finalStep !== "object") return undefined;
  const finishReason = (finalStep as Record<string, unknown>).finishReason;
  return typeof finishReason === "string" ? finishReason : undefined;
}

const MODEL_CALL_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.MODEL_CALL_TIMEOUT_MS ?? "180000", 10) || 180_000,
);

function withModelTimeout<T extends { abortSignal?: AbortSignal }>(
  options: T,
): T {
  return options.abortSignal
    ? options
    : { ...options, abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS) };
}

function clRouterSettingsSnapshot(
  settings: unknown,
): ClRouterSettingsSnapshot | null {
  if (!settings || typeof settings !== "object") return null;
  const record = settings as Record<string, unknown>;
  return {
    ...(record.routes && typeof record.routes === "object"
      ? { routes: record.routes as Record<string, ModelRoute> }
      : {}),
    ...(record.routeSources && typeof record.routeSources === "object"
      ? { routeSources: record.routeSources as Record<string, string> }
      : {}),
  };
}

function clRouterMessages(value: unknown): ClRouterMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ClRouterMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const message = item as Record<string, unknown>;
    if (
      (message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "tool") ||
      typeof message.content !== "string"
    ) {
      return null;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

function clRouterGenerateInput(
  options: RoutedGenerateTextOptions,
): Pick<
  ClRouterGenerateRequest,
  "system" | "messages" | "prompt" | "maxTokens"
> | null {
  const record = options as Record<string, unknown>;
  const supportedKeys = new Set([
    "system",
    "messages",
    "prompt",
    "maxOutputTokens",
    "abortSignal",
  ]);
  if (
    Object.keys(record).some(
      (key) => record[key] !== undefined && !supportedKeys.has(key),
    )
  ) {
    return null;
  }
  if (record.system !== undefined && typeof record.system !== "string")
    return null;
  if (record.prompt !== undefined && typeof record.prompt !== "string")
    return null;
  const messages =
    record.messages === undefined
      ? undefined
      : clRouterMessages(record.messages);
  if (record.messages !== undefined && !messages) return null;
  if (record.prompt === undefined && messages === undefined) return null;
  if (
    record.maxOutputTokens !== undefined &&
    typeof record.maxOutputTokens !== "number"
  ) {
    return null;
  }
  return {
    ...(typeof record.system === "string" ? { system: record.system } : {}),
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
    ...(messages ? { messages } : {}),
    ...(typeof record.maxOutputTokens === "number"
      ? { maxTokens: record.maxOutputTokens }
      : {}),
  };
}

function clRouterGenerateInputForEnabledTask(
  task: ModelTask,
  taskKind: ModelCallTaskKind | undefined,
  options: RoutedGenerateTextOptions,
): Pick<
  ClRouterGenerateRequest,
  "system" | "messages" | "prompt" | "maxTokens"
> {
  const input = clRouterGenerateInput(options);
  if (input) return input;

  throw new ClRouterRequestError(
    "configuration",
    `cl-router generation for ${taskKind ?? task} uses options that the non-streaming adapter cannot preserve; route this call through the Spot-owned cl-router language-model tool loop`,
  );
}

function languageModelUsageFromClRouter(
  usage: ClRouterUsage,
): LanguageModelUsage {
  const reasoningTokens = usage.reasoningTokens ?? 0;
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
      ),
      cacheReadTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: Math.max(0, usage.outputTokens - reasoningTokens),
      reasoningTokens,
    },
    totalTokens: usage.inputTokens + usage.outputTokens,
    reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

export function modelTaskForCall(
  baseTask: ModelTask,
  taskKind?: ModelCallTaskKind,
): ModelTask {
  return policyModelTaskForCall(baseTask, taskKind);
}

export function primaryRouteForCall({
  task,
  taskKind,
  qualityRoute = EXTRACTION_QUALITY_MODEL,
}: ModelFallbackContext): ModelRoute | null {
  return policyPrimaryRouteForCall({ task, taskKind, qualityRoute });
}

type AudioTranscriptionInput = {
  data: Buffer;
  filename: string;
  mediaType: string;
  prompt?: string;
};

async function withTemporaryAudioReference<T>(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
  owner: {
    orgId?: Id<"organizations">;
    sessionKey: string;
  },
  callback: (audio: ClRouterAssetReference) => Promise<T>,
): Promise<T> {
  const bytes = new Uint8Array(input.data);
  const asset = await createSignedActionRouterAsset(ctx, {
    bytes,
    mediaType: input.mediaType,
    filename: transcriptionFilename(input.filename, input.mediaType),
    ...owner,
    surface: "voice_transcription",
  });
  try {
    return await callback(asset.reference);
  } finally {
    try {
      await deleteSignedRouterAsset(ctx, asset.cleanup);
    } catch {
      // Registration schedules expiry cleanup, so a transient eager cleanup
      // failure must not replace the router result or typed router error.
      console.warn("[cl-router] Failed to eagerly delete transcription asset");
    }
  }
}

type AudioTranscriptionResult = {
  text: string;
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  clRouter?: ClRouterResponseMetadata;
};

const TRANSCRIPTION_FILE_EXTENSIONS = new Set([
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "wav",
  "webm",
]);

function audioExtensionForMediaType(mediaType: string): string {
  switch (mediaType.toLowerCase().split(";", 1)[0]) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return "m4a";
  }
}

function transcriptionFilename(filename: string, mediaType: string): string {
  const trimmed = filename.trim() || "voice-memo";
  const extension = trimmed.split(".").pop()?.toLowerCase();
  if (extension && TRANSCRIPTION_FILE_EXTENSIONS.has(extension)) return trimmed;
  const base = trimmed.replace(/\.[^.]+$/, "") || "voice-memo";
  return `${base}.${audioExtensionForMediaType(mediaType)}`;
}

export async function transcribeAudioForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return withTemporaryAudioReference(
    ctx,
    input,
    {
      orgId,
      sessionKey: `voice:${String(orgId)}:${crypto.randomUUID()}`,
    },
    async (audio) => {
      const response = await clRouterTranscribe({
        orgId,
        settings,
        audio,
        prompt: input.prompt,
        trace: { label: "convex.models.transcribeAudioForOrg" },
      });
      return audioTranscriptionResult(response);
    },
  );
}

function audioTranscriptionResult(
  response: Awaited<ReturnType<typeof clRouterTranscribe>>,
): AudioTranscriptionResult {
  const text = response.text.trim();
  if (!text) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router audio transcription returned no text",
    );
  }
  const routeSource = response.routing.routeSource;
  return {
    text,
    route: response.model,
    routeSource:
      routeSource === "broker" ||
      routeSource === "global" ||
      routeSource === "static" ||
      routeSource === "default"
        ? routeSource
        : "default",
    transport: "cl-router",
    clRouter: response,
  };
}

async function transcribeAudioForGlobalTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
  traceLabel: string,
): Promise<AudioTranscriptionResult> {
  const settings = await clRouterSettingsForPublicTask(ctx);
  return withTemporaryAudioReference(
    ctx,
    input,
    {
      sessionKey: `voice:global:${crypto.randomUUID()}`,
    },
    async (audio) => {
      const response = await clRouterTranscribe({
        settings,
        audio,
        prompt: input.prompt,
        trace: { label: traceLabel },
      });
      return audioTranscriptionResult(response);
    },
  );
}

export async function transcribeAudioForPublicTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  return transcribeAudioForGlobalTask(
    ctx,
    input,
    "convex.models.transcribeAudioForPublicTask",
  );
}

export async function transcribeAudioForOperatorTask(
  ctx: ActionCtx,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResult> {
  return transcribeAudioForGlobalTask(
    ctx,
    input,
    "convex.models.transcribeAudioForOperatorTask",
  );
}

function errorRecords(error: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    records.push(record);
    visit(record.error);
    visit(record.cause);
    visit(record.data);
    visit(record.response);
  };
  visit(error);
  return records;
}

type ClRouterFailureMetadata = {
  message: string;
  requestId?: string;
  routerCode?: string;
  status?: number;
  retryable?: boolean;
  executionStarted?: boolean;
  attempts: readonly ClRouterFailureAttempt[];
};

function clRouterFailureMetadata(
  error: unknown,
): ClRouterFailureMetadata | undefined {
  let failure: ClRouterRequestError | undefined;
  for (const record of errorRecords(error)) {
    if (record instanceof ClRouterRequestError) {
      failure = record;
      break;
    }
  }
  if (!failure) return undefined;
  return {
    message: failure.message,
    ...(failure.requestId ? { requestId: failure.requestId } : {}),
    ...(failure.routerCode ? { routerCode: failure.routerCode } : {}),
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(failure.retryable === undefined
      ? {}
      : { retryable: failure.retryable }),
    ...(failure.executionStarted === undefined
      ? {}
      : { executionStarted: failure.executionStarted }),
    attempts: failure.attempts,
  };
}

function routerFailureTelemetryFields(
  failure: ClRouterFailureMetadata | undefined,
) {
  if (!failure) return {};
  return {
    ...(failure.routerCode ? { routerCode: failure.routerCode } : {}),
    ...(failure.status === undefined ? {} : { routerStatus: failure.status }),
    ...(failure.retryable === undefined
      ? {}
      : { routerRetryable: failure.retryable }),
    ...(failure.executionStarted === undefined
      ? {}
      : { routerExecutionStarted: failure.executionStarted }),
    ...(failure.attempts.length
      ? { failureAttempts: [...failure.attempts] }
      : {}),
  };
}

type OrgModelRouteResolution = {
  route: ModelRoute;
  routeSource: ModelRouteSource;
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "broker" | "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "broker" | "global" | "static";
};

function resolvedSettingsRouteSource(
  value: string | undefined,
  defaultSource: "global" | "static",
): "broker" | "global" | "static" {
  return value === "broker" || value === "global" || value === "static"
    ? value
    : defaultSource;
}

export function getModelAndRouteForSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
): OrgModelRouteResolution {
  const configuredRoute = settings?.routes?.[task];
  const routeSource = resolvedSettingsRouteSource(
    settings?.routeSources?.[task],
    "global",
  );
  const qualityRoute =
    settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const qualityRouteSource = resolvedSettingsRouteSource(
    settings?.routeSources?.extraction_quality,
    "static",
  );
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  const coverageCleanupRouteSource = resolvedSettingsRouteSource(
    settings?.routeSources?.extraction_coverage_cleanup,
    "static",
  );
  const canUseConfiguredRoute =
    !!configuredRoute && modelRouteSupportsTask(task, configuredRoute);
  const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
  return {
    route,
    routeSource: canUseConfiguredRoute ? routeSource : "default",
    transport: "cl-router",
    qualityRoute,
    qualityRouteSource,
    coverageCleanupRoute,
    coverageCleanupRouteSource,
  };
}

export async function getModelAndRouteForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
): Promise<OrgModelRouteResolution> {
  if (task === "voice_transcription") {
    throw new Error(
      "Voice memo transcription must use transcribeAudioForOrg, not getModelAndRouteForOrg()",
    );
  }
  try {
    const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
      orgId,
    });
    return getModelAndRouteForSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      task,
    );
  } catch (err) {
    console.warn(
      `Configured model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    const route = MODEL_ROUTING[task];
    return {
      route,
      routeSource: "default",
      transport: "cl-router",
      qualityRoute: EXTRACTION_QUALITY_MODEL,
      qualityRouteSource: "static",
      coverageCleanupRoute: COVERAGE_CLEANUP_MODEL,
      coverageCleanupRouteSource: "static",
    };
  }
}

export async function getModelAndRouteForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
): Promise<{
  route: ModelRoute;
  routeSource: "global" | "static" | "default";
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "global" | "static";
}> {
  if (task === "voice_transcription") {
    throw new Error(
      "Voice memo transcription must use transcribeAudioForPublicTask, not getModelAndRouteForPublicTask()",
    );
  }
  try {
    const settings = await ctx.runQuery(
      internal.modelSettings.resolvePublicDefaults,
      {},
    );
    return getModelAndRouteForPublicSettingsSnapshot(
      clRouterSettingsSnapshot(settings),
      task,
    );
  } catch (err) {
    console.warn(
      `Public model for task "${task}" unavailable: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to static routing.`,
    );
    const route = MODEL_ROUTING[task];
    return {
      route,
      routeSource: "default",
      transport: "cl-router",
      qualityRoute: EXTRACTION_QUALITY_MODEL,
      qualityRouteSource: "static",
      coverageCleanupRoute: COVERAGE_CLEANUP_MODEL,
      coverageCleanupRouteSource: "static",
    };
  }
}

export function getModelAndRouteForPublicSettingsSnapshot(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
): {
  route: ModelRoute;
  routeSource: "global" | "static" | "default";
  transport: ModelTransport;
  qualityRoute: ModelRoute;
  qualityRouteSource: "global" | "static";
  coverageCleanupRoute: ModelRoute;
  coverageCleanupRouteSource: "global" | "static";
} {
  const configuredRoute = settings?.routes?.[task];
  const rawRouteSource = settings?.routeSources?.[task];
  const canUseConfiguredRoute =
    !!configuredRoute &&
    rawRouteSource !== "broker" &&
    modelRouteSupportsTask(task, configuredRoute);
  const route = canUseConfiguredRoute ? configuredRoute : MODEL_ROUTING[task];
  const routeSource = canUseConfiguredRoute
    ? rawRouteSource === "static" || rawRouteSource === "default"
      ? rawRouteSource
      : "global"
    : "static";
  const qualityRoute =
    settings?.routes?.extraction_quality ?? EXTRACTION_QUALITY_MODEL;
  const coverageCleanupRoute =
    settings?.routes?.extraction_coverage_cleanup ?? COVERAGE_CLEANUP_MODEL;
  return {
    route,
    routeSource,
    transport: "cl-router",
    qualityRoute,
    qualityRouteSource:
      settings?.routeSources?.extraction_quality === "global"
        ? "global"
        : "static",
    coverageCleanupRoute,
    coverageCleanupRouteSource:
      settings?.routeSources?.extraction_coverage_cleanup === "global"
        ? "global"
        : "static",
  };
}

function routedTextResultFromClRouter(
  response: Awaited<ReturnType<typeof clRouterGenerate>>,
): RoutedGenerateTextResult {
  if (typeof response.output !== "string") {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router text generation returned a non-text output",
    );
  }
  const usage = languageModelUsageFromClRouter(response.usage);
  return {
    text: response.output,
    output: response.output,
    finishReason: response.finishReason ?? "stop",
    usage,
    totalUsage: usage,
    route: response.model,
    routeSource: response.routing.routeSource,
    transport: "cl-router",
    clRouter: response,
  } as unknown as RoutedGenerateTextResult;
}

function routedObjectResultFromClRouter<T>(
  response: Awaited<ReturnType<typeof clRouterGenerate>>,
  schema: z.ZodType<T>,
): RoutedGenerateObjectResult<T> {
  const parsed = schema.safeParse(response.output);
  if (!parsed.success) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router structured generation returned an invalid object",
      { cause: parsed.error },
    );
  }
  const usage = languageModelUsageFromClRouter(response.usage);
  return {
    text: JSON.stringify(parsed.data),
    output: parsed.data,
    object: parsed.data,
    finishReason: response.finishReason ?? "stop",
    usage,
    totalUsage: usage,
    route: response.model,
    routeSource: response.routing.routeSource,
    transport: "cl-router",
    clRouter: response,
  } as unknown as RoutedGenerateObjectResult<T>;
}

function modelSettingsRouteIdForCall(
  task: ModelTask,
  taskKind?: ModelCallTaskKind,
) {
  if (taskKind === "extraction_coverage_cleanup") {
    return "extraction_coverage_cleanup";
  }
  if (
    taskKind === "extraction_source_tree" ||
    taskKind === "extraction_operational_profile"
  ) {
    return "extraction_quality";
  }
  return modelTaskForCall(task, taskKind);
}

function clRouterRoutingForCall(
  settings: ClRouterSettingsSnapshot | null,
  task: ModelTask,
  taskKind?: ModelCallTaskKind,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): ClRouterGenerateRequest["routing"] {
  const routeId = modelSettingsRouteIdForCall(task, taskKind);
  const globalOverride =
    settings?.routeSources?.[routeId] === "global"
      ? settings.routes?.[routeId]
      : undefined;
  const allowFallback = fallbackContext?.allowFallback;
  if (!globalOverride && allowFallback === undefined) return undefined;
  return {
    ...(globalOverride ? { pin: globalOverride } : {}),
    ...(allowFallback === undefined ? {} : { allowFallback }),
  };
}

export async function resolveClRouterSettingsForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
    orgId,
  });
  return clRouterSettingsSnapshot(settings);
}

async function clRouterSettingsForPublicTask(
  ctx: ActionCtx,
): Promise<ClRouterSettingsSnapshot | null> {
  const settings = await ctx.runQuery(
    internal.modelSettings.resolvePublicDefaults,
    {},
  );
  return clRouterSettingsSnapshot(settings);
}

function assertAgentModelRunOptions(options: AgentModelRunOptions) {
  if (!options.sessionKey.trim()) {
    throw new Error("Agent model routing requires a stable session key");
  }
  if (!options.taskKind.trim()) {
    throw new Error("Agent model routing requires an explicit task kind");
  }
  const { trace } = options;
  if (
    !trace.traceId.trim() ||
    !trace.label.trim() ||
    !trace.phase.trim() ||
    !trace.channel.trim()
  ) {
    throw new Error(
      "Agent model routing requires trace, phase, label, and channel metadata",
    );
  }
}

function agentLanguageModel(
  ctx: ActionCtx,
  task: ModelTask,
  orgId: Id<"organizations"> | undefined,
  settings: ClRouterSettingsSnapshot | null,
  resolved: ResolvedModelRoute,
  run: AgentModelRunOptions,
): ResolvedAgentLanguageModel {
  const routerResponses: ClRouterResponseMetadata[] = [];
  return {
    ...resolved,
    model: createClRouterLanguageModel({
      task,
      taskKind: run.taskKind,
      ...(orgId ? { orgId: String(orgId) } : {}),
      settings,
      sessionKey: run.sessionKey,
      trace: run.trace,
      ...(resolved.routeSource === "global"
        ? { initialRoutePin: resolved.route }
        : {}),
      ...(resolved.allowFallback === undefined
        ? {}
        : { allowFallback: resolved.allowFallback }),
      assetStager: async (asset) => {
        const staged = await createSignedActionRouterAsset(ctx, {
          ...asset,
          ...(orgId ? { orgId } : {}),
          surface: `agent_${run.taskKind}`,
          sessionKey: run.sessionKey,
        });
        return {
          reference: staged.reference,
          cleanup: async () => {
            await deleteSignedRouterAsset(ctx, staged.cleanup);
          },
        };
      },
      ...(run.trace.channel === "mailbox" || run.trace.channel === "public_demo"
        ? {}
        : {
            initialExecutionBudgetMs:
              INTERACTIVE_AGENT_INITIAL_EXECUTION_BUDGET_MS,
          }),
      onResponse: async (response, step) => {
        routerResponses.push(response);
        await run.onResponse?.(response, step);
      },
    }),
    transport: "cl-router",
    routerResponses,
  };
}

function routingEventRun(
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
) {
  return {
    runId: run.trace.traceId,
    sessionKey: run.sessionKey,
    ...(orgId ? { orgId } : {}),
    task,
    taskKind: run.taskKind,
    channel: run.trace.channel,
    label: run.trace.label,
    phase: run.trace.phase,
    ...(run.trace.parentRequestId
      ? { parentRequestId: run.trace.parentRequestId }
      : {}),
  };
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1_000,
  );
}

function withAgentRoutingTelemetry(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
): AgentModelRunOptions {
  const eventRun = routingEventRun(orgId, task, run);
  return {
    ...run,
    onResponse: async (response, step) => {
      await ctx.runMutation(
        internal.modelRoutingEvents.recordResponseInternal,
        { run: eventRun, response, ...step },
      );
      await run.onResponse?.(response, step);
    },
  };
}

function workflowOutcomeStatus(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

function workflowFailureCount(outcomes: unknown[]) {
  return outcomes.filter((outcome) => {
    const status = workflowOutcomeStatus(outcome);
    return status === "failed_recoverably" || status === "failed_terminal";
  }).length;
}

export function agentRunCompletionTelemetry(
  result: unknown,
  audit: AgentToolAudit,
  error?: unknown,
) {
  const record =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : undefined;
  const finishReason =
    typeof record?.finishReason === "string" ? record.finishReason : undefined;
  const visibleTextLength = generatedTextFromResult(result).trim().length;
  const hitOutputLimit = finishReason === "length";
  const failures = workflowFailureCount(audit.workflowOutcomes);
  const completionIssue = error
    ? undefined
    : hitOutputLimit
      ? ("output_limit" as const)
      : failures > 0 && visibleTextLength === 0
        ? ("workflow_failure" as const)
        : visibleTextLength === 0
          ? ("empty_response" as const)
          : undefined;

  return {
    status: error
      ? ("error" as const)
      : completionIssue
        ? ("incomplete" as const)
        : ("complete" as const),
    finishReason,
    hitOutputLimit,
    visibleTextLength,
    completionIssue,
    workflowFailureCount: failures,
  };
}

async function recordAgentRun(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  result?: RoutedGenerateTextResult,
  error?: unknown,
  auditOverride?: AgentToolAudit,
  routerResponseOverride?: ClRouterResponseMetadata,
  routeOverride?: AgentModelRouteTelemetry,
  maxOutputTokens?: number,
  routerFailureOverride?: ClRouterFailureMetadata,
) {
  const audit =
    auditOverride ??
    (result
      ? collectToolAudit(result)
      : {
          usedTools: [],
          completedTools: [],
          toolCalls: [],
          workflowOutcomes: [],
        });
  const completion = agentRunCompletionTelemetry(result, audit, error);
  const routerFailure = error
    ? (clRouterFailureMetadata(error) ?? routerFailureOverride)
    : (result?.clRouterFailure ?? routerFailureOverride);
  const failedAttempt = routerFailure?.attempts.at(-1);
  const requestId =
    routerFailure?.requestId ??
    routerResponseOverride?.requestId ??
    result?.clRouter?.requestId;
  const route =
    result?.route ??
    (failedAttempt
      ? { provider: failedAttempt.provider, model: failedAttempt.model }
      : routerFailure
        ? undefined
        : routeOverride?.route);
  const routeSource = result?.routeSource ?? routeOverride?.routeSource;
  const transport = result?.transport ?? routeOverride?.transport;
  const usage = result?.totalUsage ?? result?.usage;
  try {
    await ctx.runMutation(internal.modelRoutingEvents.recordRunInternal, {
      run: routingEventRun(orgId, task, run),
      status: completion.status,
      ...(requestId ? { requestId } : {}),
      ...(route ? { provider: route.provider, model: route.model } : {}),
      ...(routeSource ? { routeSource } : {}),
      ...(transport ? { transport } : {}),
      ...(usage?.inputTokens === undefined
        ? {}
        : { inputTokens: usage.inputTokens }),
      ...(usage?.outputTokens === undefined
        ? {}
        : { outputTokens: usage.outputTokens }),
      ...(usage?.outputTokenDetails?.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
      ...(usage?.inputTokenDetails?.cacheReadTokens === undefined
        ? {}
        : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
      ...(usage?.inputTokenDetails?.cacheWriteTokens === undefined
        ? {}
        : { cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...routerFailureTelemetryFields(routerFailure),
      ...(completion.finishReason
        ? { finishReason: completion.finishReason }
        : {}),
      hitOutputLimit: completion.hitOutputLimit,
      visibleTextLength: completion.visibleTextLength,
      toolCallCount: audit.toolCalls.length,
      completedToolCount: audit.completedTools.length,
      toolNames: [...new Set(audit.usedTools)],
      workflowOutcomeCount: audit.workflowOutcomes.length,
      workflowFailureCount: completion.workflowFailureCount,
      ...(completion.completionIssue
        ? { completionIssue: completion.completionIssue }
        : {}),
      ...(error ? { error: errorText(error) } : {}),
    });
  } catch (telemetryError) {
    console.warn(
      "[cl-router] Failed to record agent routing run",
      telemetryError,
    );
  }
}

export async function recordAgentRoutingRun(
  ctx: ActionCtx,
  orgId: Id<"organizations"> | undefined,
  task: ModelTask,
  run: AgentModelRunOptions,
  audit: AgentToolAudit,
  routerResponse?: ClRouterResponseMetadata,
  error?: unknown,
  routeOverride?: AgentModelRouteTelemetry,
) {
  await recordAgentRun(
    ctx,
    orgId,
    task,
    run,
    undefined,
    error,
    audit,
    routerResponse,
    routeOverride,
    undefined,
  );
}

export async function getAgentLanguageModelForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  const resolved = getModelAndRouteForSettingsSnapshot(settings, task);
  return agentLanguageModel(
    ctx,
    task,
    orgId,
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, orgId, task, run),
  );
}

export async function getAgentLanguageModelForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  const settings = await clRouterSettingsForPublicTask(ctx);
  const resolved = getModelAndRouteForPublicSettingsSnapshot(settings, task);
  return agentLanguageModel(
    ctx,
    task,
    undefined,
    settings,
    resolved,
    withAgentRoutingTelemetry(ctx, undefined, task, run),
  );
}

async function generateAgentTextForResolvedModel(
  resolved: ResolvedAgentLanguageModel,
  options: RoutedGenerateTextOptions,
): Promise<RoutedGenerateTextResult> {
  const { generateText } = await import("ai");
  const result = withGeneratedText(
    await generateText(
      withModelTimeout({
        ...options,
        model: resolved.model,
      } as AiGenerateTextOptions),
    ),
    options.output !== undefined,
  );
  const audit = collectToolAudit(result);
  if (
    audit.usedTools.length === 0 &&
    (!generatedTextFromResult(result).trim() ||
      result.finishReason === "length")
  ) {
    throw new AgentIncompleteOutputError(result.finishReason);
  }
  const routerResponse = resolved.routerResponses.at(-1);
  return {
    ...result,
    route: routerResponse?.model ?? resolved.route,
    routeSource: routerResponse?.routing.routeSource ?? resolved.routeSource,
    transport: "cl-router",
    ...(routerResponse ? { clRouter: routerResponse } : {}),
  };
}

export async function generateAgentTextForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    const resolvedModel = await getAgentLanguageModelForOrg(
      ctx,
      orgId,
      task,
      run,
    );
    resolved = resolvedModel;
    const result = await generateAgentTextForResolvedModel(
      resolvedModel,
      options,
    );
    await recordAgentRun(
      ctx,
      orgId,
      task,
      run,
      result,
      undefined,
      undefined,
      resolvedModel.routerResponses.at(-1),
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    await recordAgentRun(
      ctx,
      orgId,
      task,
      run,
      undefined,
      error,
      undefined,
      resolved?.routerResponses.at(-1),
      resolved
        ? {
            route: resolved.route,
            routeSource: resolved.routeSource,
            transport: resolved.transport,
          }
        : undefined,
      options.maxOutputTokens,
    );
    throw error;
  }
}

export async function generateAgentTextForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    const resolvedModel = await getAgentLanguageModelForPublicTask(
      ctx,
      task,
      run,
    );
    resolved = resolvedModel;
    const result = await generateAgentTextForResolvedModel(
      resolvedModel,
      options,
    );
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      result,
      undefined,
      undefined,
      resolvedModel.routerResponses.at(-1),
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      undefined,
      error,
      undefined,
      resolved?.routerResponses.at(-1),
      resolved
        ? {
            route: resolved.route,
            routeSource: resolved.routeSource,
            transport: resolved.transport,
          }
        : undefined,
      options.maxOutputTokens,
    );
    throw error;
  }
}

export async function getAgentLanguageModelForOperatorTask(
  ctx: ActionCtx,
  task: Extract<ModelTask, "chat" | "chat_vision">,
  run: AgentModelRunOptions,
): Promise<ResolvedAgentLanguageModel> {
  assertAgentModelRunOptions(run);
  const route: ModelRoute = await ctx.runQuery(
    internal.modelSettings.resolveOperatorAgentRoute,
    {},
  );
  if (!modelRouteSupportsTask("chat_vision", route)) {
    throw new Error(
      "The manually selected operator-agent model must support image input",
    );
  }
  if (!modelRouteSupportsTask(task, route)) {
    throw new Error(
      `The manually selected operator-agent model cannot run ${task}`,
    );
  }
  const settings: ClRouterSettingsSnapshot = {
    routes: { operator_agent: route },
    routeSources: { operator_agent: "global" },
  };
  return agentLanguageModel(
    ctx,
    task,
    undefined,
    settings,
    {
      route,
      routeSource: "global",
      transport: "cl-router",
      allowFallback: false,
    },
    withAgentRoutingTelemetry(ctx, undefined, task, run),
  );
}

/** Operator inference pins the selected route for the complete router-owned loop. */
export async function generateAgentTextForOperatorTask(
  ctx: ActionCtx,
  task: Extract<ModelTask, "chat" | "chat_vision">,
  options: RoutedGenerateTextOptions,
  run: AgentModelRunOptions,
): Promise<RoutedGenerateTextResult> {
  let resolved: ResolvedAgentLanguageModel | undefined;
  try {
    resolved = await getAgentLanguageModelForOperatorTask(ctx, task, run);
    const result = await generateAgentTextForResolvedModel(resolved, options);
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      result,
      undefined,
      undefined,
      resolved.routerResponses.at(-1),
      undefined,
      options.maxOutputTokens,
    );
    return result;
  } catch (error) {
    await recordAgentRun(
      ctx,
      undefined,
      task,
      run,
      undefined,
      error,
      undefined,
      undefined,
      resolved
        ? {
            route: resolved.route,
            routeSource: resolved.routeSource,
            transport: "cl-router",
          }
        : undefined,
      options.maxOutputTokens,
    );
    throw error;
  }
}

export async function generateTextForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateTextResult> {
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    options,
  );
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return routedTextResultFromClRouter(
    await clRouterGenerate(
      {
        task,
        taskKind: fallbackContext?.taskKind,
        orgId,
        settings,
        ...input,
        routing: clRouterRoutingForCall(
          settings,
          task,
          fallbackContext?.taskKind,
          fallbackContext,
        ),
        trace: {
          label: "convex.models.generateTextForOrg",
          ...(fallbackContext?.taskKind
            ? { taskKind: fallbackContext.taskKind }
            : {}),
        },
      },
      { abortSignal: options.abortSignal },
    ),
  );
}

export async function generateObjectForOrg<T>(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateObjectResult<T>> {
  const { schema, ...textOptions } = options;
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await resolveClRouterSettingsForOrg(ctx, orgId);
  return routedObjectResultFromClRouter(
    await clRouterGenerate(
      {
        task,
        taskKind: fallbackContext?.taskKind,
        orgId,
        settings,
        ...input,
        schema: z.toJSONSchema(schema) as Record<string, unknown>,
        schemaDialect: "https://json-schema.org/draft/2020-12/schema",
        routing: clRouterRoutingForCall(
          settings,
          task,
          fallbackContext?.taskKind,
          fallbackContext,
        ),
        trace: {
          label: "convex.models.generateObjectForOrg",
          ...(fallbackContext?.taskKind
            ? { taskKind: fallbackContext.taskKind }
            : {}),
        },
      },
      { abortSignal: textOptions.abortSignal },
    ),
    schema,
  );
}

export async function generateTextForPublicTask(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateTextOptions,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateTextResult> {
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    options,
  );
  const settings = await clRouterSettingsForPublicTask(ctx);
  return routedTextResultFromClRouter(
    await clRouterGenerate(
      {
        task,
        taskKind: fallbackContext?.taskKind,
        settings,
        ...input,
        routing: clRouterRoutingForCall(
          settings,
          task,
          fallbackContext?.taskKind,
          fallbackContext,
        ),
        trace: {
          label: "convex.models.generateTextForPublicTask",
          ...(fallbackContext?.taskKind
            ? { taskKind: fallbackContext.taskKind }
            : {}),
        },
      },
      { abortSignal: options.abortSignal },
    ),
  );
}

export async function generateObjectForPublicTask<T>(
  ctx: ActionCtx,
  task: ModelTask,
  options: RoutedGenerateObjectOptions<T>,
  fallbackContext?: Omit<
    ModelFallbackContext,
    "task" | "primaryRoute" | "fallbackRoute"
  >,
): Promise<RoutedGenerateObjectResult<T>> {
  const { schema, ...textOptions } = options;
  const input = clRouterGenerateInputForEnabledTask(
    task,
    fallbackContext?.taskKind,
    textOptions,
  );
  const settings = await clRouterSettingsForPublicTask(ctx);
  return routedObjectResultFromClRouter(
    await clRouterGenerate(
      {
        task,
        taskKind: fallbackContext?.taskKind,
        settings,
        ...input,
        schema: z.toJSONSchema(schema) as Record<string, unknown>,
        schemaDialect: "https://json-schema.org/draft/2020-12/schema",
        routing: clRouterRoutingForCall(
          settings,
          task,
          fallbackContext?.taskKind,
          fallbackContext,
        ),
        trace: {
          label: "convex.models.generateObjectForPublicTask",
          ...(fallbackContext?.taskKind
            ? { taskKind: fallbackContext.taskKind }
            : {}),
        },
      },
      { abortSignal: textOptions.abortSignal },
    ),
    schema,
  );
}
