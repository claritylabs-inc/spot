import dayjs from "dayjs";
import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import {
  callContextValidator,
  callResultValidator,
} from "./lib/modelCallTelemetry";
import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import type { ClRouterResponseMetadata } from "./lib/clRouterClient";
import { requireOperator } from "./lib/operatorIdentity";

const RETENTION_DAYS = 30;

const modelProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("moonshot"),
  v.literal("deepseek"),
);

const runValidator = v.object({
  runId: v.string(),
  sessionKey: v.string(),
  orgId: v.optional(v.id("organizations")),
  task: v.string(),
  taskKind: v.string(),
  channel: v.string(),
  label: v.string(),
  phase: v.string(),
  parentRequestId: v.optional(v.string()),
});

const failureAttemptValidator = v.object({
  attempt: v.number(),
  provider: modelProviderValidator,
  model: v.string(),
  outcome: v.union(v.literal("error"), v.literal("timeout")),
  errorCode: v.optional(v.string()),
});

function expiresAt(timestamp: number) {
  return dayjs(timestamp).add(RETENTION_DAYS, "day").valueOf();
}

export const recordResponseInternal = internalMutation({
  args: {
    run: runValidator,
    step: v.number(),
    hasTools: v.boolean(),
    hasToolResults: v.boolean(),
    maxOutputTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    hitOutputLimit: v.optional(v.boolean()),
    visibleTextLength: v.optional(v.number()),
    toolNames: v.optional(v.array(v.string())),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    const response = args.response as ClRouterResponseMetadata;
    const timestamp = dayjs().valueOf();
    const completionIssue = args.hitOutputLimit
      ? ("output_limit" as const)
      : args.visibleTextLength === 0 && (args.toolNames?.length ?? 0) === 0
        ? ("empty_response" as const)
        : undefined;
    await ctx.db.insert("modelRoutingEvents", {
      kind: "model_step",
      ...args.run,
      step: args.step,
      hasTools: args.hasTools,
      hasToolResults: args.hasToolResults,
      requestId: response.requestId,
      provider: response.model.provider,
      model: response.model.model,
      routeSource: response.routing.source ?? response.routing.decision,
      transport: "cl-router",
      routing: response.routing,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      ...(response.usage.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: response.usage.reasoningTokens }),
      cachedInputTokens: response.usage.cachedInputTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      ...(args.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: args.maxOutputTokens }),
      ...(args.finishReason === undefined
        ? {}
        : { finishReason: args.finishReason }),
      ...(args.hitOutputLimit === undefined
        ? {}
        : { hitOutputLimit: args.hitOutputLimit }),
      ...(args.visibleTextLength === undefined
        ? {}
        : { visibleTextLength: args.visibleTextLength }),
      ...(args.toolNames === undefined
        ? {}
        : {
            toolCallCount: args.toolNames.length,
            toolNames: args.toolNames,
          }),
      costUsd: response.costUsd,
      costStatus: response.costStatus,
      status: completionIssue ? "incomplete" : "complete",
      ...(completionIssue ? { completionIssue } : {}),
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const recordRunInternal = internalMutation({
  args: {
    run: runValidator,
    status: v.union(
      v.literal("complete"),
      v.literal("incomplete"),
      v.literal("error"),
    ),
    requestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    routerCode: v.optional(v.string()),
    routerStatus: v.optional(v.number()),
    routerRetryable: v.optional(v.boolean()),
    routerExecutionStarted: v.optional(v.boolean()),
    failureAttempts: v.optional(v.array(failureAttemptValidator)),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    maxOutputTokens: v.optional(v.number()),
    finishReason: v.optional(v.string()),
    hitOutputLimit: v.optional(v.boolean()),
    visibleTextLength: v.optional(v.number()),
    toolCallCount: v.number(),
    completedToolCount: v.number(),
    toolNames: v.array(v.string()),
    workflowOutcomeCount: v.number(),
    workflowFailureCount: v.number(),
    completionIssue: v.optional(
      v.union(
        v.literal("empty_response"),
        v.literal("output_limit"),
        v.literal("workflow_failure"),
      ),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = dayjs().valueOf();
    await ctx.db.insert("modelRoutingEvents", {
      kind: "run",
      ...args.run,
      status: args.status,
      requestId: args.requestId,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      routerCode: args.routerCode,
      routerStatus: args.routerStatus,
      routerRetryable: args.routerRetryable,
      routerExecutionStarted: args.routerExecutionStarted,
      failureAttempts: args.failureAttempts,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      ...(args.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: args.reasoningTokens }),
      cachedInputTokens: args.cachedInputTokens,
      cacheWriteTokens: args.cacheWriteTokens,
      ...(args.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: args.maxOutputTokens }),
      ...(args.finishReason === undefined
        ? {}
        : { finishReason: args.finishReason }),
      ...(args.hitOutputLimit === undefined
        ? {}
        : { hitOutputLimit: args.hitOutputLimit }),
      ...(args.visibleTextLength === undefined
        ? {}
        : { visibleTextLength: args.visibleTextLength }),
      toolCallCount: args.toolCallCount,
      completedToolCount: args.completedToolCount,
      toolNames: args.toolNames,
      workflowOutcomeCount: args.workflowOutcomeCount,
      workflowFailureCount: args.workflowFailureCount,
      ...(args.completionIssue === undefined
        ? {}
        : { completionIssue: args.completionIssue }),
      error: args.error,
      timestamp,
      expiresAt: expiresAt(timestamp),
    });
  },
});

export const sweepExpired = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(Math.floor(args.batchSize ?? 500), 1_000),
    );
    const expired = await ctx.db
      .query("modelRoutingEvents")
      .withIndex("expiration", (q) => q.lt("expiresAt", dayjs().valueOf()))
      .take(limit);
    for (const event of expired) await ctx.db.delete(event._id);
    const continuationScheduled = expired.length === limit;
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.modelRoutingEvents.sweepExpired,
        {
          batchSize: limit,
        },
      );
    }
    return { deleted: expired.length, continuationScheduled };
  },
});

// Invocation records are separate from the legacy step/run summaries above.
// Durable callbacks update the same row, so polling never creates usage.
export const startCall = internalMutation({
  args: {
    callKey: v.string(),
    operation: v.string(),
    context: callContextValidator,
  },
  handler: async (ctx, args) => startModelCall(ctx, args),
});

export async function startModelCall(
  ctx: MutationCtx,
  args: {
    callKey: string;
    operation: string;
    context: Infer<typeof callContextValidator>;
  },
) {
  const existing = await ctx.db
    .query("modelRoutingEvents")
    .withIndex("call", (q) => q.eq("callKey", args.callKey))
    .unique();
  if (existing) return existing._id;
  const timestamp = dayjs().valueOf();
  const owner = /^operator:([^:]+):/.exec(args.callKey);
  return ctx.db.insert("modelRoutingEvents", {
    ...args.context,
    callKey: args.callKey,
    operation: args.operation,
    kind: "call",
    runId:
      owner?.[1] ??
      args.context.runId ??
      (args.context.sessionKey.replace(/^requirement:/, "") || args.callKey),
    label: args.context.taskKind,
    phase: args.operation,
    transport: "cl-router",
    status: "running",
    timestamp,
    expiresAt: expiresAt(timestamp),
  });
}

export async function finishModelCall(
  ctx: MutationCtx,
  callKey: string,
  status: "complete" | "error" | "cancelled" | "unknown",
  result?: Infer<typeof callResultValidator>,
  error?: string,
) {
  const call = await ctx.db
    .query("modelRoutingEvents")
    .withIndex("call", (q) => q.eq("callKey", callKey))
    .unique();
  if (!call || call.status !== "running") return;
  const completedAt = dayjs().valueOf();
  const metadata = Object.fromEntries(
    Object.entries(result ?? {}).filter(([, value]) => value !== undefined),
  );
  await ctx.db.patch(call._id, {
    ...metadata,
    status:
      status === "complete" &&
      (result?.completionIssue || result?.finishReason === "length")
        ? "incomplete"
        : status,
    completedAt,
    durationMs: completedAt - call.timestamp,
    error: error?.slice(0, 2000),
    expiresAt: expiresAt(completedAt),
  });
}
export const finishCall = internalMutation({
  args: {
    callKey: v.string(),
    status: v.union(
      v.literal("complete"),
      v.literal("error"),
      v.literal("cancelled"),
      v.literal("unknown"),
    ),
    result: v.optional(callResultValidator),
    error: v.optional(v.string()),
  },
  handler: (ctx, args) =>
    finishModelCall(ctx, args.callKey, args.status, args.result, args.error),
});

const callFilters = {
  from: v.number(),
  to: v.number(),
  search: v.optional(v.string()),
  status: v.optional(v.string()),
  task: v.optional(v.string()),
  model: v.optional(v.string()),
  modelExact: v.optional(v.boolean()),
  channel: v.optional(v.string()),
  orgId: v.optional(v.id("organizations")),
  routeSource: v.optional(v.string()),
};
export const listCalls = query({
  args: { ...callFilters, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (
      !Number.isFinite(args.from) ||
      !Number.isFinite(args.to) ||
      args.to < args.from ||
      args.to - args.from > 31 * 86400_000
    ) {
      throw new Error("Choose a time range of at most 31 days");
    }
    const result = await ctx.db
      .query("modelRoutingEvents")
      .withIndex("kind_time", (q) =>
        q
          .eq("kind", "call")
          .gte("timestamp", args.from)
          .lte("timestamp", args.to),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 250),
      });
    const needle = args.search?.trim().toLowerCase();
    return {
      ...result,
      page: result.page.filter(
        (call) =>
          (!args.status || call.status === args.status) &&
          (!args.task || call.task === args.task) &&
          (!args.model ||
            (args.modelExact
              ? (call.model ?? call.callProvider ?? "Not reported") ===
                args.model
              : (call.model ?? call.callProvider ?? "Not reported")
                  .toLowerCase()
                  .includes(args.model.toLowerCase()))) &&
          (!args.channel || call.channel === args.channel) &&
          (!args.orgId || call.orgId === args.orgId) &&
          (!args.routeSource || call.routeSource === args.routeSource) &&
          (!needle ||
            [
              call.task,
              call.taskKind,
              call.model,
              call.callProvider,
              call.error,
              call.requestId,
              call.runId,
              call.callKey,
              call.orgId,
            ].some((value) => value?.toLowerCase().includes(needle))),
      ),
    };
  },
});

export const getCall = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const id = ctx.db.normalizeId("modelRoutingEvents", args.id);
    const call = id ? await ctx.db.get(id) : null;
    if (!call || call.kind !== "call") return null;
    const runId = ctx.db.normalizeId("operatorAgentRuns", call.runId);
    const run = runId ? await ctx.db.get(runId) : null;
    const org = call.orgId ? await ctx.db.get(call.orgId) : null;
    const requirementRun = call.sessionKey.startsWith("requirement:")
      ? await ctx.db
          .query("requirementExtractionRuns")
          .withIndex("run", (q) => q.eq("runId", call.runId))
          .unique()
      : null;
    const policyRun = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", call.runId))
      .unique();
    return {
      ...call,
      policyRun,
      orgName: org?.name,
      threadId: run?.threadId,
      requirementRun,
    };
  },
});
