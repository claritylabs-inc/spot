import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import type { OperatorSlackConfirmationResolution } from "./lib/slackBlocks";
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
    };
  },
});

export const getConfirmationResolution = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    confirmationId: v.id("operatorAgentConfirmations"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<OperatorSlackConfirmationResolution | null> => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.threadId !== args.threadId
    ) {
      throw new Error("Operator confirmation not found");
    }
    const run = await ctx.db.get(confirmation.payload.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.threadId !== args.threadId
    ) {
      throw new Error("Operator agent run not found");
    }

    // Resolve this exact action before looking at the whole task: a later step
    // failing must not relabel an earlier successful approval as failed.
    const audit = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (q) =>
        q.eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", confirmation.payload.idempotencyKey),
      )
      .unique();
    if (
      audit?.operatorConfirmationId === confirmation._id &&
      audit.runId === run._id
    ) {
      if (audit.status === "failed") {
        return { decision: "failed", error: audit.error };
      }
      if (audit.status === "succeeded") return { decision: "approve" };
    }
    if (confirmation.status === "completed") return { decision: "approve" };
    if (confirmation.status === "expired") return { decision: "expired" };
    if (confirmation.invalidationReason === "rejected_by_operator") {
      return { decision: "reject" };
    }
    if (
      confirmation.invalidationReason === "superseded" ||
      run.lastError === "superseded"
    ) {
      return { decision: "superseded" };
    }
    if (run.status === "cancelled" || run.cancellationRequestedAt) {
      return { decision: "cancelled" };
    }
    if (run.status === "failed") {
      return { decision: "failed", error: run.lastError };
    }
    if (
      confirmation.status === "pending" &&
      run.status === "waiting_confirmation" &&
      run.checkpoint?.pendingConfirmationId === confirmation._id
    ) {
      return null;
    }
    return { decision: "inactive" };
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
