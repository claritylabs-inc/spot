import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { slackRetryDelayMs } from "./lib/slackRetry";
import {
  isSlackConnectionHealthy,
  slackConnectionUnavailableReason,
} from "./lib/slackAvailability";

const outboundAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
});
const slackBlocksValidator = v.array(v.any());
const STALE_SENDING_MS = 5 * 60 * 1_000;

async function syncThreadMessageDelivery(
  ctx: MutationCtx,
  threadMessageId: Id<"threadMessages"> | undefined,
) {
  if (!threadMessageId) return;
  const message = await ctx.db.get(threadMessageId);
  if (!message || message.channel !== "slack") return;
  const sends = await ctx.db
    .query("slackOutboundSends")
    .withIndex("message", (q) =>
      q.eq("threadMessageId", threadMessageId),
    )
    .collect();
  const terminalFailure = sends.find(
    (send) =>
      send.status === "blocked" ||
      (send.status === "failed" && send.nextAttemptAt === undefined),
  );
  const status = terminalFailure
    ? ("failed" as const)
    : sends.length > 0 && sends.every((send) => send.status === "sent")
      ? ("sent" as const)
      : ("sending" as const);
  await ctx.db.patch(threadMessageId, {
    slackDeliveryStatus: status,
    slackDeliveryError: terminalFailure?.error,
  });
}

async function resolveSendTarget(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<"slackWorkspaceConnections">,
  channelId: string,
) {
  const connection = await ctx.db.get(connectionId);
  if (!connection) return null;
  const binding =
    (await ctx.db
      .query("slackChannelBindings")
      .withIndex("connection_status", (q) =>
        q.eq("connectionId", connection._id).eq("status", "active"),
      )
      .first()) ??
    (await ctx.db
      .query("slackChannelBindings")
      .withIndex("connection_status", (q) =>
        q.eq("connectionId", connection._id).eq("status", "unavailable"),
      )
      .first());
  const hostMatch = Boolean(
    binding &&
    (binding.hostChannelId === channelId ||
      binding.previousHostChannelId === channelId),
  );
  const customerMatch = Boolean(
    binding &&
    (binding.customerChannelId === channelId ||
      binding.previousCustomerChannelId === channelId),
  );
  const resolvedChannelId = hostMatch
    ? binding!.hostChannelId
    : customerMatch
      ? binding!.customerChannelId!
      : channelId;
  const connectionReason = slackConnectionUnavailableReason(connection);
  return {
    connection,
    binding,
    channelId: resolvedChannelId,
    teamId: hostMatch ? binding!.hostTeamId : connection.teamId,
    available: isSlackConnectionHealthy(connection),
    unavailableReason: connectionReason,
  };
}

export const claim = internalMutation({
  args: {
    idempotencyKey: v.string(),
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    threadMessageId: v.optional(v.id("threadMessages")),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
    keepAttachmentsTopLevel: v.optional(v.boolean()),
    content: v.string(),
    blocks: v.optional(slackBlocksValidator),
    attachments: v.optional(v.array(outboundAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.clientOrgId !== args.orgId) {
      throw new Error("Slack connection does not belong to the organization");
    }
    const thread = args.threadId ? await ctx.db.get(args.threadId) : null;
    if (
      thread &&
      (thread.orgId !== args.orgId ||
        thread.slackConnectionId !== args.connectionId)
    ) {
      throw new Error("Slack thread does not belong to the connection");
    }
    if (args.threadId && !thread) {
      throw new Error("Slack thread does not exist");
    }
    if (thread) {
      const target = await resolveSendTarget(
        ctx,
        args.connectionId,
        args.channelId,
      );
      const binding = target?.binding;
      const channelMatches =
        thread.slackChannelId === args.channelId ||
        Boolean(
          binding &&
          ((thread.slackChannelId === binding.customerChannelId &&
            args.channelId === binding.hostChannelId) ||
            (thread.slackChannelId === binding.hostChannelId &&
              args.channelId === binding.customerChannelId)),
        );
      if (!channelMatches) {
        throw new Error("Slack send target does not match the thread channel");
      }
      if (
        thread.slackConversationKind === "direct_message" &&
        args.threadTs !== undefined
      ) {
        const replyRoot = await ctx.db
          .query("threadMessages")
          .withIndex("thread_message", (q) =>
            q.eq("threadId", thread._id).eq("slackMessageTs", args.threadTs),
          )
          .first();
        if (!replyRoot) {
          throw new Error(
            "Slack DM reply target does not belong to the conversation",
          );
        }
      }
      if (
        thread.slackConversationKind !== "direct_message" &&
        thread.slackThreadTs !== args.threadTs
      ) {
        throw new Error(
          "Slack send target does not match the thread timestamp",
        );
      }
    }
    if (args.threadMessageId) {
      const message = await ctx.db.get(args.threadMessageId);
      if (
        !message ||
        message.orgId !== args.orgId ||
        (thread && message.threadId !== thread._id)
      ) {
        throw new Error("Slack message does not belong to the thread");
      }
      if (!thread) {
        const messageThread = await ctx.db.get(message.threadId);
        if (
          !messageThread ||
          messageThread.orgId !== args.orgId ||
          messageThread.slackConnectionId !== args.connectionId
        ) {
          throw new Error("Slack message does not belong to the connection");
        }
      }
    }
    const existing = await ctx.db
      .query("slackOutboundSends")
      .withIndex("idempotency", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    const now = dayjs().valueOf();
    if (existing) {
      if (
        existing.status === "sent" ||
        existing.status === "blocked" ||
        (existing.status === "failed" &&
          existing.nextAttemptAt === undefined) ||
        existing.attemptCount >= 3
      ) {
        return { send: false, row: existing };
      }
    }
    const target = await resolveSendTarget(
      ctx,
      args.connectionId,
      args.channelId,
    );
    if (!target?.available) {
      const reason =
        target?.unavailableReason ?? "Slack delivery target is unavailable";
      if (existing) {
        await ctx.db.patch(existing._id, {
          status: "blocked",
          error: reason,
          failureReason: "target_unavailable",
          retryable: false,
          nextAttemptAt: undefined,
          updatedAt: now,
        });
        await syncThreadMessageDelivery(ctx, existing.threadMessageId);
        return {
          send: false,
          row: { ...existing, status: "blocked" as const, error: reason },
        };
      }
      const id = await ctx.db.insert("slackOutboundSends", {
        ...args,
        status: "blocked",
        error: reason,
        failureReason: "target_unavailable",
        retryable: false,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const row = await ctx.db.get(id);
      if (!row) throw new Error("Could not create Slack outbound ledger row");
      await syncThreadMessageDelivery(ctx, row.threadMessageId);
      return { send: false, row };
    }
    if (existing) {
      if (
        existing.status === "sending" &&
        now - existing.updatedAt < STALE_SENDING_MS
      ) {
        return { send: false, row: existing };
      }
      await ctx.db.patch(existing._id, {
        status: "sending",
        error: undefined,
        providerErrorCode: undefined,
        failureReason: undefined,
        retryable: undefined,
        attemptCount: existing.attemptCount + 1,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      await syncThreadMessageDelivery(ctx, existing.threadMessageId);
      return {
        send: true,
        row: {
          ...existing,
          status: "sending" as const,
          attemptCount: existing.attemptCount + 1,
        },
      };
    }
    const id = await ctx.db.insert("slackOutboundSends", {
      ...args,
      status: "sending",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Could not create Slack outbound ledger row");
    await syncThreadMessageDelivery(ctx, row.threadMessageId);
    return { send: true, row };
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("slackOutboundSends"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(args.id, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      error: undefined,
      nextAttemptAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
    await syncThreadMessageDelivery(ctx, row.threadMessageId);
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("slackOutboundSends"),
    error: v.string(),
    retry: v.boolean(),
    providerErrorCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const retry = args.retry && row.attemptCount < 3;
    const nextAttemptAt = retry
      ? dayjs()
          .add(slackRetryDelayMs(args.error, row.attemptCount), "millisecond")
          .valueOf()
      : undefined;
    await ctx.db.patch(row._id, {
      status: "failed",
      error: args.error,
      providerErrorCode: args.providerErrorCode,
      failureReason: args.failureReason,
      retryable: retry,
      nextAttemptAt,
      updatedAt: dayjs().valueOf(),
    });
    await syncThreadMessageDelivery(ctx, row.threadMessageId);
    return nextAttemptAt;
  },
});

export const get = internalQuery({
  args: { id: v.id("slackOutboundSends") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const getSendTarget = internalQuery({
  args: {
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    return await resolveSendTarget(ctx, args.connectionId, args.channelId);
  },
});

export const claimOperatorDirectMessage = internalMutation({
  args: {
    idempotencyKey: v.string(),
    senderOperatorUserId: v.id("users"),
    recipientOperatorUserId: v.id("users"),
    teamId: v.string(),
    recipientSlackUserId: v.string(),
    recipientEmail: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("operatorSlackOutboundSends")
      .withIndex("operator_idempotency", (query) =>
        query
          .eq("senderOperatorUserId", args.senderOperatorUserId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    const now = dayjs().valueOf();
    if (existing) {
      if (
        existing.status === "sent" ||
        existing.attemptCount >= 3 ||
        (existing.status === "sending" &&
          now - existing.updatedAt < STALE_SENDING_MS)
      ) {
        return { send: false, row: existing };
      }
      await ctx.db.patch(existing._id, {
        status: "sending",
        error: undefined,
        providerErrorCode: undefined,
        attemptCount: existing.attemptCount + 1,
        updatedAt: now,
      });
      return {
        send: true,
        row: {
          ...existing,
          status: "sending" as const,
          error: undefined,
          providerErrorCode: undefined,
          attemptCount: existing.attemptCount + 1,
          updatedAt: now,
        },
      };
    }
    const id = await ctx.db.insert("operatorSlackOutboundSends", {
      ...args,
      status: "sending",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(id);
    if (!row) {
      throw new Error("Could not create operator Slack outbound ledger row");
    }
    return { send: true, row };
  },
});

export const markOperatorDirectMessageSent = internalMutation({
  args: {
    id: v.id("operatorSlackOutboundSends"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.id))) return;
    await ctx.db.patch(args.id, {
      status: "sent",
      providerMessageId: args.providerMessageId,
      error: undefined,
      providerErrorCode: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const markOperatorDirectMessageFailed = internalMutation({
  args: {
    id: v.id("operatorSlackOutboundSends"),
    error: v.string(),
    providerErrorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.id))) return;
    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error.slice(0, 1_000),
      providerErrorCode: args.providerErrorCode,
      updatedAt: dayjs().valueOf(),
    });
  },
});

