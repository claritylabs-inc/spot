import { v } from "convex/values";

export const callContextValidator = v.object({
  task: v.string(),
  taskKind: v.string(),
  channel: v.string(),
  sessionKey: v.string(),
  runId: v.optional(v.string()),
  orgId: v.optional(v.id("organizations")),
  model: v.optional(v.string()),
  callProvider: v.optional(v.string()),
  routeSource: v.optional(v.string()),
});
export const callResultValidator = v.object({
  requestId: v.optional(v.string()),
  routingSummary: v.optional(v.string()),
  model: v.optional(v.string()),
  callProvider: v.optional(v.string()),
  routeSource: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  completionIssue: v.optional(
    v.union(v.literal("empty_response"), v.literal("output_limit")),
  ),
  reasoningTokens: v.optional(v.number()),
  costUsd: v.optional(v.union(v.number(), v.null())),
  finishReason: v.optional(v.string()),
});
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 500) : undefined;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

// Only metadata crosses this boundary; prompts, assets and capability URLs do not.
export function modelCallContext(payload: unknown, operation = "generate") {
  const p = record(payload);
  const route = record(p.route);
  const trace = record(p.trace);
  const tags = record(trace.tags);
  const tagged = (key: string) => text(tags[key]) ?? text(trace[key]);
  return {
    task: tagged("task") ?? text(p.task) ?? text(p.primitive) ?? operation,
    taskKind:
      tagged("taskKind") ??
      text(p.taskKind) ??
      tagged("label") ??
      text(trace.caller) ??
      text(p.primitive) ??
      text(p.task) ??
      operation,
    channel: tagged("channel") ?? text(p.channel) ?? "system",
    sessionKey: text(p.sessionKey) ?? text(trace.traceId) ?? "",
    runId: text(trace.traceId),
    orgId: text(p.orgId),
    model: text(route.model),
    callProvider: text(route.provider),
    routeSource: p.route ? "manual" : "automatic",
  };
}
export function modelCallResult(payload: unknown) {
  const p = record(payload);
  const model = record(p.model);
  const output = record(p.output);
  const outputLimit =
    p.finishReason === "length" || p.finishReason === "max_tokens";
  const emptyResponse =
    (typeof p.output === "string" && p.output.trim() === "") ||
    (typeof output.text === "string" &&
      !output.text.trim() &&
      (!Array.isArray(output.toolCalls) || output.toolCalls.length === 0));
  const usage = record(p.usage);
  const routing = record(p.routing);
  const route = record(routing.route);
  const nanoCost = number(record(p.cost).costNanoUsd);
  const costUsd =
    number(p.costUsd) ?? (nanoCost === undefined ? null : nanoCost / 1e9);
  const selectedTier = number(routing.selectedTier);
  return {
    requestId: text(p.requestId),
    model: text(model.model) ?? text(route.model) ?? text(p.model),
    callProvider:
      text(model.provider) ?? text(route.provider) ?? text(p.provider),
    routeSource: text(routing.source) ?? text(routing.decision),
    inputTokens: number(usage.inputTokens),
    outputTokens: number(usage.outputTokens),
    cachedInputTokens: number(usage.cachedInputTokens),
    cacheWriteTokens: number(usage.cacheWriteTokens),
    completionIssue: outputLimit
      ? ("output_limit" as const)
      : emptyResponse
        ? ("empty_response" as const)
        : undefined,
    reasoningTokens: number(usage.reasoningTokens),
    costUsd,
    routingSummary:
      [
        text(routing.decision),
        text(routing.source),
        text(routing.primitive),
        text(routing.difficulty),
        selectedTier === undefined ? undefined : `tier ${selectedTier}`,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    finishReason: text(p.finishReason),
  };
}

export function modelCallPayloadPreview(payload: unknown): string {
  function redact(value: unknown): unknown {
    if (typeof value === "string")
      return value.length > 16000
        ? `${value.slice(0, 16000)}\n[truncated]`
        : value;
    if (Array.isArray(value)) return value.slice(0, 100).map(redact);
    if (!value || typeof value !== "object") return value;
    const item = value as Record<string, unknown>;
    if (["image", "file", "input_audio"].includes(String(item.type)))
      return { type: item.type, source: "[binary asset omitted]" };
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]) => [
        key,
        /^(authorization|apiKey|secret|token|requestToken|resultToken|audio|audioBase64|base64|bytes)$/i.test(
          key,
        )
          ? "[omitted]"
          : key === "url" &&
              typeof entry === "string" &&
              /[?&](token|signature)=|\/router-jobs\/|\/api\/storage\//i.test(
                entry,
              )
            ? "[asset URL omitted]"
            : redact(entry),
      ]),
    );
  }
  const serialized = JSON.stringify(redact(payload), null, 2);
  return serialized.length > 128000
    ? `${serialized.slice(0, 128000)}\n[preview truncated]`
    : serialized;
}
