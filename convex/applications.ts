import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("applications", {
      userId: args.userId,
      pdfStorageId: args.pdfStorageId,
      status: "extracting",
      currentBatchIndex: 0,
      createdAt: Date.now(),
    });
  },
});

export const getById = internalQuery({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.applicationId);
  },
});

export const getActiveByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const apps = await ctx.db
      .query("applications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    // Return the most recent non-terminal application
    return apps.find((a) =>
      ["extracting", "answering", "confirming", "filling"].includes(a.status)
    ) ?? null;
  },
});

export const getByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("applications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const updateFields = internalMutation({
  args: {
    applicationId: v.id("applications"),
    fields: v.any(),
    answers: v.optional(v.any()),
    title: v.optional(v.string()),
    carrier: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { applicationId, ...patch } = args;
    const cleanPatch: Record<string, any> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) cleanPatch[k] = val;
    }
    await ctx.db.patch(applicationId, cleanPatch);
  },
});

export const updateAnswers = internalMutation({
  args: {
    applicationId: v.id("applications"),
    answers: v.optional(v.any()),
    fields: v.optional(v.any()),
    currentBatchIndex: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, any> = { updatedAt: Date.now() };
    if (args.answers !== undefined) patch.answers = args.answers;
    if (args.fields !== undefined) patch.fields = args.fields;
    if (args.currentBatchIndex !== undefined) patch.currentBatchIndex = args.currentBatchIndex;
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(args.applicationId, patch);
  },
});

export const updateStatus = internalMutation({
  args: {
    applicationId: v.id("applications"),
    status: v.string(),
    filledPdfStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, any> = { status: args.status };
    if (args.filledPdfStorageId) patch.filledPdfStorageId = args.filledPdfStorageId;
    await ctx.db.patch(args.applicationId, patch);
  },
});

/** Save SDK ApplicationState to the applications table. */
export const saveState = internalMutation({
  args: {
    applicationId: v.id("applications"),
    fields: v.optional(v.any()),
    batches: v.optional(v.any()),
    currentBatchIndex: v.optional(v.number()),
    title: v.optional(v.string()),
    applicationType: v.optional(v.string()),
    reviewReport: v.optional(v.any()),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const { applicationId, ...patch } = args;
    const cleanPatch: Record<string, any> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) cleanPatch[k] = val;
    }
    await ctx.db.patch(applicationId, cleanPatch);
  },
});
