"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/** Full re-extraction of the policy's original file. */
export const retryExtraction = action({
  args: { policyId: v.id("policies") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { policyId }): Promise<{ success: boolean }> => {
    const access = await ctx.runQuery(
      internal.extractionAccess.authorizeReextractInternal,
      { policyId },
    );

    if (access.isOperator) {
      await ctx.runMutation(
        internal.operator.recordPolicyExtractionOperationInternal,
        {
          operatorUserId: access.userId,
          policyId,
          operation: "full_extraction",
        },
      );
    } else {
      await ctx.runMutation(internal.policyAuditLog.append, {
        policyId,
        userId: access.userId,
        orgId: access.orgId,
        action: "re_extraction",
        detail: "Full re-extraction",
      });
    }

    await ctx.runAction(internal.actions.policyExtraction.retryPolicyExtraction, {
      policyId,
      mode: "full",
    });
    return { success: true };
  },
});
