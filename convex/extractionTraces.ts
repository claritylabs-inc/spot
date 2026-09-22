import { routingSelectionValidator } from "./lib/extractionTraceRouterFields";
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  latestCompletedRouterRequest,
  normalizeExtractionTraceRouterFields,
} from "./lib/extractionTraceRouterFields";

const TRACE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PIPELINE_LOG_LIMIT = 500;
const TRACE_SESSION_HEARTBEAT_MS = 10_000;
const PIPELINE_PROGRESS_LOG_MIN_INTERVAL_MS = 10_000;

const traceStatusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
  v.literal("cancelled"),
);

const traceEventKindValidator = v.union(
  v.literal("session"),
  v.literal("phase"),
  v.literal("log"),
  v.literal("model_call"),
  v.literal("embedding_batch"),
  v.literal("worker"),
  v.literal("artifact"),
);

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

const extractionTraceRoutingValidator = v.object({
  decision: v.string(),
  attemptCount: v.optional(v.number()),
  primitive: v.optional(v.string()),
  difficulty: v.optional(
    v.union(
      v.literal("simple"),
      v.literal("standard"),
      v.literal("complex"),
      v.null(),
    ),
  ),
  requiredTier: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  selectedTier: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3))),
  route: v.optional(
    v.object({
      provider: modelProviderValidator,
      model: v.string(),
    }),
  ),
  source: v.optional(v.string()),
  candidatesConsidered: v.optional(
    v.array(
      v.object({
        provider: modelProviderValidator,
        model: v.string(),
      }),
    ),
  ),
  policyVersion: v.optional(v.union(v.string(), v.null())),
  cacheStickinessApplied: v.optional(v.boolean()),
  routeSource: v.optional(v.string()),
  shadowMode: v.optional(v.boolean()),
  wouldHaveChosen: v.optional(
    v.object({
      provider: modelProviderValidator,
      model: v.string(),
      decision: v.string(),
    }),
  ),
  wouldHaveMatched: v.optional(v.boolean()),
  selection: v.optional(routingSelectionValidator),
});

function nowMs() {
  return dayjs().valueOf();
}

function expiresAt(timestamp: number) {
  return timestamp + TRACE_RETENTION_MS;
}

function formatDuration(ms?: number) {
  if (ms === undefined) return undefined;
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function progressMessage(args: {
  kind: string;
  label?: string;
  task?: string;
  taskKind?: string;
  phase?: string;
  status?: string;
  durationMs?: number;
  provider?: string;
  model?: string;
  routeSource?: string;
  transport?: string;
  attempt?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}) {
  const duration = formatDuration(args.durationMs);
  if (args.kind === "model_call") {
    const rawLabel = args.label ?? args.taskKind ?? "model call";
    const label = /generate(Object|Text)/i.test(rawLabel) ? (args.taskKind ?? "Analyzing document") : rawLabel;
    const route = [
      [args.provider, args.model].filter(Boolean).join(" / "),
      args.routeSource,
      args.transport,
    ].filter(Boolean).join(", ");
    const status =
      args.error ? "failed"
      : args.status === "complete" ? "completed"
      : args.status === "soft_failed" ? "returned fallback"
      : args.status;
    const attempt = args.attempt ? ` attempt ${args.attempt}` : "";
    const tokens = args.inputTokens !== undefined || args.outputTokens !== undefined
      ? `${args.inputTokens ?? 0} in / ${args.outputTokens ?? 0} out`
      : undefined;
    return [
      `${label}${attempt}${status ? ` ${status}` : ""}`,
      route ? `(${route})` : undefined,
      duration,
      tokens,
      args.error ? `error: ${args.error}` : undefined,
    ].filter(Boolean).join(" · ");
  }
  if (args.error) return args.error;
  if (args.kind === "embedding_batch") {
    return `Indexing ${args.label ?? "document"}${duration ? ` · ${duration}` : ""}`;
  }
  if (args.kind === "worker" || args.kind === "artifact") {
    return [args.label ?? args.phase ?? args.kind, args.status, duration ? `in ${duration}` : undefined]
      .filter(Boolean)
      .join(" ");
  }
  return null;
}

function traceStatusFromPipeline(status: "complete" | "error", error?: string) {
  if (status === "complete") return "complete" as const;
  return error === "Cancelled by user" ? "cancelled" as const : "error" as const;
}

function isImportantProgressLog(entry: { message: string; level?: string }) {
  if (entry.level === "warn" || entry.level === "error") return true;
  return /\b(complete|completed|cancelled|canceled|failed|error|finished)\b/i.test(entry.message);
}

async function completeSessionDoc(
  ctx: MutationCtx,
  session: {
    _id: Id<"policyExtractionTraceSessions">;
    traceId: string;
    policyId: Id<"policies">;
    orgId: Id<"organizations">;
    startedAt: number;
    expiresAt: number;
    status: "running" | "complete" | "error" | "cancelled";
  },
  status: "complete" | "error" | "cancelled",
  error?: string,
  message?: string,
) {
  if (session.status !== "running") return false;
  const timestamp = nowMs();
  const patch: {
    status: "complete" | "error" | "cancelled";
    completedAt: number;
    lastEventAt: number;
    totalDurationMs: number;
    updatedAt: number;
    error?: string | undefined;
  } = {
    status,
    completedAt: timestamp,
    lastEventAt: timestamp,
    totalDurationMs: timestamp - session.startedAt,
    updatedAt: timestamp,
  };
  if (status === "complete") {
    patch.error = undefined;
  } else if (error !== undefined) {
    patch.error = error;
  }
  await ctx.db.patch(session._id, patch);
  await ctx.db.insert("policyExtractionTraceEvents", defined({
    traceId: session.traceId,
    policyId: session.policyId,
    orgId: session.orgId,
    kind: "session",
    timestamp,
    status,
    message: message ?? (status === "complete" ? "Extraction trace completed" : "Extraction trace ended"),
    error,
    durationMs: timestamp - session.startedAt,
    expiresAt: session.expiresAt,
  }) as any);
  return true;
}

async function appendProgressLog(
  ctx: MutationCtx,
  policyId: Id<"policies">,
  entry: { timestamp: number; message: string; phase?: string; level?: string },
) {
  const run = await ctx.db
    .query("policyExtractionRuns")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .first();
  if (!run) return;
  const existing = Array.isArray(run.pipelineLog) ? run.pipelineLog : [];
  const previous = existing.at(-1);
  const important = isImportantProgressLog(entry);
  const phaseChanged = previous?.phase !== entry.phase;
  const enoughTimeElapsed =
    previous?.timestamp === undefined ||
    entry.timestamp - previous.timestamp >= PIPELINE_PROGRESS_LOG_MIN_INTERVAL_MS;
  if (!important && !phaseChanged && !enoughTimeElapsed) return;
  await ctx.db.patch(run._id, {
    pipelineLog: [...existing, entry].slice(-PIPELINE_LOG_LIMIT),
    updatedAt: nowMs(),
  });
}

export const startSession = internalMutation({
  args: {
    traceId: v.string(),
    policyId: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    sourceKind: v.optional(v.string()),
    trigger: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = nowMs();
    const existing = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId))
      .first();

    const session = {
      traceId: args.traceId,
      policyId: args.policyId,
      orgId: args.orgId,
      userId: args.userId,
      sourceKind: args.sourceKind,
      trigger: args.trigger,
      fileName: args.fileName,
      status: "running" as const,
      startedAt: timestamp,
      lastEventAt: timestamp,
      modelCallCount: 0,
      modelDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      expiresAt: expiresAt(timestamp),
      updatedAt: timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, defined(session));
    } else {
      await ctx.db.insert("policyExtractionTraceSessions", defined(session) as typeof session);
    }

    await ctx.db.insert("policyExtractionTraceEvents", {
      traceId: args.traceId,
      policyId: args.policyId,
      orgId: args.orgId,
      kind: "session",
      timestamp,
      status: "running",
      message: "Extraction trace started",
      details: defined({
        sourceKind: args.sourceKind,
        trigger: args.trigger,
        fileName: args.fileName,
      }),
      expiresAt: expiresAt(timestamp),
    });

    return args.traceId;
  },
});

export const recordEvent = internalMutation({
  args: {
    traceId: v.optional(v.string()),
    kind: traceEventKindValidator,
    timestamp: v.optional(v.number()),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
    message: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    routerRequestId: v.optional(v.string()),
    costUsd: v.optional(v.union(v.number(), v.null())),
    costStatus: v.optional(v.union(v.literal("priced"), v.literal("unpriced"))),
    routingDecision: v.optional(v.string()),
    routing: v.optional(extractionTraceRoutingValidator),
    error: v.optional(v.string()),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (!args.traceId) return false;
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId!))
      .first();
    if (!session) return false;

    const timestamp = args.timestamp ?? nowMs();
    const routerFields = normalizeExtractionTraceRouterFields({
      routerRequestId: args.routerRequestId,
      cachedInputTokens: args.cachedInputTokens,
      costUsd: args.costUsd,
      costStatus: args.costStatus,
      routingDecision: args.routingDecision,
      routing: args.routing,
      details: args.details,
    });
    await ctx.db.insert("policyExtractionTraceEvents", defined({
      traceId: args.traceId,
      policyId: session.policyId,
      orgId: session.orgId,
      kind: args.kind,
      timestamp,
      phase: args.phase,
      level: args.level,
      message: args.message,
      label: args.label,
      task: args.task,
      taskKind: args.taskKind,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      attempt: args.attempt,
      status: args.status,
      durationMs: args.durationMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedInputTokens: routerFields.cachedInputTokens,
      routerRequestId: routerFields.routerRequestId,
      costUsd: routerFields.costUsd,
      costStatus: routerFields.costStatus,
      routingDecision: routerFields.routingDecision,
      routing: routerFields.routing,
      error: args.error,
      details: routerFields.details,
      expiresAt: session.expiresAt,
    }) as any);

    const patch: Record<string, unknown> = {};
    const shouldHeartbeatSession =
      timestamp - (session.lastEventAt ?? session.startedAt) >= TRACE_SESSION_HEARTBEAT_MS;
    if (args.kind === "model_call") {
      patch.modelCallCount = (session.modelCallCount ?? 0) + 1;
      patch.modelDurationMs = (session.modelDurationMs ?? 0) + (args.durationMs ?? 0);
      patch.inputTokens = (session.inputTokens ?? 0) + (args.inputTokens ?? 0);
      patch.outputTokens = (session.outputTokens ?? 0) + (args.outputTokens ?? 0);
    }
    if (
      args.durationMs !== undefined &&
      args.durationMs > (session.slowestDurationMs ?? 0)
    ) {
      patch.slowestDurationMs = args.durationMs;
      patch.slowestKind = args.kind;
      patch.slowestLabel = args.label ?? args.phase ?? args.taskKind ?? args.message;
    }
    if (args.error) {
      patch.error = args.error;
    }
    if (shouldHeartbeatSession || Object.keys(patch).length > 0) {
      if (shouldHeartbeatSession) {
        patch.lastEventAt = timestamp;
        patch.updatedAt = timestamp;
      } else if (Object.keys(patch).length > 0) {
        patch.updatedAt = timestamp;
      }
      await ctx.db.patch(session._id, patch);
    }

    const message = progressMessage(args);
    if (message) {
      await appendProgressLog(ctx, session.policyId, {
        timestamp,
        message,
        phase: args.phase ?? args.task ?? args.kind,
        level: args.error ? "error" : undefined,
      });
    }
    return true;
  },
});

export const completeSession = internalMutation({
  args: {
    traceId: v.optional(v.string()),
    status: traceStatusValidator,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.traceId) return false;
    if (args.status === "running") return false;
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId!))
      .first();
    if (!session) return false;
    return await completeSessionDoc(ctx, session, args.status, args.error);
  },
});

export const getSessionCounters = internalQuery({
  args: {
    traceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.traceId) return null;
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId!))
      .first();
    if (!session) return null;
    return {
      modelCallCount: session.modelCallCount ?? 0,
      modelDurationMs: session.modelDurationMs ?? 0,
      inputTokens: session.inputTokens ?? 0,
      outputTokens: session.outputTokens ?? 0,
    };
  },
});

export const getLatestRouterRequestForTaskKind = internalQuery({
  args: {
    traceId: v.string(),
    taskKind: v.string(),
    beforeTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("policyExtractionTraceEvents")
      .withIndex("trace_time", (q) => q
        .eq("traceId", args.traceId)
        .lte("timestamp", args.beforeTimestamp))
      .order("desc")
      .take(500);
    return latestCompletedRouterRequest(events, args.taskKind, args.beforeTimestamp);
  },
});

export const reconcileTerminalPolicy = internalMutation({
  args: {
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const [policy, run] = await Promise.all([
      ctx.db.get(args.policyId),
      ctx.db
        .query("policyExtractionRuns")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .first(),
    ]);
    const pipelineStatus = run?.pipelineStatus ?? policy?.pipelineStatus;
    if (pipelineStatus !== "complete" && pipelineStatus !== "error") {
      return { terminal: false, closed: [] as string[] };
    }
    const error = run?.pipelineError ?? policy?.pipelineError;
    const status = traceStatusFromPipeline(pipelineStatus, error);
    const sessions = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("policy_started", (q) => q.eq("policyId", args.policyId))
      .collect();
    const closed: string[] = [];
    for (const session of sessions) {
      if (session.status !== "running") continue;
      const ok = await completeSessionDoc(
        ctx,
        session,
        status,
        error,
        "Extraction trace reconciled from terminal pipeline status",
      );
      if (ok) closed.push(session.traceId);
    }
    return { terminal: true, status, closed };
  },
});

export const reconcileTerminalRunningSessions = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 100), 500));
    const sessions = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("status_started", (q) => q.eq("status", "running"))
      .order("asc")
      .take(batchSize);
    const closed: string[] = [];
    const closedPolicyIds: string[] = [];
    const skipped: string[] = [];
    for (const session of sessions) {
      const [policy, run] = await Promise.all([
        ctx.db.get(session.policyId),
        ctx.db
          .query("policyExtractionRuns")
          .withIndex("policy", (q) => q.eq("policyId", session.policyId))
          .first(),
      ]);
      const pipelineStatus = run?.pipelineStatus ?? policy?.pipelineStatus;
      if (pipelineStatus !== "complete" && pipelineStatus !== "error") {
        skipped.push(session.traceId);
        continue;
      }
      const error = run?.pipelineError ?? policy?.pipelineError;
      const status = traceStatusFromPipeline(pipelineStatus, error);
      const ok = await completeSessionDoc(
        ctx,
        session,
        status,
        error,
        "Extraction trace reconciled from terminal pipeline status",
      );
      if (ok) {
        closed.push(session.traceId);
        closedPolicyIds.push(session.policyId);
      }
    }
    return {
      scanned: sessions.length,
      closed,
      closedPolicyIds: Array.from(new Set(closedPolicyIds)),
      skipped,
    };
  },
});

export const sweepExpired = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(Math.floor(args.batchSize ?? 200), 1000));
    const cutoff = nowMs();
    const sessions = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("expiration", (q) => q.lt("expiresAt", cutoff))
      .take(batchSize);
    const events = await ctx.db
      .query("policyExtractionTraceEvents")
      .withIndex("expiration", (q) => q.lt("expiresAt", cutoff))
      .take(batchSize * 5);
    for (const event of events) await ctx.db.delete(event._id);
    for (const session of sessions) await ctx.db.delete(session._id);
    return { sessions: sessions.length, events: events.length };
  },
});
