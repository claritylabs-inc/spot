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
  const settings = record(p.settings);
  const pin = record(
    record(p.routing).pin ?? record(settings.routes)[String(p.task)],
  );
  const trace = record(p.trace);
  return {
    task: text(p.task) ?? operation,
    taskKind:
      text(p.taskKind) ?? text(trace.label) ?? text(p.task) ?? operation,
    channel: text(trace.channel) ?? text(p.channel) ?? "system",
    sessionKey: text(p.sessionKey) ?? "",
    runId: text(trace.traceId),
    orgId: text(p.orgId),
    model: text(pin.model),
    callProvider: text(pin.provider),
    routeSource:
      text(record(settings.routeSources)[String(p.task)]) ??
      (text(pin.model) ? "override" : "automatic"),
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
  const selection = record(routing.selection);
  const decisionCost = record(p.cost);
  const nanoCost = number(decisionCost.costNanoUsd);
  const totalNanoCost = number(selection.totalCostNanoUsd);
  const selectorNanoCost = number(selection.costNanoUsd);
  const generationCost = number(p.costUsd);
  const costUsd =
    "totalCostNanoUsd" in selection
      ? totalNanoCost === undefined
        ? null
        : totalNanoCost / 1e9
      : Object.keys(selection).length
        ? generationCost !== undefined && selectorNanoCost !== undefined
          ? generationCost + selectorNanoCost / 1e9
          : null
        : (generationCost ?? (nanoCost === undefined ? null : nanoCost / 1e9));
  return {
    requestId: text(p.requestId),
    model: text(model.model) ?? text(p.model),
    callProvider: text(model.provider) ?? text(p.provider),
    routeSource: text(routing.routeSource),
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
      [text(routing.decision), text(selection.reason)]
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
