import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const log = internalMutation({
  args: {
    userId: v.id("users"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    hasAttachment: v.boolean(),
    openPhoneId: v.optional(v.string()),
    channel: v.optional(v.string()), // "openphone" | "linq" | "email"
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const getByOpenPhoneId = internalQuery({
  args: { openPhoneId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_openphone_id", (q) => q.eq("openPhoneId", args.openPhoneId))
      .first();
  },
});

// Atomic dedup: check + insert in one mutation to prevent race conditions
export const claimMessage = internalMutation({
  args: {
    openPhoneId: v.string(),
    userId: v.id("users"),
    body: v.string(),
    hasAttachment: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_openphone_id", (q) => q.eq("openPhoneId", args.openPhoneId))
      .first();
    if (existing) return { claimed: false };

    await ctx.db.insert("messages", {
      userId: args.userId,
      direction: "inbound",
      body: args.body,
      hasAttachment: args.hasAttachment,
      openPhoneId: args.openPhoneId,
      timestamp: Date.now(),
    });
    return { claimed: true };
  },
});

export const getByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// Get recent messages for conversation context (last N messages, newest first)
export const getRecentByUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit || 20);
    return messages.reverse(); // return in chronological order
  },
});
