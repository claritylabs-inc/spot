import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const TRACE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const parserBackendValidator = v.union(
  v.literal("liteparse"),
  v.literal("pdfjs"),
  v.literal("mammoth"),
  v.literal("plain_text"),
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

function nowMs() {
  return dayjs().valueOf();
}

async function getRun(ctx: MutationCtx, runId: string) {
  return await ctx.db
    .query("requirementExtractionRuns")
    .withIndex("run", (query) => query.eq("runId", runId))
    .unique();
}

export const start = internalMutation({
  args: {
    runId: v.string(),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    trigger: v.union(v.literal("web_import"), v.literal("mailbox_import")),
    sourceName: v.string(),
    sourceType: v.union(
      v.literal("lease_agreement"),
      v.literal("client_contract"),
      v.literal("vendor_requirements"),
      v.literal("other"),
    ),
    scope: v.union(v.literal("vendors"), v.literal("own_org")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = nowMs();
    const existing = await getRun(ctx, args.runId);
    if (existing) return existing._id;
    return await ctx.db.insert("requirementExtractionRuns", {
      ...args,
      status: "running",
      phase: "reading_source",
      startedAt: timestamp,
      expiresAt: timestamp + TRACE_RETENTION_MS,
      updatedAt: timestamp,
    });
  },
});

export const recordSource = internalMutation({
  args: {
    runId: v.string(),
    parserBackend: v.optional(parserBackendValidator),
    sourceCharacterCount: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runId);
    if (!run || run.status !== "running") return false;
    await ctx.db.patch(run._id, {
      parserBackend: args.parserBackend,
      sourceCharacterCount: args.sourceCharacterCount,
      phase: "extracting_requirements",
      updatedAt: nowMs(),
    });
    return true;
  },
});

export const recordExtraction = internalMutation({
  args: {
    runId: v.string(),
    extractedRequirementCount: v.number(),
    checkableRequirementCount: v.number(),
    extractedHolderCount: v.number(),
    requestId: v.optional(v.string()),
    provider: v.optional(modelProviderValidator),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.union(v.literal("direct"), v.literal("cl-router"))),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runId);
    if (!run || run.status !== "running") return false;
    await ctx.db.patch(run._id, {
      extractedRequirementCount: args.extractedRequirementCount,
      checkableRequirementCount: args.checkableRequirementCount,
      extractedHolderCount: args.extractedHolderCount,
      requestId: args.requestId,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      phase: "persisting",
      updatedAt: nowMs(),
    });
    return true;
  },
});

export const complete = internalMutation({
  args: {
    runId: v.string(),
    sourceDocumentId: v.id("requirementSourceDocuments"),
    createdRequirementCount: v.number(),
    duplicateRequirementCount: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runId);
    if (!run || run.status !== "running") return false;
    const timestamp = nowMs();
    await ctx.db.patch(run._id, {
      sourceDocumentId: args.sourceDocumentId,
      createdRequirementCount: args.createdRequirementCount,
      duplicateRequirementCount: args.duplicateRequirementCount,
      status: "complete",
      phase: "complete",
      completedAt: timestamp,
      totalDurationMs: timestamp - run.startedAt,
      error: undefined,
      updatedAt: timestamp,
    });
    return true;
  },
});

export const fail = internalMutation({
  args: {
    runId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runId);
    if (!run || run.status !== "running") return false;
    const timestamp = nowMs();
    await ctx.db.patch(run._id, {
      status: "error",
      completedAt: timestamp,
      totalDurationMs: timestamp - run.startedAt,
      error: args.error.slice(0, 1_000),
      updatedAt: timestamp,
    });
    return true;
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
      .query("requirementExtractionRuns")
      .withIndex("expiration", (query) => query.lt("expiresAt", nowMs()))
      .take(limit);
    for (const run of expired) await ctx.db.delete(run._id);
    return { deleted: expired.length };
  },
});
