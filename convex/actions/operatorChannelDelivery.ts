"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  operatorChannelDeliveryValidator,
  type OperatorChannelRunResult,
} from "../lib/operatorAgentChannel";
import {
  sendOperatorSlackResponse,
  updateOperatorSlackActivity,
} from "./handleInboundSlack";

export const deliver = internalAction({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
    delivery: operatorChannelDeliveryValidator,
    deliveryAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { delivery } = args;
    let result: OperatorChannelRunResult = await ctx.runQuery(
      internal.operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId: args.operatorUserId, runId: args.runId },
    );
    if (result.run.status === "queued" || result.run.status === "running") {
      await ctx.scheduler.runAfter(
        1_000,
        internal.actions.operatorChannelDelivery.deliver,
        args,
      );
      return;
    }
    if (result.run.status === "failed" || result.run.status === "cancelled") {
      result = {
        run: result.run,
        response: {
          messageId: result.run.agentMessageId,
          content:
            result.run.lastError ?? `Operator task ${result.run.status}.`,
        },
      };
    }

    try {
      const confirmation =
        result.run.status === "waiting_confirmation"
          ? await ctx.runQuery(
              internal.operatorAgent.getPendingConfirmationInternal,
              {
                operatorUserId: args.operatorUserId,
                threadId: result.run.threadId,
              },
            )
          : null;
      await sendOperatorSlackResponse(ctx, {
        delivery,
        clientMessageId: delivery.clientMessageId,
        response: result.response ?? {},
        confirmation,
      });
      if (delivery.eventId) {
        const event = await ctx.runQuery(internal.slack.getInboundEvent, {
          eventId: delivery.eventId,
        });
        if (event)
          await updateOperatorSlackActivity(
            ctx,
            event,
            result.run.status === "failed" ||
              result.run.status === "cancelled"
              ? "failed"
              : "complete",
          );
      }
    } catch (error) {
      const attempt = args.deliveryAttempt ?? 0;
      if (attempt < 2) {
        await ctx.scheduler.runAfter(
          5_000 * (attempt + 1),
          internal.actions.operatorChannelDelivery.deliver,
          { ...args, deliveryAttempt: attempt + 1 },
        );
        return;
      }
      if (delivery.eventId) {
        const event = await ctx.runQuery(internal.slack.getInboundEvent, {
          eventId: delivery.eventId,
        });
        if (event) await updateOperatorSlackActivity(ctx, event, "failed");
      }
      throw error;
    }
  },
});
