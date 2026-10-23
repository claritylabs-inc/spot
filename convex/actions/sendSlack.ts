"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertSlackAttachmentsDelivered } from "../lib/slackDelivery";
import { formatSlackAnswerText } from "../lib/slackBlocks";
import { slackWebApi, SlackProviderError } from "../lib/slackWebApi";

const attachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
});
const slackBlocksValidator = v.array(v.any());
// Break the generated API's recursive reference to this action module.
const internalApi = internal as any;

type SlackAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
};

type SlackSendArgs = {
  idempotencyKey: string;
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  threadMessageId?: Id<"threadMessages">;
  connectionId: Id<"slackWorkspaceConnections">;
  channelId: string;
  threadTs?: string;
  keepAttachmentsTopLevel?: boolean;
  content: string;
  blocks?: Array<Record<string, unknown>>;
  attachments?: SlackAttachment[];
};

const sendArgs = {
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
  attachments: v.optional(v.array(attachmentValidator)),
};

async function performSend(
  ctx: ActionCtx,
  args: {
    ledgerId: Id<"slackOutboundSends">;
    idempotencyKey: string;
    connectionId: Id<"slackWorkspaceConnections">;
    channelId: string;
    threadTs?: string;
    content: string;
    blocks?: Array<Record<string, unknown>>;
    attachments?: SlackAttachment[];
  },
) {
  const target = await ctx.runQuery(internalApi.slackOutbound.getSendTarget, {
    connectionId: args.connectionId,
    channelId: args.channelId,
  });
  if (!target?.available) {
    throw new SlackProviderError(
      target?.unavailableReason ?? "Slack delivery target is unavailable",
      "",
      false,
    );
  }
  const attachments = args.attachments ?? [];
  const mrkdwnText = formatSlackAnswerText(args.content);
  const transportText =
    mrkdwnText ||
    (attachments.length > 0 ? "" : "I couldn't complete that request.");
  const result = await slackWebApi(ctx).sendMessage({
    clientMessageId: args.idempotencyKey,
    teamId: target.teamId,
    channelId: target.channelId,
    threadTs: args.threadTs,
    mrkdwnText: transportText,
    blocks: args.blocks,
    attachments,
  });
  assertSlackAttachmentsDelivered(result);
  await ctx.runMutation(internalApi.slackOutbound.markSent, {
    id: args.ledgerId,
    providerMessageId: result.messageId,
  });
}

async function sendSingle(ctx: ActionCtx, args: SlackSendArgs) {
  const claim = await ctx.runMutation(internalApi.slackOutbound.claim, args);
  if (!claim.send) return claim.row;
  try {
    await performSend(ctx, {
      ledgerId: claim.row._id,
      idempotencyKey: claim.row.idempotencyKey,
      connectionId: claim.row.connectionId,
      channelId: claim.row.channelId,
      threadTs: claim.row.threadTs,
      content: claim.row.content,
      blocks: claim.row.blocks,
      attachments: claim.row.attachments,
    });
  } catch (error) {
    const deliveryError =
      error instanceof SlackProviderError ? error : undefined;
    const providerErrorCode = deliveryError?.code || undefined;
    const nextAttemptAt = await ctx.runMutation(
      internalApi.slackOutbound.markFailed,
      {
        id: claim.row._id,
        error: error instanceof Error ? error.message : String(error),
        retry: deliveryError?.retryable ?? true,
        providerErrorCode,
        failureReason:
          deliveryError?.retryable === false
            ? "provider_rejected_target"
            : "provider_transient_error",
      },
    );
    if (deliveryError && providerErrorCode) {
      await ctx.runMutation(internalApi.slackLifecycle.recordProviderFailure, {
        connectionId: claim.row.connectionId,
        channelId: claim.row.channelId,
        ledgerId: claim.row._id,
        providerErrorCode,
        errorSummary: deliveryError.message,
        retryable: deliveryError.retryable,
        occurredAt: dayjs().valueOf(),
      });
    }
    if (nextAttemptAt) {
      await ctx.scheduler.runAt(
        nextAttemptAt,
        internalApi.actions.sendSlack.retry,
        {
          ledgerId: claim.row._id,
        },
      );
    }
  }
  return await ctx.runQuery(internalApi.slackOutbound.get, {
    id: claim.row._id,
  });
}

export const send = internalAction({
  args: sendArgs,
  handler: async (ctx, args) => {
    const attachments = args.attachments ?? [];
    if (attachments.length === 0) return await sendSingle(ctx, args);
    if (!args.content.trim() && attachments.length === 1) {
      return await sendSingle(ctx, args);
    }

    const parts = [];
    let attachmentThreadTs = args.threadTs;
    if (args.content.trim() || args.blocks?.length) {
      const textPart = await sendSingle(ctx, {
        ...args,
        idempotencyKey: `${args.idempotencyKey}:text`,
        attachments: undefined,
      });
      parts.push(textPart);
      if (!args.keepAttachmentsTopLevel) {
        attachmentThreadTs ??= textPart?.providerMessageId;
      }
    }
    for (const attachment of attachments) {
      parts.push(
        await sendSingle(ctx, {
          ...args,
          idempotencyKey: `${args.idempotencyKey}:file:${attachment.fileId}`,
          threadTs: attachmentThreadTs,
          content: "",
          attachments: [attachment],
        }),
      );
    }
    const failed = parts.find((part) => part?.status !== "sent");
    return {
      status: failed ? ("failed" as const) : ("sent" as const),
      providerMessageId: parts[0]?.providerMessageId,
      error: failed?.error,
      parts: parts.map((part) => part?._id),
    };
  },
});

export const retry = internalAction({
  args: { ledgerId: v.id("slackOutboundSends") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internalApi.slackOutbound.get, {
      id: args.ledgerId,
    });
    if (!row || row.status !== "failed") return;
    await ctx.runAction(internalApi.actions.sendSlack.send, {
      idempotencyKey: row.idempotencyKey,
      orgId: row.orgId,
      threadId: row.threadId,
      threadMessageId: row.threadMessageId,
      connectionId: row.connectionId,
      channelId: row.channelId,
      threadTs: row.threadTs,
      keepAttachmentsTopLevel: row.keepAttachmentsTopLevel,
      content: row.content,
      blocks: row.blocks as Array<Record<string, unknown>> | undefined,
      attachments: row.attachments,
    });
  },
});
