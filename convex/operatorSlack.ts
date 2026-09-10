import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  getOperatorSlackConfig,
  operatorSlackConversationKey,
} from "./lib/operatorSlackConfig";

async function ignoreEvent(
  event: Doc<"slackInboundEvents">,
  ctx: MutationCtx,
) {
  await ctx.db.patch(event._id, {
    status: "ignored",
    content: "",
    attachment: undefined,
    attachments: undefined,
    updatedAt: dayjs().valueOf(),
  });
}

function eventMentionsSpot(
  event: Pick<Doc<"slackInboundEvents">, "mentionsSpot" | "mentionsGlass">,
) {
  return event.mentionsSpot ?? event.mentionsGlass ?? false;
}

async function hasActiveSlackThread(
  ctx: MutationCtx,
  event: Doc<"slackInboundEvents">,
) {
  const thread = await ctx.db
    .query("operatorAgentThreads")
    .withIndex("channel_conversation", (q) =>
      q
        .eq("channel", "slack")
        .eq("conversationKey", operatorSlackConversationKey(event)),
    )
    .unique();
  return thread?.visibility === "shared" && thread.archiveState !== "archived";
}

export const authorizeBatch = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")) },
  handler: async (ctx, args) => {
    const config = getOperatorSlackConfig();
    const authorized: Array<{
      event: Doc<"slackInboundEvents">;
      operatorUserId: Doc<"operatorProfiles">["userId"];
    }> = [];
    const activeConversationKeys = new Set<string>();
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      const directMessage = event?.isDirectMessage === true;
      if (
        !event ||
        event.status !== "processing" ||
        event.connectionId ||
        !config.enabled ||
        !config.hostTeamId ||
        event.teamId !== config.hostTeamId ||
        event.senderTeamId !== config.hostTeamId ||
        event.senderIsBot !== false ||
        event.eventType !== "message"
      ) {
        if (event?.status === "processing" && !event.connectionId) {
          await ignoreEvent(event, ctx);
        }
        continue;
      }
      const operator = await ctx.db
        .query("operatorProfiles")
        .withIndex("slack_user", (q) =>
          q
            .eq("slackTeamId", event.senderTeamId)
            .eq("slackUserId", event.senderUserId),
        )
        .first();
      if (!operator || operator.status !== "active") {
        await ignoreEvent(event, ctx);
        continue;
      }
      const conversationKey = operatorSlackConversationKey(event);
      const activeThread =
        directMessage ||
        eventMentionsSpot(event) ||
        (event.threadTs !== event.messageTs &&
          (activeConversationKeys.has(conversationKey) ||
            (await hasActiveSlackThread(ctx, event))));
      if (!activeThread) {
        await ignoreEvent(event, ctx);
        continue;
      }
      if (!directMessage) activeConversationKeys.add(conversationKey);
      authorized.push({ event, operatorUserId: operator.userId });
    }
    return authorized;
  },
});

export const authorizeConfirmationInteraction = internalQuery({
  args: {
    teamId: v.string(),
    actorTeamId: v.string(),
    slackUserId: v.string(),
    channelId: v.string(),
    confirmationId: v.string(),
  },
  handler: async (ctx, args) => {
    const config = getOperatorSlackConfig();
    if (
      !config.enabled ||
      !config.hostTeamId ||
      args.teamId !== config.hostTeamId ||
      args.actorTeamId !== config.hostTeamId
    ) {
      return null;
    }
    const operator = await ctx.db
      .query("operatorProfiles")
      .withIndex("slack_user", (q) =>
        q
          .eq("slackTeamId", args.actorTeamId)
          .eq("slackUserId", args.slackUserId),
      )
      .first();
    if (!operator || operator.status !== "active") return null;

    const confirmationId = ctx.db.normalizeId(
      "operatorAgentConfirmations",
      args.confirmationId,
    );
    if (!confirmationId) return null;
    const confirmation = await ctx.db.get(confirmationId);
    if (!confirmation || confirmation.operatorUserId !== operator.userId) {
      return null;
    }
    const [thread, run] = await Promise.all([
      ctx.db.get(confirmation.threadId),
      ctx.db.get(confirmation.payload.runId),
    ]);
    if (
      !thread ||
      thread.channel !== "slack" ||
      !thread.conversationKey ||
      !thread.conversationKey.startsWith(`${args.teamId}:${args.channelId}:`) ||
      !run ||
      run.operatorUserId !== operator.userId ||
      run.threadId !== thread._id
    ) {
      return null;
    }
    return {
      operatorUserId: operator.userId,
      threadId: thread._id,
      confirmationId: confirmation._id,
      runId: run._id,
      summary: confirmation.payload.summary,
      destructive: confirmation.payload.effect === "destructive",
      unavailableReason:
        confirmation.status === "expired"
          ? ("expired" as const)
          : confirmation.status !== "pending" ||
              run.status !== "waiting_confirmation" ||
              run.cancellationRequestedAt ||
              run.checkpoint?.pendingConfirmationId !== confirmation._id
            ? ("inactive" as const)
            : undefined,
    };
  },
});

export const completeEvent = internalMutation({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (event?.status === "processing" && !event.connectionId) {
      await ctx.db.patch(event._id, {
        status: "completed",
        updatedAt: dayjs().valueOf(),
      });
    }
  },
});
