import { readBoundedRequestBody } from "./lib/httpBody";
import {
  ROUTER_JOB_EXEC_REQUEST_BYTES,
  ROUTER_JOB_INLINE_REQUEST_BYTES,
} from "./lib/routerJobLimits";
import { startModelCall, finishModelCall } from "./modelRoutingEvents";
import { callContextValidator, callResultValidator, modelCallResult } from "./lib/modelCallTelemetry";
import dayjs from "dayjs";
import { parseRouterJobError, routerJobFailureValidator } from "./lib/routerJobFailure";
import {
  applyMessageActivity,
  messageActivityUpdateValidator,
  messageActivityStageValidator,
  parseRouterActivityStages,
  parseRequestedToolCalls,
  requestedToolCallValidator,
} from "./lib/messageActivity";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { sanitizeOperatorReply } from "./lib/operatorToolOutput";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

export const ROUTER_JOB_REQUEST_BYTES = 4 * 1024 * 1024;
export const ROUTER_JOB_RESULT_BYTES = 18 * 1024 * 1024;
// Succeeded results up to this many serialized bytes stay on the job row and
// skip storage. Well under the 1 MiB document limit, and small enough that
// pages of router job rows (up to 100 per page) stay within read limits.
export const ROUTER_JOB_INLINE_RESULT_BYTES = 64 * 1024;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const operation = v.union(
  v.literal("generate"),
  v.literal("manual"),
  v.literal("embed"),
  v.literal("retrieve"),
  v.literal("transcribe"),
  v.literal("browse"),
  v.literal("exec"),
);

export async function routerJobTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const get = internalQuery({
  args: { invocationKey: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("routerJobs")
      .withIndex("invocation", (q) => q.eq("invocationKey", args.invocationKey))
      .unique(),
});

/** Both rows a generation call may reconnect to, in one round trip. */
export const getWithRouted = internalQuery({
  args: { invocationKey: v.string(), routedKey: v.string() },
  handler: async (ctx, args) => {
    const lookup = (invocationKey: string) =>
      ctx.db
        .query("routerJobs")
        .withIndex("invocation", (q) => q.eq("invocationKey", invocationKey))
        .unique();
    return {
      row: await lookup(args.invocationKey),
      routed: await lookup(args.routedKey),
    };
  },
});

/** A job's request bytes when `prepare` kept them beside the row. */
export const getInlineRequest = internalQuery({
  args: { id: v.id("routerJobs") },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("routerJobRequests")
        .withIndex("by_jobId", (q) => q.eq("jobId", args.id))
        .unique()
    )?.body ?? null,
});

export const prepare = internalMutation({
  args: {
    callContext: v.optional(callContextValidator),
    streamTarget: v.optional(
      v.union(v.id("threadMessages"), v.id("operatorAgentMessages")),
    ),
    invocationKey: v.string(),
    operation,
    fingerprint: v.string(),
    requestToken: v.string(),
    requestTokenHash: v.string(),
    resultToken: v.string(),
    resultTokenHash: v.string(),
    // Exactly one: the stored request blob, or the bytes themselves when
    // within ROUTER_JOB_INLINE_REQUEST_BYTES.
    requestStorageId: v.optional(v.id("_storage")),
    request: v.optional(v.string()),
    assetStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("routerJobs")
      .withIndex("invocation", (q) => q.eq("invocationKey", args.invocationKey))
      .unique();
    if (existing) {
      if (
        existing.operation !== args.operation ||
        existing.fingerprint !== args.fingerprint
      )
        throw new Error("Router invocation identity conflict");
      return existing;
    }
    if (
      !args.invocationKey ||
      args.invocationKey.length > 1000 ||
      !/^[a-f0-9]{64}$/.test(args.fingerprint)
    )
      throw new Error("Invalid router invocation identity");
    const operatorOwner = /^operator:([^:]+):/.exec(args.invocationKey);
    if (operatorOwner) {
      const runId = ctx.db.normalizeId("operatorAgentRuns", operatorOwner[1]);
      const run = runId ? await ctx.db.get(runId) : null;
      if (!run || run.status !== "running" || run.cancellationRequestedAt)
        throw new Error("Operator router invocation is no longer active");
    }
    const requestBytes =
      args.request !== undefined && !args.requestStorageId
        ? new TextEncoder().encode(args.request).byteLength
        : args.request === undefined && args.requestStorageId
          ? (await ctx.db.system.get(args.requestStorageId))?.size
          : undefined;
    if (
      requestBytes === undefined ||
      requestBytes >
        (args.request !== undefined
          ? ROUTER_JOB_INLINE_REQUEST_BYTES
          : args.operation === "exec"
            ? ROUTER_JOB_EXEC_REQUEST_BYTES
            : ROUTER_JOB_REQUEST_BYTES) ||
      (args.assetStorageIds?.length ?? 0) > 8
    )
      throw new Error("Invalid router request storage");
    let assetBytes = 0;
    for (const assetId of args.assetStorageIds ?? []) {
      const metadata = await ctx.db.system.get(assetId);
      if (!metadata || metadata.size > 12 * 1024 * 1024)
        throw new Error("Invalid router asset storage");
      assetBytes += metadata.size;
    }
    if (assetBytes > 16 * 1024 * 1024)
      throw new Error("Router assets exceed aggregate limit");
    const now = dayjs().valueOf();
    const { callContext, request, ...jobArgs } = args;
    const id = await ctx.db.insert("routerJobs", {
      ...jobArgs,
      status: "prepared",
      createdAt: now,
      updatedAt: now,
    });
    if (request !== undefined)
      await ctx.db.insert("routerJobRequests", { jobId: id, body: request });
    if (callContext) await startModelCall(ctx, { callKey: args.invocationKey, operation: args.operation, context: callContext });
    return (await ctx.db.get(id))!;
  },
});

export const cleanupUploads = internalMutation({
  args: { invocationKey: v.string(), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("routerJobs")
      .withIndex("invocation", (q) => q.eq("invocationKey", args.invocationKey))
      .unique();
    const owned = new Set([
      row?.requestStorageId,
      row?.resultStorageId,
      ...(row?.assetStorageIds ?? []),
    ]);
    for (const storageId of args.storageIds) {
      if (!owned.has(storageId)) await ctx.storage.delete(storageId);
    }
  },
});

export const scheduleUploadCleanup = internalMutation({
  args: { invocationKey: v.string(), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      5 * 60 * 1000,
      internal.routerJobs.cleanupUploads,
      args,
    );
  },
});

export const bind = internalMutation({
  args: { id: v.id("routerJobs"), jobId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || !args.jobId || args.jobId.length > 300)
      throw new Error("Invalid router job binding");
    if (row.routerJobId && row.routerJobId !== args.jobId)
      throw new Error("Router job identity conflict");
    await ctx.db.patch(row._id, {
      routerJobId: args.jobId,
      ...(row.status === "prepared" ? { status: "running" as const } : {}),
      updatedAt: dayjs().valueOf(),
    });
    // The bound row, including a result whose callback beat the ack.
    return (await ctx.db.get(row._id))!;
  },
});

export const authorize = internalQuery({
  args: {
    tokenHash: v.string(),
    purpose: v.union(v.literal("request"), v.literal("result")),
  },
  handler: async (ctx, args) => {
    const row =
      args.purpose === "request"
        ? await ctx.db
            .query("routerJobs")
            .withIndex("request_token", (q) =>
              q.eq("requestTokenHash", args.tokenHash),
            )
            .unique()
        : await ctx.db
            .query("routerJobs")
            .withIndex("result_token", (q) =>
              q.eq("resultTokenHash", args.tokenHash),
            )
            .unique();
    if (!row || row.status === "cancelled") return null;
    if (
      args.purpose === "request" &&
      row.status !== "prepared" &&
      row.status !== "running"
    )
      return null;
    return row;
  },
});

export const finish = internalMutation({
  args: {
    callResult: v.optional(callResultValidator),
    id: v.id("routerJobs"),
    tokenHash: v.string(),
    jobId: v.string(),
    invocationKey: v.string(),
    fingerprint: v.string(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    /** Serialized result kept on the row instead of `storageId`. */
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    failure: v.optional(routerJobFailureValidator),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    const valid =
      row &&
      row.resultTokenHash === args.tokenHash &&
      row.invocationKey === args.invocationKey &&
      row.fingerprint === args.fingerprint &&
      (!row.routerJobId || row.routerJobId === args.jobId);
    if (
      !valid ||
      row.status === "cancelled" ||
      row.status === "succeeded" ||
      row.status === "failed"
    ) {
      if (args.storageId && row?.resultStorageId !== args.storageId)
        await ctx.storage.delete(args.storageId);
      return Boolean(
        valid && row.status === args.status && row.routerJobId === args.jobId,
      );
    }
    if (args.status === "succeeded" && args.result !== undefined) {
      if (
        args.storageId ||
        new TextEncoder().encode(args.result).byteLength >
          ROUTER_JOB_INLINE_RESULT_BYTES
      )
        throw new Error("Invalid inline router result");
    } else if (args.status === "succeeded") {
      const metadata = args.storageId
        ? await ctx.db.system.get(args.storageId)
        : null;
      if (!metadata || metadata.size > ROUTER_JOB_RESULT_BYTES)
        throw new Error("Invalid router result storage");
    }
    const now = dayjs().valueOf();
    await ctx.db.patch(row._id, {
      status: args.status,
      routerJobId: args.jobId,
      resultStorageId: args.storageId,
      ...(args.status === "succeeded" && args.result !== undefined
        ? { resultJson: args.result }
        : {}),
      error: args.error?.slice(0, 1000),
      failure: args.failure,
      terminalAt: now,
      updatedAt: now,
    });
    await finishModelCall(ctx, row.invocationKey, args.status === "succeeded" ? "complete" : args.error?.includes("outcome is unknown") ? "unknown" : "error", args.callResult, args.error);
    await ctx.scheduler.runAfter(
      TERMINAL_RETENTION_MS,
      internal.routerJobs.cleanup,
      { id: row._id },
    );
    await wakeOperatorRun(ctx, row.invocationKey);
    return true;
  },
});

// Operator steps poll their router job; waking the queued run as soon as the
// job ends avoids waiting out the fallback poll. A duplicate or stale wake is
// harmless: markRunStartedInternal only starts a queued run.
async function wakeOperatorRun(ctx: MutationCtx, invocationKey: string) {
  const owner = /^operator:([^:]+):(plan|\d+)/.exec(invocationKey);
  const runId = owner && ctx.db.normalizeId("operatorAgentRuns", owner[1]);
  const run = runId ? await ctx.db.get(runId) : null;
  if (
    !owner ||
    !run ||
    run.status !== "queued" ||
    run.cancellationRequestedAt ||
    (owner[2] !== "plan" &&
      (run.checkpoint?.iteration ?? 0) !== Number(owner[2]))
  )
    return;
  await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
    runId: run._id,
  });
}

export async function cancelRouterJobForInvocation(
  ctx: MutationCtx,
  invocationKey: string,
): Promise<void> {
  const row = await ctx.db
    .query("routerJobs")
    .withIndex("invocation", (q) => q.eq("invocationKey", invocationKey))
    .unique();
  if (!row || row.terminalAt !== undefined) return;
  const now = dayjs().valueOf();
  await ctx.db.patch(row._id, {
    status: "cancelled",
    terminalAt: now,
    updatedAt: now,
  });
  await finishModelCall(ctx, row.invocationKey, "cancelled");
  await ctx.scheduler.runAfter(
    TERMINAL_RETENTION_MS,
    internal.routerJobs.cleanup,
    { id: row._id },
  );
}

export const cancel = internalMutation({
  args: { id: v.id("routerJobs") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row) await cancelRouterJobForInvocation(ctx, row.invocationKey);
  },
});

export const cleanup = internalMutation({
  args: { id: v.id("routerJobs") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (
      !row ||
      row.terminalAt === undefined ||
      row.terminalAt + TERMINAL_RETENTION_MS > dayjs().valueOf()
    )
      return;
    if (row.requestStorageId) await ctx.storage.delete(row.requestStorageId);
    const inlineRequest = await ctx.db
      .query("routerJobRequests")
      .withIndex("by_jobId", (q) => q.eq("jobId", row._id))
      .unique();
    if (inlineRequest) await ctx.db.delete(inlineRequest._id);
    if (row.resultStorageId) await ctx.storage.delete(row.resultStorageId);
    for (const assetId of row.assetStorageIds ?? [])
      await ctx.storage.delete(assetId);
    // The tombstone prevents old invocation keys from executing again after blob retention.
    await ctx.db.patch(row._id, {
      requestStorageId: undefined,
      resultStorageId: undefined,
      resultJson: undefined,
      assetStorageIds: undefined,
      requestToken: "",
      requestTokenHash: "",
      resultToken: "",
      resultTokenHash: "",
      error: undefined,
    });
  },
});

async function capabilityToken(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return token && /^[a-f0-9]{64}$/.test(token)
    ? routerJobTokenHash(token)
    : null;
}

export const requestHttp = httpAction(async (ctx, request) => {
  const tokenHash = await capabilityToken(request);
  const row = tokenHash
    ? await ctx.runQuery(internal.routerJobs.authorize, {
        tokenHash,
        purpose: "request",
      })
    : null;
  if (!row) return new Response(null, { status: 404 });
  const body = row.requestStorageId
    ? await ctx.storage.get(row.requestStorageId)
    : await ctx.runQuery(internal.routerJobs.getInlineRequest, { id: row._id });
  return body !== null
    ? new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      })
    : new Response(null, { status: 404 });
});

export const assetHttp = httpAction(async (ctx, request) => {
  const tokenHash = await capabilityToken(request);
  const row = tokenHash
    ? await ctx.runQuery(internal.routerJobs.authorize, {
        tokenHash,
        purpose: "request",
      })
    : null;
  const indexText = new URL(request.url).searchParams.get("index");
  const index = indexText && /^\d+$/.test(indexText) ? Number(indexText) : -1;
  const storageId =
    Number.isSafeInteger(index) && index >= 0
      ? row?.assetStorageIds?.[index]
      : undefined;
  if (!storageId) return new Response(null, { status: 404 });
  const blob = await ctx.storage.get(storageId);
  return blob
    ? new Response(blob, {
        headers: {
          "content-type": blob.type || "application/octet-stream",
          "content-length": String(blob.size),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      })
    : new Response(null, { status: 404 });
});


export const recordToolActivity = internalMutation({
  args: {
    target: v.union(v.id("threadMessages"), v.id("operatorAgentMessages")),
    tools: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.target);
    if (
      !message ||
      message.status !== "processing" ||
      message.channel !== "chat"
    )
      return;
    const usedTools = [
      ...new Set([...(message.usedTools ?? []), ...args.tools]),
    ];
    await ctx.db.patch(args.target, { usedTools });
  },
});

/**
 * Records live tool activity before the work finishes. Operator writes must
 * match the active run attempt and checkpoint so a stale attempt cannot
 * overwrite a newer one; client writes require a processing chat message.
 */
export const recordActivity = internalMutation({
  args: {
    target: v.union(v.id("threadMessages"), v.id("operatorAgentMessages")),
    update: messageActivityUpdateValidator,
    operatorRun: v.optional(
      v.object({
        runId: v.id("operatorAgentRuns"),
        expectedRunnerAttempt: v.number(),
        expectedCheckpointIteration: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.target);
    if (
      !message ||
      message.status !== "processing" ||
      message.channel !== "chat"
    )
      return;
    if (args.operatorRun) {
      const run = await ctx.db.get(args.operatorRun.runId);
      if (
        !run ||
        run.status !== "running" ||
        run.cancellationRequestedAt ||
        run.agentMessageId !== message._id ||
        run.runnerAttempt !== args.operatorRun.expectedRunnerAttempt ||
        (run.checkpoint?.iteration ?? 0) !==
          args.operatorRun.expectedCheckpointIteration
      )
        return;
    }
    const update =
      args.update.kind === "requested"
        ? args.update
        : args.update.kind === "tool"
          ? {
              ...args.update,
              toolCallId: args.update.toolCallId.slice(0, 200),
              toolName: args.update.toolName.slice(0, 200),
            }
          : args.update;
    await ctx.db.patch(args.target, {
      activity: applyMessageActivity(message.activity, update, dayjs().valueOf()),
    });
  },
});

export const progress = internalMutation({
  args: {
    id: v.id("routerJobs"),
    tokenHash: v.string(),
    jobId: v.string(),
    invocationKey: v.string(),
    fingerprint: v.string(),
    sequence: v.number(),
    text: v.string(),
    toolCalls: v.optional(v.array(requestedToolCallValidator)),
    stages: v.optional(v.array(messageActivityStageValidator)),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (
      !row ||
      !row.streamTarget ||
      row.resultTokenHash !== args.tokenHash ||
      row.invocationKey !== args.invocationKey ||
      row.fingerprint !== args.fingerprint ||
      (row.routerJobId && row.routerJobId !== args.jobId) ||
      !["prepared", "running"].includes(row.status) ||
      !Number.isSafeInteger(args.sequence) ||
      args.sequence < 1 ||
      new TextEncoder().encode(args.text).byteLength > 256 * 1024 ||
      (args.toolCalls !== undefined &&
        parseRequestedToolCalls(args.toolCalls) === null) ||
      parseRouterActivityStages(args.stages) === null
    )
      return false;
    if (args.sequence <= (row.progressSequence ?? 0)) return true;
    const message = await ctx.db.get(row.streamTarget);
    if (!message || message.status !== "processing") return false;
    const owner = /^operator:([^:]+):(\d+):/.exec(row.invocationKey);
    if (owner) {
      const runId = ctx.db.normalizeId("operatorAgentRuns", owner[1]);
      const run = runId ? await ctx.db.get(runId) : null;
      if (
        !run ||
        !["running", "queued"].includes(run.status) ||
        run.cancellationRequestedAt ||
        run.agentMessageId !== message._id ||
        (run.checkpoint?.iteration ?? 0) !== Number(owner[2])
      )
        return false;
    }
    await ctx.db.patch(row._id, {
      routerJobId: args.jobId,
      progressSequence: args.sequence,
    });
    const now = dayjs().valueOf();
    let activity = message.activity;
    // Each job owns its decision stages, including retries and later model steps.
    for (const stage of args.stages ?? []) {
      activity = applyMessageActivity(
        activity,
        {
          kind: "stage",
          ...stage,
          stageId: `${row._id}:${stage.stageId}`,
        },
        now,
      );
    }
    // Requested means the model asked for the tool, not that it is running.
    if (args.toolCalls?.length) {
      activity = applyMessageActivity(
        activity,
        {
          kind: "requested",
          toolCalls: args.toolCalls,
        },
        now,
      );
    }
    await ctx.db.patch(row.streamTarget, {
      // A tool call written as text must never stream to the operator.
      content: sanitizeOperatorReply(args.text),
      ...(activity ? { activity } : {}),
    });
    return true;
  },
});

export const resultHttp = httpAction(async (ctx, request) => {
  const tokenHash = await capabilityToken(request);
  const row = tokenHash
    ? await ctx.runQuery(internal.routerJobs.authorize, {
        tokenHash,
        purpose: "result",
      })
    : null;
  if (!row || !tokenHash) return new Response(null, { status: 404 });
  let body: Record<string, unknown>;
  try {
    const raw = await readBoundedRequestBody(request, ROUTER_JOB_RESULT_BYTES);
    if (raw === null) return new Response(null, { status: 413 });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return new Response(null, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (body.status === "progress") {
    if (
      typeof body.jobId !== "string" ||
      !body.jobId ||
      body.jobId.length > 300 ||
      typeof body.sequence !== "number" ||
      typeof body.text !== "string" ||
      body.idempotencyKey !== row.invocationKey ||
      body.fingerprint !== row.fingerprint
    )
      return new Response(null, { status: 409 });
    if (new TextEncoder().encode(body.text).byteLength > 256 * 1024)
      return new Response(null, { status: 413 });
    const toolCalls = parseRequestedToolCalls(body.toolCalls);
    const stages = parseRouterActivityStages(body.stages);
    if (toolCalls === null || stages === null)
      return new Response(null, { status: 409 });
    const accepted = await ctx.runMutation(internal.routerJobs.progress, {
      id: row._id,
      tokenHash,
      jobId: body.jobId,
      invocationKey: row.invocationKey,
      fingerprint: row.fingerprint,
      sequence: body.sequence,
      text: body.text,
      ...(toolCalls ? { toolCalls } : {}),
      ...(stages ? { stages } : {}),
    });
    return new Response(null, { status: accepted ? 204 : 409 });
  }
  if (
    typeof body.jobId !== "string" ||
    !body.jobId ||
    body.jobId.length > 300 ||
    body.idempotencyKey !== row.invocationKey ||
    body.fingerprint !== row.fingerprint ||
    (row.routerJobId && row.routerJobId !== body.jobId) ||
    (body.status !== "succeeded" && body.status !== "failed") ||
    (body.status === "succeeded" && body.result === undefined)
  )
    return new Response(null, { status: 409 });
  // Small results ride the finish mutation; larger ones go to storage first.
  // A committed finish adopts or deletes that blob in its own transaction, so
  // no separate cleanup schedule precedes it; a finish that throws removes
  // the blob below.
  const serialized =
    body.status === "succeeded" ? JSON.stringify(body.result) : undefined;
  const inlineResult =
    serialized !== undefined &&
    new TextEncoder().encode(serialized).byteLength <=
      ROUTER_JOB_INLINE_RESULT_BYTES
      ? serialized
      : undefined;
  const storageId =
    serialized !== undefined && inlineResult === undefined
      ? await ctx.storage.store(
          new Blob([serialized], { type: "application/json" }),
        )
      : undefined;
  try {
    const accepted = await ctx.runMutation(internal.routerJobs.finish, {
      id: row._id,
      tokenHash,
      jobId: body.jobId,
      invocationKey: row.invocationKey,
      fingerprint: row.fingerprint,
      status: body.status,
      ...(body.status === "succeeded" ? { callResult: modelCallResult(body.result) } : {}),
      ...(storageId ? { storageId } : {}),
      ...(inlineResult !== undefined ? { result: inlineResult } : {}),
      ...(body.status === "failed" ? parseRouterJobError(body.error) : {}),
    });
    return new Response(null, { status: accepted ? 204 : 409 });
  } catch (error) {
    if (storageId)
      await ctx.runMutation(internal.routerJobs.cleanupUploads, {
        invocationKey: row.invocationKey,
        storageIds: [storageId],
      });
    throw error;
  }
});
