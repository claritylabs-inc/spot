import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function generateToken(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export const get = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const getByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

// Public — used by upload page to verify token
export const getByUploadToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_upload_token", (q) => q.eq("uploadToken", args.token))
      .first();
    if (!user) return null;
    // Only expose what the upload page needs
    return {
      _id: user._id,
      phone: user.phone.slice(0, 2) + "••••••" + user.phone.slice(-4),
      preferredCategory: user.preferredCategory,
    };
  },
});

export const create = internalMutation({
  args: { phone: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      phone: args.phone,
      name: args.name,
      state: "awaiting_category",
      uploadToken: generateToken(),
      lastActiveAt: now,
      createdAt: now,
    });
  },
});

export const updateLastActive = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { lastActiveAt: Date.now() });
  },
});

export const updateState = internalMutation({
  args: {
    userId: v.id("users"),
    state: v.string(),
    preferredCategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = { state: args.state };
    if (args.preferredCategory !== undefined) {
      patch.preferredCategory = args.preferredCategory;
    }
    await ctx.db.patch(args.userId, patch);
  },
});

export const updateEmail = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { email: args.email });
  },
});

export const updateLastImageId = internalMutation({
  args: {
    userId: v.id("users"),
    lastImageId: v.id("_storage"),
    lastImageMimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      lastImageId: args.lastImageId,
      ...(args.lastImageMimeType ? { lastImageMimeType: args.lastImageMimeType } : {}),
    });
  },
});

export const setAutoSendEmails = internalMutation({
  args: {
    userId: v.id("users"),
    autoSendEmails: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { autoSendEmails: args.autoSendEmails });
  },
});

export const setPendingMerge = internalMutation({
  args: {
    userId: v.id("users"),
    pendingMergePolicyId: v.id("policies"),
    pendingMergeStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      pendingMergePolicyId: args.pendingMergePolicyId,
      pendingMergeStorageId: args.pendingMergeStorageId,
    });
  },
});

export const setActiveApplication = internalMutation({
  args: {
    userId: v.id("users"),
    activeApplicationId: v.optional(v.id("applications")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      activeApplicationId: args.activeApplicationId,
    });
  },
});

export const setAutoFillApplications = internalMutation({
  args: {
    userId: v.id("users"),
    autoFillApplications: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      autoFillApplications: args.autoFillApplications,
    });
  },
});

export const updatePortfolioAnalysis = internalMutation({
  args: {
    userId: v.id("users"),
    portfolioAnalysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { portfolioAnalysis: args.portfolioAnalysis });
  },
});

export const clearPendingMerge = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      pendingMergePolicyId: undefined,
      pendingMergeStorageId: undefined,
    });
  },
});

// Public — upload page calls this to get a storage upload URL
export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Public — after upload, trigger processing
export const submitPolicy = mutation({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_upload_token", (q) => q.eq("uploadToken", args.token))
      .first();
    if (!user) throw new Error("Invalid upload link");

    // Schedule processing
    await ctx.scheduler.runAfter(0, internal.upload.processUploadedPolicy, {
      userId: user._id,
      storageId: args.storageId,
      phone: user.phone,
    });

    return { success: true };
  },
});
