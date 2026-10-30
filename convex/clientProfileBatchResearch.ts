import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { queueClientProfileBatchResearch } from "./lib/clientProfileBatchResearch";
import { requireOperator } from "./lib/operatorIdentity";

/** Operator UI: queue public profile research for 1–50 selected clients. */
export const start = mutation({
  args: { orgIds: v.array(v.id("organizations")) },
  handler: async (ctx, { orgIds }) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    return await queueClientProfileBatchResearch(ctx, orgIds);
  },
});
