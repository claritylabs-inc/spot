"use node";

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import {
  ClRouterRequestError,
  MAX_CL_ROUTER_JSON_REQUEST_BYTES,
  clRouterAssetReferenceFromUrl,
  clRouterGenerate,
  clRouterGenerateStream,
  isClRouterFailureCode,
  type ClRouterClientOptions,
  type ClRouterAssetReference,
  type ClRouterGenerateRequest,
  type ClRouterGenerateResponse,
  type ClRouterMessage,
  type ClRouterMessagePart,
  type ClRouterResponseMetadata,
  type ClRouterSettingsSnapshot,
  type ClRouterToolChoice,
  type ClRouterToolDefinition,
  type ClRouterUsage,
} from "./clRouterClient";
import type { ModelRoute, ModelTask } from "./modelCatalog";
import { settleRouterAssetCleanups } from "../actions/routerAssets";

export type ClRouterLanguageModelStep = {
  step: number;
  hasTools: boolean;
  hasToolResults: boolean;
  maxOutputTokens?: number;
  finishReason?: string;
  hitOutputLimit?: boolean;
  visibleTextLength?: number;
  toolNames?: string[];
};

export type ClRouterLanguageModelOptions = {
  task: ModelTask;
  taskKind?: string;
  orgId?: string;
  settings: ClRouterSettingsSnapshot | null;
  sessionKey: string;
  trace?: ClRouterGenerateRequest["trace"];
  initialRoutePin?: ModelRoute;
  allowFallback?: boolean;
  assetStager?: (asset: {
    bytes: Uint8Array;
    mediaType: string;
    filename?: string;
  }) => Promise<{
    reference: ClRouterAssetReference;
    cleanup: () => void | Promise<void>;
  }>;
  client?: ClRouterClientOptions;
  initialExecutionBudgetMs?: number;
  onResponse?: (
    response: ClRouterResponseMetadata,
    step: ClRouterLanguageModelStep,
  ) => void | Promise<void>;
};

export class ClRouterToolContractError extends ClRouterRequestError {
  readonly expectedToolName?: string;
  readonly actualToolNames: string[];

  constructor(
    expectedToolName: string | undefined,
    actualToolNames: string[],
    options?: { requestId?: string },
  ) {
    const expectation = expectedToolName
      ? `tool ${expectedToolName}`
      : "at least one tool call";
    const actual =
      actualToolNames.length > 0 ? actualToolNames.join(", ") : "none";
    super(
      "invalid_response",
      `cl-router violated the forced tool contract: expected ${expectation}, received ${actual}`,
      options,
    );
    this.name = "ClRouterToolContractError";
    this.expectedToolName = expectedToolName;
    this.actualToolNames = actualToolNames;
  }
}

function failureWithResponseContext(
  error: unknown,
  response: ClRouterResponseMetadata,
): unknown {
  if (error instanceof ClRouterToolContractError) {
    return new ClRouterToolContractError(
      error.expectedToolName,
      error.actualToolNames,
      { requestId: response.requestId },
    );
  }
  if (error instanceof ClRouterRequestError) {
    return new ClRouterRequestError(error.kind, error.message, {
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.routerCode === undefined
        ? {}
        : { routerCode: error.routerCode }),
      ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
      ...(error.executionStarted === undefined
        ? {}
        : { executionStarted: error.executionStarted }),
      requestId: response.requestId,
      attempts: error.attempts,
      cause: error,
    });
  }
  return error;
}

export class ClRouterVisibleOutputError extends Error {
  constructor(cause: unknown) {
    super("cl-router stream failed after visible output began", { cause });
    this.name = "ClRouterVisibleOutputError";
  }
}

function dataContent(data: Uint8Array | string): string {
  return typeof data === "string" ? data : Buffer.from(data).toString("base64");
}

const MAX_ROUTER_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_ROUTER_ASSET_AGGREGATE_BYTES = 16 * 1024 * 1024;
const MAX_ROUTER_ASSET_COUNT = 8;

type StagedAssetState = {
  count: number;
  decodedBytes: number;
};

function decodedData(data: Uint8Array | string): Uint8Array {
  return typeof data === "string"
    ? new Uint8Array(Buffer.from(data.replace(/\s/g, ""), "base64"))
    : data;
}

function accountAsset(state: StagedAssetState, sizeBytes: number): void {
  state.count += 1;
  state.decodedBytes += sizeBytes;
  if (sizeBytes <= 0 || sizeBytes > MAX_ROUTER_ASSET_BYTES) {
    throw new ClRouterRequestError(
      "configuration",
      "Router assets must be nonempty and no larger than 12 MiB",
    );
  }
  if (state.count > MAX_ROUTER_ASSET_COUNT) {
    throw new ClRouterRequestError(
      "configuration",
      "Router requests may contain at most eight assets",
    );
  }
  if (state.decodedBytes > MAX_ROUTER_ASSET_AGGREGATE_BYTES) {
    throw new ClRouterRequestError(
      "configuration",
      "Router request assets may contain at most 16 MiB decoded data",
    );
  }
}

async function stageAsset(
  state: StagedAssetState,
  data: Uint8Array | string,
  mediaType: string,
  filename?: string,
): Promise<ClRouterMessagePart> {
  const bytes = decodedData(data);
  accountAsset(state, bytes.byteLength);
  return mediaType.startsWith("image/")
    ? { type: "image", image: dataContent(bytes), mediaType }
    : {
        type: "file",
        data: dataContent(bytes),
        mediaType,
        ...(filename ? { filename } : {}),
      };
}

async function messageParts(
  content: Exclude<LanguageModelV3Prompt[number]["content"], string>,
  fetchImpl: typeof globalThis.fetch,
  environment: Readonly<Record<string, string | undefined>>,
  state: StagedAssetState,
): Promise<ClRouterMessagePart[]> {
  const parts: ClRouterMessagePart[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "text", text: part.text });
        break;
      case "file": {
        if (part.data instanceof URL) {
          const spotOptions = part.providerOptions?.spot;
          const configuredSize =
            spotOptions && typeof spotOptions === "object"
              ? (spotOptions as Record<string, unknown>).routerAssetSizeBytes
              : undefined;
          if (
            configuredSize !== undefined &&
            (!Number.isSafeInteger(configuredSize) ||
              (configuredSize as number) <= 0)
          ) {
            throw new ClRouterRequestError(
              "configuration",
              "Router asset size metadata must be a positive integer",
            );
          }
          const source = await clRouterAssetReferenceFromUrl({
            url: part.data,
            mediaType: part.mediaType,
            filename: part.filename,
            ...(typeof configuredSize === "number"
              ? { sizeBytes: configuredSize }
              : {}),
            fetch: fetchImpl,
            environment,
          });
          accountAsset(state, source.sizeBytes);
          parts.push(
            part.mediaType.startsWith("image/")
              ? { type: "image", source }
              : { type: "file", source },
          );
          break;
        }
        parts.push(
          await stageAsset(state, part.data, part.mediaType, part.filename),
        );
        break;
      }
      case "tool-call":
        parts.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        break;
      case "tool-result":
        parts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
        break;
      case "reasoning":
        // Router providers should not receive hidden reasoning as ordinary text.
        break;
      case "tool-approval-response":
        throw new ClRouterRequestError(
          "configuration",
          "cl-router chat does not support provider-executed tool approvals",
        );
    }
  }
  return parts;
}

async function clRouterMessagesFromPromptWithState(
  prompt: LanguageModelV3Prompt,
  fetchImpl: typeof globalThis.fetch,
  environment: Readonly<Record<string, string | undefined>>,
  state: StagedAssetState,
): Promise<ClRouterMessage[]> {
  const messages: ClRouterMessage[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      messages.push({ role: "system", content: message.content });
      continue;
    }
    messages.push({
      role: message.role,
      content: await messageParts(
        message.content,
        fetchImpl,
        environment,
        state,
      ),
    });
  }
  return messages;
}

export async function clRouterMessagesFromPrompt(
  prompt: LanguageModelV3Prompt,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<ClRouterMessage[]> {
  return clRouterMessagesFromPromptWithState(prompt, fetchImpl, process.env, {
    count: 0,
    decodedBytes: 0,
  });
}

function clRouterTools(
  tools: LanguageModelV3CallOptions["tools"],
): ClRouterToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((definition) => {
    if (definition.type !== "function") {
      throw new ClRouterRequestError(
        "configuration",
        "cl-router chat supports function tools only",
      );
    }
    if (
      !definition.inputSchema ||
      typeof definition.inputSchema !== "object" ||
      Array.isArray(definition.inputSchema)
    ) {
      throw new ClRouterRequestError(
        "configuration",
        `cl-router tool ${definition.name} requires an object JSON schema`,
      );
    }
    return {
      name: definition.name,
      ...(definition.description
        ? { description: definition.description }
        : {}),
      inputSchema: definition.inputSchema as Record<string, unknown>,
    };
  });
}

function clRouterToolChoice(
  choice: LanguageModelV3CallOptions["toolChoice"],
): ClRouterToolChoice | undefined {
  if (!choice) return undefined;
  return choice.type === "tool"
    ? { type: "tool", toolName: choice.toolName }
    : choice.type;
}

function unsupportedWarnings(
  options: LanguageModelV3CallOptions,
): SharedV3Warning[] {
  const unsupported = [
    ["temperature", options.temperature],
    ["stopSequences", options.stopSequences],
    ["topP", options.topP],
    ["topK", options.topK],
    ["presencePenalty", options.presencePenalty],
    ["frequencyPenalty", options.frequencyPenalty],
    ["seed", options.seed],
  ] as const;
  return unsupported
    .filter(([, value]) => value !== undefined)
    .map(([feature]) => ({
      type: "unsupported" as const,
      feature,
      details: "cl-router v1 does not forward this sampling setting",
    }));
}

async function requestForCall(
  adapter: ClRouterLanguageModelOptions,
  options: LanguageModelV3CallOptions,
  parentRequestId?: string,
  selectedRoute?: ModelRoute,
  allowFallback = true,
  executionBudgetMs?: number,
  assetState?: StagedAssetState,
): Promise<ClRouterGenerateRequest> {
  const responseFormat = options.responseFormat;
  const schema =
    responseFormat?.type === "json" && responseFormat.schema
      ? (responseFormat.schema as Record<string, unknown>)
      : undefined;
  const tools = clRouterTools(options.tools);
  const toolChoice = clRouterToolChoice(options.toolChoice);
  return {
    task: adapter.task,
    ...(adapter.taskKind ? { taskKind: adapter.taskKind } : {}),
    ...(adapter.orgId ? { orgId: adapter.orgId } : {}),
    settings: adapter.settings,
    messages: await clRouterMessagesFromPromptWithState(
      options.prompt,
      adapter.client?.fetch ?? globalThis.fetch,
      adapter.client?.environment ?? process.env,
      assetState ?? {
        count: 0,
        decodedBytes: 0,
      },
    ),
    ...(schema
      ? {
          schema,
          schemaDialect:
            "https://json-schema.org/draft/2020-12/schema" as const,
        }
      : {}),
    ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}),
    ...(executionBudgetMs ? { executionBudgetMs } : {}),
    sessionKey: adapter.sessionKey,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { toolChoice } : {}),
    routing: {
      ...(selectedRoute ? { pin: selectedRoute } : {}),
      allowFallback: adapter.allowFallback ?? allowFallback,
    },
    ...(adapter.trace || parentRequestId
      ? {
          trace: {
            ...adapter.trace,
            ...(parentRequestId ? { parentRequestId } : {}),
          },
        }
      : {}),
  };
}

function requestJsonBytes(request: ClRouterGenerateRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).byteLength;
}

async function stageOversizedInlineAssets(
  request: ClRouterGenerateRequest,
  stager: ClRouterLanguageModelOptions["assetStager"],
  cleanups: Array<() => void | Promise<void>>,
): Promise<ClRouterGenerateRequest> {
  if (
    !stager ||
    requestJsonBytes(request) <= MAX_CL_ROUTER_JSON_REQUEST_BYTES - 1024
  ) {
    return request;
  }
  for (const message of request.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (let index = 0; index < message.content.length; index += 1) {
      const part = message.content[index];
      if (!part || (part.type !== "image" && part.type !== "file")) continue;
      if (part.type === "image" && !("image" in part)) continue;
      if (part.type === "file" && !("data" in part)) continue;
      const inlineData = part.type === "image" ? part.image : part.data;
      const mediaType = part.mediaType ?? "image/png";
      const filename = part.type === "file" ? part.filename : undefined;
      const staged = await stager({
        bytes: decodedData(inlineData),
        mediaType,
        ...(filename ? { filename } : {}),
      });
      cleanups.push(staged.cleanup);
      message.content[index] =
        part.type === "image"
          ? { type: "image", source: staged.reference }
          : { type: "file", source: staged.reference };
      if (
        requestJsonBytes(request) <=
        MAX_CL_ROUTER_JSON_REQUEST_BYTES - 1024
      ) {
        return request;
      }
    }
  }
  return request;
}

async function cleanupStagedAssets(
  cleanups: Array<() => void | Promise<void>>,
): Promise<void> {
  await settleRouterAssetCleanups(cleanups);
}

function promptHasToolResults(prompt: LanguageModelV3Prompt): boolean {
  return prompt.some(
    (message) =>
      message.role !== "system" &&
      typeof message.content !== "string" &&
      message.content.some((part) => part.type === "tool-result"),
  );
}

function languageModelUsage(usage: ClRouterUsage): LanguageModelV3Usage {
  const reasoning = usage.reasoningTokens ?? 0;
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: Math.max(
        0,
        usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
      ),
      cacheRead: usage.cachedInputTokens,
      cacheWrite: usage.cacheWriteTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: Math.max(0, usage.outputTokens - reasoning),
      reasoning,
    },
  };
}

function finishReason(raw: string): LanguageModelV3FinishReason {
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  const unified =
    normalized === "stop" ||
    normalized === "length" ||
    normalized === "content-filter" ||
    normalized === "tool-calls" ||
    normalized === "error"
      ? normalized
      : "other";
  return { unified, raw };
}

function providerMetadata(
  metadata: ClRouterResponseMetadata,
): SharedV3ProviderMetadata {
  return {
    "cl-router": {
      requestId: metadata.requestId,
      model: metadata.model,
      routing: metadata.routing,
      costUsd: metadata.costUsd,
      costStatus: metadata.costStatus,
    },
  } as unknown as SharedV3ProviderMetadata;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function jsonInput(input: unknown): string {
  const serialized = JSON.stringify(input);
  if (serialized === undefined) {
    throw new ClRouterRequestError(
      "invalid_response",
      "cl-router returned a non-serializable tool input",
    );
  }
  return serialized;
}

function generatedContent(
  response: ClRouterGenerateResponse,
): LanguageModelV3Content[] {
  if (typeof response.output === "string") {
    return response.output ? [{ type: "text", text: response.output }] : [];
  }
  if (response.output && typeof response.output === "object") {
    const output = response.output as Record<string, unknown>;
    const content: LanguageModelV3Content[] = [];
    if (typeof output.text === "string" && output.text) {
      content.push({ type: "text", text: output.text });
    }
    if (Array.isArray(output.toolCalls)) {
      for (const value of output.toolCalls) {
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as Record<string, unknown>).toolCallId !== "string" ||
          typeof (value as Record<string, unknown>).toolName !== "string"
        ) {
          throw new ClRouterRequestError(
            "invalid_response",
            "cl-router returned an invalid generated tool call",
          );
        }
        const call = value as Record<string, unknown>;
        content.push({
          type: "tool-call",
          toolCallId: call.toolCallId as string,
          toolName: call.toolName as string,
          input: jsonInput(call.input),
        });
      }
      return content;
    }
  }
  return [{ type: "text", text: JSON.stringify(response.output) }];
}

function forcedToolExpectation(
  choice: LanguageModelV3CallOptions["toolChoice"],
): string | null | undefined {
  if (choice?.type === "required") return null;
  if (choice?.type === "tool") return choice.toolName;
  return undefined;
}

function validateForcedToolContract(
  choice: LanguageModelV3CallOptions["toolChoice"],
  toolNames: string[],
): void {
  const expected = forcedToolExpectation(choice);
  if (expected === undefined) return;
  if (
    expected === null
      ? toolNames.length > 0
      : toolNames.length > 0 &&
        toolNames.every((toolName) => toolName === expected)
  )
    return;
  throw new ClRouterToolContractError(expected ?? undefined, toolNames);
}

function contentToolNames(content: LanguageModelV3Content[]): string[] {
  return content
    .filter(
      (part): part is Extract<LanguageModelV3Content, { type: "tool-call" }> =>
        part.type === "tool-call",
    )
    .map((part) => part.toolName);
}

function contentTextLength(content: LanguageModelV3Content[]): number {
  return content.reduce(
    (length, part) => length + (part.type === "text" ? part.text.length : 0),
    0,
  );
}

function completedStepTelemetry(
  step: ClRouterLanguageModelStep,
  options: LanguageModelV3CallOptions,
  rawFinishReason: string,
  content: LanguageModelV3Content[],
): ClRouterLanguageModelStep {
  return {
    ...step,
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    finishReason: rawFinishReason,
    hitOutputLimit: finishReason(rawFinishReason).unified === "length",
    visibleTextLength: contentTextLength(content),
    toolNames: contentToolNames(content),
  };
}

function supportedSpotAssetUrls(): RegExp[] {
  const environment = process.env.SPOT_ENV?.trim().toLowerCase() ?? "local";
  if (environment === "production") {
    return [
      /^https:\/\/merry-platypus-82\.convex\.cloud\/api\/storage\//,
      /^https:\/\/actions\.spot\.insure\/router-assets\?/,
    ];
  }
  if (environment === "dev") {
    return [
      /^https:\/\/acoustic-caiman-755\.convex\.cloud\/api\/storage\//,
      /^https:\/\/acoustic-caiman-755\.convex\.site\/router-assets\?/,
    ];
  }
  return [
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\/storage\//,
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/router-assets\?/,
  ];
}

export function createClRouterLanguageModel(
  adapter: ClRouterLanguageModelOptions,
): LanguageModelV3 {
  let parentRequestId = adapter.trace?.parentRequestId;
  let selectedRoute: ModelRoute | undefined = adapter.initialRoutePin;
  let successfulRouterSteps = 0;
  const clientOptions = (
    abortSignal: AbortSignal | undefined,
    initialStep: boolean,
  ): ClRouterClientOptions => ({
    ...adapter.client,
    ...(initialStep && adapter.initialExecutionBudgetMs
      ? {
          environment: {
            ...(adapter.client?.environment ?? process.env),
            CL_ROUTER_TIMEOUT_MS: String(
              adapter.initialExecutionBudgetMs + 5_000,
            ),
          },
        }
      : {}),
    abortSignal,
  });
  const stepContext = (
    options: LanguageModelV3CallOptions,
  ): ClRouterLanguageModelStep => ({
    step: successfulRouterSteps + 1,
    hasTools: (options.tools?.length ?? 0) > 0,
    hasToolResults: promptHasToolResults(options.prompt),
  });
  const notifyResponse = async (
    response: ClRouterResponseMetadata,
    step: ClRouterLanguageModelStep,
  ) => {
    try {
      await adapter.onResponse?.(response, step);
    } catch (error) {
      console.warn("[cl-router] Failed to record routed model response", error);
    }
  };
  return {
    specificationVersion: "v3",
    provider: "cl-router",
    modelId: `cl-router/${adapter.task}`,
    supportedUrls: {
      "*/*": supportedSpotAssetUrls(),
    },

    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const step = stepContext(options);
      const cleanups: Array<() => void | Promise<void>> = [];
      const assetState: StagedAssetState = {
        count: 0,
        decodedBytes: 0,
      };
      try {
        const request = await stageOversizedInlineAssets(
          await requestForCall(
            adapter,
            options,
            parentRequestId,
            selectedRoute,
            successfulRouterSteps === 0,
            successfulRouterSteps === 0
              ? adapter.initialExecutionBudgetMs
              : undefined,
            assetState,
          ),
          adapter.assetStager,
          cleanups,
        );
        const response = await clRouterGenerate(
          request,
          clientOptions(options.abortSignal, successfulRouterSteps === 0),
        );
        let content: LanguageModelV3Content[];
        try {
          content = generatedContent(response);
          validateForcedToolContract(
            options.toolChoice,
            contentToolNames(content),
          );
        } catch (error) {
          throw failureWithResponseContext(error, response);
        }
        parentRequestId = response.requestId;
        selectedRoute = response.model;
        successfulRouterSteps += 1;
        const rawFinishReason = response.finishReason ?? "stop";
        await notifyResponse(
          response,
          completedStepTelemetry(step, options, rawFinishReason, content),
        );
        return {
          content,
          finishReason: finishReason(rawFinishReason),
          usage: languageModelUsage(response.usage),
          providerMetadata: providerMetadata(response),
          response: {
            id: response.requestId,
            modelId: `${response.model.provider}/${response.model.model}`,
          },
          warnings: unsupportedWarnings(options),
        };
      } finally {
        await cleanupStagedAssets(cleanups);
      }
    },

    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const step = stepContext(options);
      const cleanups: Array<() => void | Promise<void>> = [];
      const assetState: StagedAssetState = {
        count: 0,
        decodedBytes: 0,
      };
      let response: Awaited<ReturnType<typeof clRouterGenerateStream>>;
      try {
        const request = await stageOversizedInlineAssets(
          await requestForCall(
            adapter,
            options,
            parentRequestId,
            selectedRoute,
            successfulRouterSteps === 0,
            successfulRouterSteps === 0
              ? adapter.initialExecutionBudgetMs
              : undefined,
            assetState,
          ),
          adapter.assetStager,
          cleanups,
        );
        response = await clRouterGenerateStream(
          request,
          clientOptions(options.abortSignal, successfulRouterSteps === 0),
        );
      } catch (error) {
        await cleanupStagedAssets(cleanups);
        throw error;
      }

      return {
        response: { headers: responseHeaders(response.headers) },
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              let visibleRouterOutput = false;
              let started = false;
              const activeTextIds = new Set<string>();
              let receivedDone = false;
              const routerToolNames: string[] = [];
              let visibleTextLength = 0;
              const startStream = () => {
                if (started) return;
                started = true;
                controller.enqueue({
                  type: "stream-start",
                  warnings: unsupportedWarnings(options),
                });
              };
              try {
                for await (const event of response.events) {
                  if (receivedDone) {
                    throw new ClRouterRequestError(
                      "invalid_response",
                      "cl-router emitted stream output after done",
                    );
                  }
                  if (event.type === "text-delta") {
                    if (!event.delta) continue;
                    visibleTextLength += event.delta.length;
                    visibleRouterOutput = true;
                    startStream();
                    if (!activeTextIds.has(event.id)) {
                      activeTextIds.add(event.id);
                      controller.enqueue({ type: "text-start", id: event.id });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: event.id,
                      delta: event.delta,
                    });
                  } else if (event.type === "tool-call") {
                    const expectedToolName = forcedToolExpectation(
                      options.toolChoice,
                    );
                    if (
                      typeof expectedToolName === "string" &&
                      event.toolName !== expectedToolName
                    ) {
                      validateForcedToolContract(options.toolChoice, [
                        event.toolName,
                      ]);
                    }
                    visibleRouterOutput = true;
                    routerToolNames.push(event.toolName);
                    startStream();
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: event.toolCallId,
                      toolName: event.toolName,
                      input: jsonInput(event.input),
                    });
                  } else if (event.type === "error") {
                    throw new ClRouterRequestError(
                      event.error.retryable ? "server" : "client",
                      event.error.message,
                      {
                        ...(isClRouterFailureCode(event.error.code)
                          ? { routerCode: event.error.code }
                          : {}),
                        retryable: event.error.retryable,
                        ...(event.error.executionStarted === undefined
                          ? {}
                          : { executionStarted: event.error.executionStarted }),
                        ...(event.error.requestId
                          ? { requestId: event.error.requestId }
                          : {}),
                        attempts: event.error.attempts,
                      },
                    );
                  } else {
                    receivedDone = true;
                    validateForcedToolContract(
                      options.toolChoice,
                      routerToolNames,
                    );
                    parentRequestId = event.requestId;
                    selectedRoute = event.model;
                    successfulRouterSteps += 1;
                    await notifyResponse(event, {
                      ...step,
                      ...(options.maxOutputTokens === undefined
                        ? {}
                        : { maxOutputTokens: options.maxOutputTokens }),
                      finishReason: event.finishReason,
                      hitOutputLimit:
                        finishReason(event.finishReason).unified === "length",
                      visibleTextLength,
                      toolNames: routerToolNames,
                    });
                    startStream();
                    for (const id of activeTextIds) {
                      controller.enqueue({ type: "text-end", id });
                    }
                    controller.enqueue({
                      type: "response-metadata",
                      id: event.requestId,
                      modelId: `${event.model.provider}/${event.model.model}`,
                    });
                    controller.enqueue({
                      type: "finish",
                      finishReason: finishReason(event.finishReason),
                      usage: languageModelUsage(event.usage),
                      providerMetadata: providerMetadata(event),
                    });
                  }
                }
                if (!receivedDone) {
                  throw new ClRouterRequestError(
                    "invalid_response",
                    "cl-router stream ended without a done event",
                  );
                }
                controller.close();
              } catch (error) {
                controller.error(
                  visibleRouterOutput
                    ? new ClRouterVisibleOutputError(error)
                    : error,
                );
              } finally {
                await cleanupStagedAssets(cleanups);
              }
            })();
          },
        }),
      };
    },
  };
}
