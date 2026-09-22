import { DIRECT_MODEL_PROVIDERS } from "../../contracts/cl-router/policy";
import type { DirectModelProvider, Primitive } from "../../contracts/cl-router/policy";

export type RouterModelCapabilities = {
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  embedding: boolean;
  audioInput: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
};

export type RouterModelEntry = {
  provider: DirectModelProvider;
  model: string;
  primitives: Primitive[];
  configured: boolean;
  capabilities: RouterModelCapabilities;
};

const DIRECT_PROVIDER_SET = new Set<string>(DIRECT_MODEL_PROVIDERS);
const PRIMITIVE_SET = new Set<string>([
  "text",
  "reasoning",
  "multimodal",
  "tool_use",
  "embedding",
  "transcription",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function parseModelCapabilities(value: unknown): RouterModelCapabilities | null {
  if (
    !isRecord(value) ||
    typeof value.vision !== "boolean" ||
    typeof value.tools !== "boolean" ||
    typeof value.structuredOutput !== "boolean" ||
    typeof value.embedding !== "boolean" ||
    typeof value.audioInput !== "boolean"
  ) {
    return null;
  }
  return {
    vision: value.vision,
    tools: value.tools,
    structuredOutput: value.structuredOutput,
    embedding: value.embedding,
    audioInput: value.audioInput,
    ...(optionalTokenCount(value.maxInputTokens) !== undefined
      ? { maxInputTokens: optionalTokenCount(value.maxInputTokens) }
      : {}),
    ...(optionalTokenCount(value.maxOutputTokens) !== undefined
      ? { maxOutputTokens: optionalTokenCount(value.maxOutputTokens) }
      : {}),
    ...(optionalTokenCount(value.defaultOutputTokens) !== undefined
      ? { defaultOutputTokens: optionalTokenCount(value.defaultOutputTokens) }
      : {}),
    ...(optionalTokenCount(value.longListOutputTokens) !== undefined
      ? { longListOutputTokens: optionalTokenCount(value.longListOutputTokens) }
      : {}),
  };
}

/**
 * Parse the optional `models` array from GET /v1/capabilities.
 * Missing `models` (older router) returns null. Malformed `models` is invalid.
 */
export function parseRouterModels(value: unknown): RouterModelEntry[] | null | undefined {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return undefined;
  const models: RouterModelEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.provider !== "string" ||
      !DIRECT_PROVIDER_SET.has(item.provider) ||
      typeof item.model !== "string" ||
      item.model.length === 0 ||
      !Array.isArray(item.primitives) ||
      item.primitives.length === 0 ||
      !item.primitives.every(
        (primitive) =>
          typeof primitive === "string" && PRIMITIVE_SET.has(primitive),
      ) ||
      typeof item.configured !== "boolean"
    ) {
      return undefined;
    }
    const capabilities = parseModelCapabilities(item.capabilities);
    if (!capabilities) return undefined;
    models.push({
      provider: item.provider as DirectModelProvider,
      model: item.model,
      primitives: item.primitives as Primitive[],
      configured: item.configured,
      capabilities,
    });
  }
  return models;
}

export function routerModelSupportsTask(
  task: string,
  entry: RouterModelEntry,
): boolean {
  const { primitives, capabilities } = entry;
  if (task === "embeddings") {
    return capabilities.embedding || primitives.includes("embedding");
  }
  if (task === "voice_transcription") {
    return capabilities.audioInput || primitives.includes("transcription");
  }
  if (primitives.includes("embedding") || primitives.includes("transcription")) {
    return false;
  }
  if (task === "chat_vision" || task === "operator_agent") {
    return capabilities.vision;
  }
  return true;
}
