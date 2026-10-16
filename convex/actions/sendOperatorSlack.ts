"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { formatSlackAnswerText } from "../lib/slackBlocks";
import { slackWebApi, SlackProviderError } from "../lib/slackWebApi";

const internalApi = internal as any;

export const sendInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    recipientEmail: v.string(),
    content: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });
    const recipient = await ctx.runQuery(
      internalApi.agentChannels.getOperatorSlackRecipientForAction,
      { recipientEmail: args.recipientEmail },
    );
    const claim = await ctx.runMutation(
      internalApi.slackOutbound.claimOperatorDirectMessage,
      {
        idempotencyKey: args.idempotencyKey,
        senderOperatorUserId: args.operatorUserId,
        recipientOperatorUserId: recipient.operatorUserId,
        teamId: recipient.teamId,
        recipientSlackUserId: recipient.slackUserId,
        recipientEmail: recipient.email,
        content: args.content,
      },
    );
    if (!claim.send) {
      if (claim.row.status === "sent") {
        return {
          status: "sent" as const,
          recipientEmail: claim.row.recipientEmail,
          recipientName: recipient.name,
          providerMessageId: claim.row.providerMessageId,
          idempotent: true,
        };
      }
      throw new Error(
        claim.row.status === "sending"
          ? "Slack message delivery is already in progress"
          : claim.row.error || "Slack message delivery failed",
      );
    }

    try {
      const result = await slackWebApi(ctx).sendMessage({
        clientMessageId: `operator-agent:${claim.row._id}`,
        teamId: recipient.teamId,
        channelId: recipient.slackUserId,
        mrkdwnText: formatSlackAnswerText(args.content),
      });
      if (!result.messageId) {
        throw new Error("Slack did not return a message timestamp");
      }
      await ctx.runMutation(
        internalApi.slackOutbound.markOperatorDirectMessageSent,
        { id: claim.row._id, providerMessageId: result.messageId },
      );
      return {
        status: "sent" as const,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        providerMessageId: result.messageId,
        idempotent: false,
      };
    } catch (error) {
      await ctx.runMutation(
        internalApi.slackOutbound.markOperatorDirectMessageFailed,
        {
          id: claim.row._id,
          error: error instanceof Error ? error.message : String(error),
          providerErrorCode:
            error instanceof SlackProviderError ? error.code : undefined,
        },
      );
      throw error;
    }
  },
});
