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
