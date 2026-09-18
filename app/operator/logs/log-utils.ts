import dayjs from "dayjs";
import type { Doc } from "@/convex/_generated/dataModel";
export type ModelCall = Doc<"modelRoutingEvents">;
export const displayTask = (value: string) => value.replaceAll("_", " ");
export const tokens = (value?: number) =>
  value === undefined ? "—" : value.toLocaleString();
export const cost = (value?: number | null) =>
  value == null ? "Unpriced" : `$${value.toFixed(value < 0.01 ? 6 : 3)}`;
export function diagnostic(call: ModelCall) {
  return JSON.stringify(
    {
      version: 1,
      callId: call._id,
      startedAt: dayjs(call.timestamp).toISOString(),
      operation: call.operation,
      task: call.task,
      status: call.status,
      model: call.model,
      provider: call.callProvider,
      routeSource: call.routeSource,
      routingSummary: call.routingSummary,
      requestId: call.requestId,
      runId: call.runId,
      channel: call.channel,
      organizationId: call.orgId,
      durationMs: call.durationMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cachedInputTokens: call.cachedInputTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      completionIssue: call.completionIssue,
      reasoningTokens: call.reasoningTokens,
      costUsd: call.costUsd ?? null,
      error: call.error,
      finishReason: call.finishReason,
    },
    null,
    2,
  );
}
export function downloadReport(
  name: string,
  contents: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
