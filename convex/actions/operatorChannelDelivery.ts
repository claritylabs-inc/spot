"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  operatorChannelDeliveryValidator,
  type OperatorChannelRunResult,
} from "../lib/operatorAgentChannel";
import { getOperatorImessageWorkerUrl } from "../lib/imessageConfig";
import {
  sendOperatorSlackResponse,
  updateOperatorSlackActivity,
} from "./handleInboundSlack";
import { operatorImessageRunResponse } from "./handleInboundOperatorImessage";

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
      if (delivery.channel === "slack") {
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
              event,
              result.run.status === "failed" ||
                result.run.status === "cancelled"
                ? "failed"
                : "complete",
            );
        }
        return;
      }

      const identity = await ctx.runQuery(
        internal.operatorImessage.resolveIdentity,
        {
          fromPhone: delivery.toPhone,
        },
      );
      if (identity?.operatorUserId !== args.operatorUserId) {
        throw new Error("Operator iMessage recipient is no longer authorized");
      }
      const workerUrl = getOperatorImessageWorkerUrl();
      const secret = process.env.OPERATOR_IMESSAGE_WORKER_SECRET;
      if (!workerUrl || !secret)
        throw new Error("Operator iMessage worker is not configured");
      const response = await operatorImessageRunResponse(ctx, result);
      const sent = await fetch(`${workerUrl}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          toPhone: delivery.toPhone,
          chatGuid: delivery.chatGuid,
          clientMessageId: delivery.clientMessageId,
          message: response.response,
          attachments: response.attachments,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const outcome = (await sent.json()) as {
        ok?: boolean;
        error?: string;
        attachmentFailures?: Array<{ filename: string; error?: string }>;
      };
      if (!sent.ok || !outcome.ok)
        throw new Error(outcome.error ?? "Operator iMessage delivery failed");
      if (outcome.attachmentFailures?.length && result.response) {
        await ctx.runMutation(
          internal.operatorAgent
            .recordImessageAttachmentDeliveryFailureInternal,
          {
            operatorMessageId: result.response.messageId,
            stage: "worker_delivery",
            failures: outcome.attachmentFailures.map((failure) => ({
              filename: failure.filename,
              error: failure.error ?? "Attachment delivery failed",
            })),
          },
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
      if (delivery.channel === "slack" && delivery.eventId) {
        const event = await ctx.runQuery(internal.slack.getInboundEvent, {
          eventId: delivery.eventId,
        });
        if (event) await updateOperatorSlackActivity(event, "failed");
      }
      throw error;
    }
  },
});
