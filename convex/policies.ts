import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getById = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.policyId);
  },
});

export const getByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("policies")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    category: v.string(),
    documentType: v.union(v.literal("policy"), v.literal("quote")),
    pdfStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("policies", {
      userId: args.userId,
      category: args.category,
      documentType: args.documentType,
      pdfStorageId: args.pdfStorageId,
      status: "processing",
      createdAt: Date.now(),
    });
  },
});

export const updateExtracted = internalMutation({
  args: {
    policyId: v.id("policies"),
    carrier: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    premium: v.optional(v.string()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    coverages: v.optional(v.any()),
    rawExtracted: v.optional(v.any()),
    category: v.optional(v.string()),
    policyTypes: v.optional(v.array(v.string())),
    extractionReport: v.optional(v.any()),
    extractionUsage: v.optional(v.any()),
    status: v.union(
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    const { policyId, ...fields } = args;
    await ctx.db.patch(policyId, fields);
  },
});

export const updateAnalysis = internalMutation({
  args: {
    policyId: v.id("policies"),
    analysis: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.policyId, { analysis: args.analysis });
  },
});

export const updateInsuranceSlip = internalMutation({
  args: {
    policyId: v.id("policies"),
    insuranceSlipStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.policyId, {
      insuranceSlipStorageId: args.insuranceSlipStorageId,
    });
  },
});

export const updatePdfStorageId = internalMutation({
  args: {
    policyId: v.id("policies"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.policyId, { pdfStorageId: args.pdfStorageId });
  },
});

export const remove = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.policyId);
  },
});

/** Find existing policies that could match a new upload (for merge detection). */
export const findMatchingPolicy = internalQuery({
  args: {
    userId: v.id("users"),
    carrier: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Find ready policies that match on carrier+policyNumber or carrier+category
    return policies.find((p) => {
      if (p.status !== "ready") return false;

      // Strong match: same policy number
      if (args.policyNumber && p.policyNumber &&
          p.policyNumber.toLowerCase() === args.policyNumber.toLowerCase()) {
        return true;
      }

      // Medium match: same carrier + same category (likely the same policy)
      if (args.carrier && p.carrier &&
          p.carrier.toLowerCase() === args.carrier.toLowerCase() &&
          p.category === args.category) {
        return true;
      }

      return false;
    }) ?? null;
  },
});

/** Get the most recent ready auto or homeowners policy for a user. */
export const getLatestAutoOrHome = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    return policies.find(
      (p) =>
        p.status === "ready" &&
        (p.category === "auto" || p.category === "homeowners") &&
        !p.insuranceSlipStorageId
    ) ?? null;
  },
});
