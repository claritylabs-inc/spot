import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  createStandaloneBrokerByOperator,
  updateBrokerProfileByOperator,
} from "./brokerProfiles";
import {
  createProcurementOutreachByOperator,
  requireDirectOperatorWrite,
} from "./procurementRequests";
import {
  matchProvider,
  prepareEnsureProviders,
  prepareUpdateProviders,
} from "./lib/operatorBrokerProfiles";
import type { Id } from "./_generated/dataModel";

export type ProviderBatchResult = {
  results: Array<{
    orgId: Id<"organizations">;
    outcome: "matched" | "created" | "attached" | "updated";
    input?: unknown;
    outreachId?: Id<"procurementBrokerOutreaches">;
  }>;
};

// A child transaction rolls back the entire batch even when the runner catches
// its error to persist a failed tool audit in the parent mutation.
export const execute = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    toolName: v.union(
      v.literal("ensure_broker_network_profiles"),
      v.literal("update_broker_network_profiles"),
    ),
    input: v.any(),
  },
  handler: async (ctx, args): Promise<ProviderBatchResult> => {
    await requireDirectOperatorWrite(ctx, args.operatorUserId);
    if (args.toolName === "update_broker_network_profiles") {
      const items = await prepareUpdateProviders(ctx, args.input);
      const results = [];
      for (const item of items) {
        await updateBrokerProfileByOperator(ctx, {
          ...item.fields,
          operatorUserId: args.operatorUserId,
        });
        results.push({ orgId: item.orgId, outcome: "updated" as const });
      }
      return { results };
    }
    const { items, brokers, requestId } = await prepareEnsureProviders(
      ctx,
      args.input,
    );
    const attached = new Map<
      Id<"organizations">,
      Id<"procurementBrokerOutreaches">
    >();
    const results = [];
    for (const item of items) {
      let broker = matchProvider(brokers, item.fields);
      let outcome: "matched" | "created" | "attached" = "matched";
      if (!broker) {
        const created = await createStandaloneBrokerByOperator(ctx, {
          ...item.fields,
          operatorUserId: args.operatorUserId,
          source: "agent",
        });
        broker = (await ctx.db.get(created.brokerOrgId))!;
        brokers.push(broker);
        outcome = "created";
      }
      let outreachId = attached.get(broker._id);
      if (requestId && !outreachId) {
        const existing = await ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("request_broker", (q) =>
            q.eq("requestId", requestId).eq("brokerOrgId", broker._id),
          )
          .first();
        outreachId = existing?._id;
      }
      if (requestId && !outreachId) {
        const created = await createProcurementOutreachByOperator(ctx, {
          operatorUserId: args.operatorUserId,
          requestId,
          brokerOrgId: broker._id,
          deferSentAt: true,
          source: "agent",
        });
        outreachId = created.outreachId;
        attached.set(broker._id, outreachId);
        if (outcome === "matched") outcome = "attached";
      }
      results.push({
        input: item.input,
        outcome,
        orgId: broker._id,
        ...(outreachId ? { outreachId } : {}),
      });
    }
    return { results };
  },
});
