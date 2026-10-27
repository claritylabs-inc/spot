import { v, type Infer } from "convex/values";
import { TOOL_RESULT_SUMMARY_PATTERN } from "./toolResultSummary";

/**
 * Live execution status for a processing agent message. It records what the
 * app itself observed: tool names, call ids, bounded web-search labels,
 * structural result counts and, for operator writes, a bounded change
 * summary; never full arguments, results or model reasoning. "returned" means the tool
 * function returned without an error marker; only an explicit success marker
 * becomes "completed".
 */
export const MESSAGE_ACTIVITY_MAX_TOOLS = 128;
export const MESSAGE_ACTIVITY_MAX_STRING = 200;
/** Change summaries carry names and short quoted values, so allow more. */
export const MESSAGE_ACTIVITY_MAX_CHANGE = 280;

const toolContextValidator = v.object({
  label: v.string(),
  website: v.optional(v.string()),
  websites: v.optional(v.array(v.string())),
});

/** Record a call acted on, as an id the viewer's query resolves to a brand. */
export const toolTargetValidator = v.object({
  kind: v.union(v.literal("organization"), v.literal("procurement_request")),
  id: v.string(),
});

export const messageActivityToolStatusValidator = v.union(
  v.literal("requested"),
  v.literal("running"),
  v.literal("returned"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("awaiting_approval"),
  v.literal("skipped"),
);

export const messageActivityStageValidator = v.object({
  stageId: v.string(),
  stage: v.union(
    v.literal("assessing_workflow"),
    v.literal("planning"),
    v.literal("preparing_context"),
    v.literal("screening_request"),
    v.literal("selecting_tools"),
    v.literal("selecting_model"),
  ),
  detail: v.optional(v.string()),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
  ),
});

/** Set by `applyMessageActivity` from its clock, never by the caller. */
const activityTimingFields = {
  /** When the entry was first observed running. */
  startedAt: v.optional(v.number()),
  /** When an entry observed running settled. */
  endedAt: v.optional(v.number()),
};

export const messageActivityValidator = v.object({
  phase: v.union(v.literal("model"), v.literal("tools")),
  tools: v.array(
    v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      status: messageActivityToolStatusValidator,
      context: v.optional(toolContextValidator),
      /** Count summary of a settled call ("3 threads"); see toolResultSummary. */
      result: v.optional(v.string()),
      target: v.optional(toolTargetValidator),
      /** Operator-only: what a completed write did, names not ids. */
      change: v.optional(v.string()),
      /** A stored preview of the result exists for this call. */
      preview: v.optional(v.boolean()),
      ...activityTimingFields,
    }),
  ),
  stages: v.optional(
    v.array(
      v.object({
        ...messageActivityStageValidator.fields,
        ...activityTimingFields,
      }),
    ),
  ),
  updatedAt: v.number(),
});

export const requestedToolCallValidator = v.object({
  toolCallId: v.string(),
  toolName: v.string(),
});

export const messageActivityUpdateValidator = v.union(
  v.object({
    kind: v.literal("stage"),
    ...messageActivityStageValidator.fields,
  }),
  v.object({ kind: v.literal("model") }),
  v.object({
    kind: v.literal("requested"),
    toolCalls: v.array(requestedToolCallValidator),
  }),
  v.object({
    kind: v.literal("tool"),
    toolCallId: v.string(),
    toolName: v.string(),
    status: messageActivityToolStatusValidator,
    context: v.optional(toolContextValidator),
    result: v.optional(v.string()),
    target: v.optional(toolTargetValidator),
    change: v.optional(v.string()),
    preview: v.optional(v.boolean()),
  }),
);

export type MessageActivityStage = Infer<typeof messageActivityStageValidator>;
type StoredActivityStage = NonNullable<MessageActivity["stages"]>[number];
export type MessageActivity = Infer<typeof messageActivityValidator>;
export type MessageActivityUpdate = Infer<
  typeof messageActivityUpdateValidator
>;
export type MessageActivityToolStatus = Infer<
  typeof messageActivityToolStatusValidator
>;
export type RequestedToolCall = Infer<typeof requestedToolCallValidator>;
export type MessageActivityToolTarget = Infer<typeof toolTargetValidator>;

const SETTLED: ReadonlySet<MessageActivityToolStatus> = new Set([
  "returned",
  "completed",
  "failed",
  "awaiting_approval",
  "skipped",
]);

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MESSAGE_ACTIVITY_MAX_STRING
  );
}

/**
 * Validates the optional cumulative `toolCalls` router progress metadata.
 * Returns undefined when absent and null when malformed, including extra keys
 * that could smuggle arguments or results.
 */
export function parseRequestedToolCalls(
  value: unknown,
): RequestedToolCall[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MESSAGE_ACTIVITY_MAX_TOOLS)
    return null;
  const seen = new Set<string>();
  const calls: RequestedToolCall[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return null;
    const keys = Object.keys(entry);
    const { toolCallId, toolName } = entry as Record<string, unknown>;
    if (
      keys.length !== 2 ||
      !validText(toolCallId) ||
      !validText(toolName) ||
      seen.has(toolCallId)
    )
      return null;
    seen.add(toolCallId);
    calls.push({ toolCallId, toolName });
  }
  return calls;
}

/** Router stages have a fixed vocabulary and cannot carry provider text. */
export function parseRouterActivityStages(
  value: unknown,
): MessageActivityStage[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 2) return null;
  const stages: MessageActivityStage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return null;
    const { stageId, stage, status } = entry as Record<string, unknown>;
    if (
      Object.keys(entry).length !== 3 ||
      (stage !== "selecting_model" && stage !== "selecting_tools") ||
      stageId !== stage ||
      (status !== "running" && status !== "completed" && status !== "failed") ||
      stages.some((existing) => existing.stageId === stageId)
    )
      return null;
    stages.push({ stageId: stage, stage, status });
  }
  return stages;
}

export function applyMessageActivity(
  current: MessageActivity | undefined,
  update: MessageActivityUpdate,
  now: number,
): MessageActivity {
  let phase = current?.phase ?? "model";
  let tools = [...(current?.tools ?? [])];
  let stages = current?.stages;
  if (update.kind === "stage") {
    if (!validText(update.stageId))
      return current ?? { phase, tools, updatedAt: now };
    stages = [...(stages ?? [])];
    const index = stages.findIndex((stage) => stage.stageId === update.stageId);
    const startedAt =
      index < 0
        ? update.status === "running"
          ? now
          : undefined
        : stages[index].startedAt;
    const entry: StoredActivityStage = {
      stageId: update.stageId,
      stage: update.stage,
      status: update.status,
      ...(update.detail?.trim()
        ? { detail: update.detail.trim().slice(0, 200) }
        : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(startedAt !== undefined && update.status !== "running"
        ? { endedAt: now }
        : {}),
    };
    if (index < 0) stages.push(entry);
    else if (stages[index].status === "running") stages[index] = entry;
    stages = stages.slice(-32);
  } else if (update.kind === "model") {
    // A new model step means earlier steps' tools settled; unannounced
    // requests belong to a replaced or retried router job.
    phase = "model";
    tools = tools.filter((tool) => tool.status !== "requested");
  } else if (update.kind === "requested") {
    for (const call of update.toolCalls) {
      if (!tools.some((tool) => tool.toolCallId === call.toolCallId))
        tools.push({ ...call, status: "requested" });
    }
  } else {
    phase = "tools";
    const context = update.context?.label.trim()
      ? {
          label: update.context.label.trim().slice(0, 160),
          ...(update.context.websites?.length
            ? {
                websites: [...new Set(update.context.websites)]
                  .filter((site) => site.length <= 200)
                  .slice(0, 10),
              }
            : {}),
          ...(update.context.website && update.context.website.length <= 200
            ? { website: update.context.website }
            : {}),
        }
      : undefined;
    const index = tools.findIndex(
      (tool) => tool.toolCallId === update.toolCallId,
    );
    const result =
      update.result &&
      SETTLED.has(update.status) &&
      TOOL_RESULT_SUMMARY_PATTERN.test(update.result)
        ? { result: update.result }
        : {};
    const change =
      update.change?.trim() &&
      update.status === "completed" &&
      update.change.length <= MESSAGE_ACTIVITY_MAX_CHANGE
        ? { change: update.change.trim() }
        : {};
    const target =
      update.target && validText(update.target.id)
        ? { target: { kind: update.target.kind, id: update.target.id } }
        : {};
    if (index < 0) {
      tools.push({
        toolCallId: update.toolCallId,
        toolName: update.toolName,
        status: update.status,
        ...(context ? { context } : {}),
        ...result,
        ...target,
        ...change,
        ...(update.preview && SETTLED.has(update.status)
          ? { preview: true }
          : {}),
        ...(update.status === "running" ? { startedAt: now } : {}),
      });
    } else if (
      !SETTLED.has(tools[index].status) ||
      SETTLED.has(update.status)
    ) {
      const previous = tools[index];
      const startedAt =
        previous.startedAt ?? (update.status === "running" ? now : undefined);
      tools[index] = {
        ...previous,
        status: update.status,
        ...(context ? { context } : {}),
        ...result,
        ...target,
        ...change,
        ...(update.preview && SETTLED.has(update.status)
          ? { preview: true }
          : {}),
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(startedAt !== undefined &&
        previous.endedAt === undefined &&
        SETTLED.has(update.status)
          ? { endedAt: now }
          : {}),
      };
    }
  }
  return {
    phase,
    tools: tools.slice(-MESSAGE_ACTIVITY_MAX_TOOLS),
    ...(stages ? { stages } : {}),
    updatedAt: now,
  };
}

/** The activity target for a registry target, when it has a brand to show. */
export function toolActivityTarget(target: {
  kind?: string;
  id?: string;
}): MessageActivityToolTarget | undefined {
  if (!validText(target.id)) return;
  if (target.kind === "organization" || target.kind === "procurement_request")
    return { kind: target.kind, id: target.id };
}

/** Classifies a tool function's return value without claiming business success. */
export function toolOutcomeStatus(
  output: unknown,
): Extract<
  MessageActivityToolStatus,
  "returned" | "completed" | "failed" | "awaiting_approval" | "skipped"
> {
  if (!output || typeof output !== "object" || Array.isArray(output))
    return "returned";
  const { status, error } = output as Record<string, unknown>;
  if (status === "confirmation_required" || status === "needs_confirmation")
    return "awaiting_approval";
  if (status === "blocked_by_confirmation") return "skipped";
  if (status === "failed" || status === "error" || typeof error === "string")
    return "failed";
  if (status === "succeeded") return "completed";
  return "returned";
}
