"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

const internalApi = internal as any;
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

export const submit = action({
  args: {
    targetKind: targetKindValidator,
    targetId: v.string(),
    rating: ratingValidator,
    category: v.optional(categoryValidator),
    fieldPath: v.optional(v.string()),
    expectedValue: v.optional(v.string()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Authentication required");
    const target = await ctx.runQuery(
      internalApi.extractionReviews.resolveTargetInternal,
      {
        operatorUserId,
        targetKind: args.targetKind,
        targetId: args.targetId,
      },
    );
    const review = await ctx.runMutation(
      internalApi.extractionReviews.recordInternal,
      {
        operatorUserId,
        targetKind: args.targetKind,
        targetId: target.targetId,
        orgId: target.orgId,
        policyId: target.policyId,
        rating: args.rating,
        category: args.category,
        fieldPath: args.fieldPath,
        expectedValue: args.expectedValue,
        comment: args.comment,
      },
    );

    return { recorded: true, rating: review.rating };
  },
});
