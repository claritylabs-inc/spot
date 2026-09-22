import { startModelCall, finishModelCall } from "./modelRoutingEvents";
import { callContextValidator, callResultValidator, modelCallResult } from "./lib/modelCallTelemetry";
import dayjs from "dayjs";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

export const ROUTER_JOB_REQUEST_BYTES = 4 * 1024 * 1024;
export const ROUTER_JOB_RESULT_BYTES = 18 * 1024 * 1024;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const operation = v.union(
  v.literal("generate"),
  v.literal("manual"),
  v.literal("embed"),
  v.literal("retrieve"),
  v.literal("transcribe"),
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
    requestStorageId: v.id("_storage"),
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
    const requestMetadata = await ctx.db.system.get(args.requestStorageId);
    if (
      !requestMetadata ||
      requestMetadata.size > ROUTER_JOB_REQUEST_BYTES ||
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
    const { callContext, ...jobArgs } = args;
    const id = await ctx.db.insert("routerJobs", {
      ...jobArgs,
      status: "prepared",
      createdAt: now,
      updatedAt: now,
    });
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
    error: v.optional(v.string()),
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
    if (args.status === "succeeded") {
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
      error: args.error?.slice(0, 1000),
      terminalAt: now,
      updatedAt: now,
    });
    await finishModelCall(ctx, row.invocationKey, args.status === "succeeded" ? "complete" : args.error?.includes("outcome is unknown") ? "unknown" : "error", args.callResult, args.error);
    await ctx.scheduler.runAfter(
      TERMINAL_RETENTION_MS,
      internal.routerJobs.cleanup,
      { id: row._id },
    );
    return true;
  },
});

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
    if (row.resultStorageId) await ctx.storage.delete(row.resultStorageId);
    for (const assetId of row.assetStorageIds ?? [])
      await ctx.storage.delete(assetId);
    // The tombstone prevents old invocation keys from executing again after blob retention.
    await ctx.db.patch(row._id, {
      requestStorageId: undefined,
      resultStorageId: undefined,
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
  if (!row?.requestStorageId) return new Response(null, { status: 404 });
  const blob = await ctx.storage.get(row.requestStorageId);
  return blob
    ? new Response(blob, {
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

async function boundedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > ROUTER_JOB_RESULT_BYTES)
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > ROUTER_JOB_RESULT_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

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

export const progress = internalMutation({
  args: {
    id: v.id("routerJobs"),
    tokenHash: v.string(),
    jobId: v.string(),
    invocationKey: v.string(),
    fingerprint: v.string(),
    sequence: v.number(),
    text: v.string(),
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
      new TextEncoder().encode(args.text).byteLength > 256 * 1024
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
    await ctx.db.patch(row.streamTarget, { content: args.text });
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
    const raw = await boundedBody(request);
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
    const accepted = await ctx.runMutation(internal.routerJobs.progress, {
      id: row._id,
      tokenHash,
      jobId: body.jobId,
      invocationKey: row.invocationKey,
      fingerprint: row.fingerprint,
      sequence: body.sequence,
      text: body.text,
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
  const storageId =
    body.status === "succeeded"
      ? await ctx.storage.store(
          new Blob([JSON.stringify(body.result)], { type: "application/json" }),
        )
      : undefined;
  if (storageId)
    await ctx.runMutation(internal.routerJobs.scheduleUploadCleanup, {
      invocationKey: row.invocationKey,
      storageIds: [storageId],
    });
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
      ...(body.status === "failed"
        ? {
            error:
              typeof body.error === "string"
                ? body.error.slice(0, 1000)
                : "Router job failed",
          }
        : {}),
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
