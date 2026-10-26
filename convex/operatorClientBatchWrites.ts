import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { setClientAssigneeForOperator } from "./operator";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { setFeatureFlagPatch } from "./lib/featureFlags";
import {
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  prepareClientBatch,
  type ClientBatchResult,
} from "./lib/operatorClientBatch";
import { applyOperatorBatch } from "./lib/operatorBatch";

// The runner catches errors. Keep all item writes and audits in this nested
// transaction so an application failure cannot leave a partially applied batch.
export const applyInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    toolName: v.union(
      v.literal("set_client_assignees"),
      v.literal("set_client_access_statuses"),
      v.literal("set_client_feature_flags"),
    ),
    input: v.any(),
  },
  handler: async (ctx, args): Promise<ClientBatchResult> => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    const prepared = await prepareClientBatch(ctx, args.toolName, args.input);
    return applyOperatorBatch(prepared, async (item) => {
      const { organization, previous, next } = item;
      const result = {
        orgId: organization._id,
        clientName: organization.name,
        previous,
        next,
      };
      if (previous === next) return { ...result, status: "unchanged" as const };
      if (item.kind === "assignee") {
        const assigned = await setClientAssigneeForOperator(ctx, {
          actorUserId: args.operatorUserId,
          clientOrgId: organization._id,
          assigneeUserId: item.next,
          domain: "operator_agent",
        });
        return { ...result, status: assigned.status };
      }
      if (item.kind === "access_status") {
        await ctx.db.patch(organization._id, { clientAccessStatus: item.next });
      } else {
        await ctx.db.patch(organization._id, {
          featureFlags: setFeatureFlagPatch(
            organization.featureFlags,
            item.flagId,
            item.next,
          ),
        });
      }
      await writeOperatorAudit(ctx, {
        operatorUserId: args.operatorUserId,
        type:
          item.kind === "access_status"
            ? "client_status_changed"
            : "setup_write",
        targetOrgId: organization._id,
        summary:
          item.kind === "access_status"
            ? `${organization.name} changed from ${previous} to ${next}`
            : `Updated ${item.flagId} for ${organization.name}`,
        metadata: {
          previous,
          next,
          domain: "operator_agent",
          ...(item.kind === "feature_flag"
            ? { flagId: item.flagId, enabled: item.next }
            : {}),
        },
      });
      return { ...result, status: "updated" as const };
    });
  },
});
