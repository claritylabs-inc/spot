import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { assertCanManageUploadedPolicy, getOrgAccess } from "./lib/access";
import { getActiveOperatorImpersonation } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";
import { readPolicyPipelineState } from "./policies";

/**
 * Re-extraction follows policies.cancelExtraction's access rules, is read-only
 * during operator impersonation, and never overlaps a live run.
 */
export const authorizeReextractInternal = internalQuery({
  args: { policyId: v.id("policies") },
  handler: async (ctx, { policyId }) => {
    const policy = await ctx.db.get(policyId);
    if (!policy?.orgId) throw new Error("Policy not found");
    if (await getActiveOperatorImpersonation(ctx)) {
      throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
    }
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanManageUploadedPolicy(access, policy);
    const state = await readPolicyPipelineState(ctx, policyId);
    if (
      state?.pipelineStatus === "running" ||
      state?.pipelineStatus === "paused"
    ) {
      throw new Error("An extraction is already running for this policy.");
    }
    return {
      userId: access.userId,
      orgId: policy.orgId,
      isOperator: access.accessType === "operator",
    };
  },
});
