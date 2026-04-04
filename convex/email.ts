import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Convex Mutations & Queries ──

export const createPendingEmail = internalMutation({
  args: {
    userId: v.id("users"),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    htmlBody: v.string(), // plaintext body stored here (legacy field name)
    ccEmail: v.optional(v.string()),
    purpose: v.string(),
    coiPdfStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pendingEmails", {
      ...args,
      status: "awaiting_confirmation",
      createdAt: Date.now(),
    });
  },
});

export const updatePendingEmailStatus = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    status: v.string(),
    scheduledFunctionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { pendingEmailId, ...fields } = args;
    await ctx.db.patch(pendingEmailId, fields);
  },
});

export const getPendingForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("pendingEmails")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    return pending.find(
      (e) => e.status === "awaiting_confirmation" || e.status === "scheduled"
    ) ?? null;
  },
});

export const scheduleEmailSend = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const scheduledId = await ctx.scheduler.runAfter(
      20_000,
      internal.emailActions.sendEmailNow,
      { pendingEmailId: args.pendingEmailId }
    );
    await ctx.db.patch(args.pendingEmailId, {
      status: "scheduled",
      scheduledFunctionId: scheduledId.toString(),
    });
  },
});

export const cancelPendingEmail = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.pendingEmailId);
    if (!pending) return;

    if (pending.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(pending.scheduledFunctionId as any);
      } catch {
        // Scheduled function may have already executed
      }
    }

    const newStatus = pending.status === "scheduled" ? "undone" : "cancelled";
    await ctx.db.patch(args.pendingEmailId, { status: newStatus });
  },
});

export const getPendingEmailById = internalQuery({
  args: { pendingEmailId: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.pendingEmailId);
  },
});

// ── Email Thread Tracking ──

export const createEmailThread = internalMutation({
  args: {
    userId: v.id("users"),
    pendingEmailId: v.id("pendingEmails"),
    outboundMessageId: v.string(),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    fromAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("emailThreads", {
      ...args,
      status: "active",
      lastActivityAt: now,
      createdAt: now,
    });
  },
});

export const getThreadByFromAddress = internalQuery({
  args: { fromAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailThreads")
      .withIndex("by_from_address", (q) => q.eq("fromAddress", args.fromAddress))
      .first();
  },
});

export const getThreadByOutboundMessageId = internalQuery({
  args: { outboundMessageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailThreads")
      .withIndex("by_outbound_message_id", (q) => q.eq("outboundMessageId", args.outboundMessageId))
      .first();
  },
});

export const updateThreadActivity = internalMutation({
  args: { threadId: v.id("emailThreads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });
  },
});
