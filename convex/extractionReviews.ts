import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireOperator, requireOperatorForUser } from "./lib/operatorIdentity";

const targetKindValidator = v.union(
  v.literal("policy_extraction"),
  v.literal("requirement_extraction"),
);
const ratingValidator = v.union(v.literal("positive"), v.literal("negative"));
const categoryValidator = v.union(
  v.literal("incorrect"),
  v.literal("missing"),
  v.literal("ungrounded"),
  v.literal("unsafe"),
  v.literal("other"),
);

function targetKey(targetKind: string, targetId: string) {
  return `${targetKind}:${targetId.trim()}`;
}

function bounded(value: string | undefined, maxLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export const getForTarget = query({
  args: {
    targetKind: targetKindValidator,
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await ctx.db
      .query("extractionReviews")
      .withIndex("target_operator", (query) =>
        query
          .eq("targetKey", targetKey(args.targetKind, args.targetId))
          .eq("operatorUserId", operator.userId),
      )
      .unique();
  },
});

export const resolveTargetInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    targetKind: targetKindValidator,
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const normalizedTargetId = args.targetId.trim();
    if (!normalizedTargetId) throw new Error("Extraction review target is required");

    if (args.targetKind === "requirement_extraction") {
      const run = await ctx.db
        .query("requirementExtractionRuns")
        .withIndex("run", (query) => query.eq("runId", normalizedTargetId))
        .unique();
      if (!run) throw new Error("Requirement extraction run not found");
      return { targetId: normalizedTargetId, orgId: run.orgId };
    }

    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (query) => query.eq("traceId", normalizedTargetId))
      .unique();
    if (!session) throw new Error("Policy extraction trace not found");

    return {
      targetId: normalizedTargetId,
      orgId: session.orgId,
      policyId: session.policyId,
    };
  },
});

export const recordInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    targetKind: targetKindValidator,
    targetId: v.string(),
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    rating: ratingValidator,
    category: v.optional(categoryValidator),
    fieldPath: v.optional(v.string()),
    expectedValue: v.optional(v.string()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = targetKey(args.targetKind, args.targetId);
    const existing = await ctx.db
      .query("extractionReviews")
      .withIndex("target_operator", (query) =>
        query.eq("targetKey", key).eq("operatorUserId", args.operatorUserId),
      )
      .unique();
    if (existing) {
      return { id: existing._id, rating: existing.rating };
    }

    const timestamp = dayjs().valueOf();
    const id = await ctx.db.insert("extractionReviews", {
      targetKind: args.targetKind,
      targetId: args.targetId,
      targetKey: key,
      orgId: args.orgId,
      operatorUserId: args.operatorUserId,
      policyId: args.policyId,
      rating: args.rating,
      category: args.rating === "negative" ? args.category : undefined,
      fieldPath:
        args.rating === "negative" ? bounded(args.fieldPath, 500) : undefined,
      expectedValue:
        args.rating === "negative"
          ? bounded(args.expectedValue, 4_000)
          : undefined,
      comment:
        args.rating === "negative" ? bounded(args.comment, 4_000) : undefined,
      routerSignalStatus: "not_applicable",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { id, rating: args.rating };
  },
});
