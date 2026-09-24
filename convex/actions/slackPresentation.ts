"use node";

import { createHash } from "node:crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildSlackClassicFinalBlocks,
  buildSlackFinalBlocks,
  formatSlackAnswerText,
  SLACK_DEFAULT_PROCESSING_REACTION,
  SLACK_PROCESSING_REACTIONS,
  type SlackBlock,
  type SlackEmailDraftCard,
} from "../lib/slackBlocks";
import { MAX_POLICY_CARDS_PER_TURN } from "../lib/agentPolicyPresentation";

// Break the generated API's recursive reference to this action module.
const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;

class SlackPresentationError extends Error {
  constructor(
    message: string,
    readonly providerErrorCode: string | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SlackPresentationError";
  }
}

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function workerRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    providerErrorCode?: string;
    retryable?: boolean;
  };
  if (!response.ok) {
    throw new SlackPresentationError(
      payload.error ?? `Slack worker returned ${response.status}`,
      payload.providerErrorCode,
      payload.retryable ?? response.status >= 500,
    );
  }
  return payload;
}

async function recordProviderFailure(
  ctx: ActionCtx,
  presentation: Doc<"slackMessagePresentations">,
  channelId: string,
  operationKey: string,
  error: unknown,
) {
  if (!(error instanceof SlackPresentationError) || !error.providerErrorCode) {
    return;
  }
  await ctx.runMutation(internalApi.slackLifecycle.recordProviderFailure, {
    connectionId: presentation.connectionId,
    channelId,
    operationKey: `presentation:${presentation._id}:${operationKey}`,
    providerErrorCode: error.providerErrorCode,
    errorSummary: error.message,
    retryable: error.retryable,
    occurredAt: dayjs().valueOf(),
  });
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const CLASSIC_BLOCK_FALLBACK_CODES = new Set([
  "invalid_blocks",
  "msg_blocks_too_long",
  "msg_blocks_too_many",
  "unsupported_block_type",
  "unknown_block_type",
]);

function fallbackEligible(error: unknown): boolean {
  return Boolean(
    error instanceof SlackPresentationError &&
    error.providerErrorCode &&
    CLASSIC_BLOCK_FALLBACK_CODES.has(error.providerErrorCode),
  );
}

async function bestEffortReaction(args: {
  operation: "add" | "remove";
  teamId: string;
  channelId: string;
  messageTs?: string;
  name: string;
}) {
  if (!args.messageTs) return false;
  try {
    await workerRequest(`/reaction/${args.operation}`, {
      teamId: args.teamId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      name: args.name,
    });
    return true;
  } catch (error) {
    console.warn(
      `[slack] Could not ${args.operation} processing reaction`,
      error,
    );
    return false;
  }
}

function processingReactionName(value: string) {
  return (SLACK_PROCESSING_REACTIONS as readonly string[]).includes(value)
    ? value
    : SLACK_DEFAULT_PROCESSING_REACTION;
}

async function sourceMessageTimestamp(
  ctx: ActionCtx,
  threadMessageId: Id<"threadMessages">,
) {
  const response = await ctx.runQuery(internalApi.slack.getMessage, {
    messageId: threadMessageId,
  });
  if (!response?.replyToMessageId) return undefined;
  const source = await ctx.runQuery(internalApi.slack.getMessage, {
    messageId: response.replyToMessageId,
  });
  if (
    !source ||
    source.threadId !== response.threadId ||
    source.channel !== "slack"
  ) {
    return undefined;
  }
  return source.slackMessageTs;
}

async function policyCards(
  ctx: ActionCtx,
  message: Doc<"threadMessages">,
): Promise<Doc<"policies">[]> {
  const policies = await Promise.all(
    (message.referencedPolicyIds ?? [])
      .slice(0, MAX_POLICY_CARDS_PER_TURN)
      .map(
        async (id) =>
          await ctx.runQuery(internalApi.policies.getInternal, { id }),
      ),
  );
  return policies.filter((policy): policy is Doc<"policies"> =>
    Boolean(policy && !policy.deletedAt && policy.orgId === message.orgId),
  );
}

async function emailDraftCard(
  ctx: ActionCtx,
  message: Doc<"threadMessages">,
): Promise<SlackEmailDraftCard | undefined> {
  if (!message.pendingEmailId) return undefined;
  const draft = (await ctx.runQuery(internalApi.pendingEmails.getInternal, {
    id: message.pendingEmailId,
  })) as Doc<"pendingEmails"> | null;
  if (
    !draft ||
    draft.status !== "draft" ||
    draft.orgId !== message.orgId ||
    draft.threadId !== message.threadId
  ) {
    return undefined;
  }
  try {
    const link = await ctx.runMutation(
      internalApi.emailDraftReviewLinks.createInternal,
      {
        pendingEmailId: draft._id,
        channel: "slack",
        sourceThreadMessageId: message._id,
      },
    );
    return {
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      attachmentCount: draft.attachments?.length ?? 0,
      reviewUrl: link.url,
    };
  } catch (error) {
    console.warn("[slack] Could not create email draft review link", error);
    return undefined;
  }
}

async function currentPresentation(
  ctx: ActionCtx,
  threadMessageId: Id<"threadMessages">,
) {
  return (await ctx.runQuery(internalApi.slackPresentation.get, {
    threadMessageId,
  })) as Doc<"slackMessagePresentations"> | null;
}

async function presentationTarget(
  ctx: ActionCtx,
  presentation: Doc<"slackMessagePresentations">,
) {
  const target = await ctx.runQuery(internalApi.slackOutbound.getSendTarget, {
    connectionId: presentation.connectionId,
    channelId: presentation.channelId,
  });
  if (!target?.available) {
    throw new Error(
      target?.unavailableReason ?? "Slack presentation target is unavailable",
    );
  }
  return target;
}

async function appendAttachments(
  ctx: ActionCtx,
  presentation: Doc<"slackMessagePresentations">,
  message: Doc<"threadMessages">,
) {
  const attachments = (message.attachments ?? []).flatMap((attachment) =>
    attachment.fileId
      ? [
          {
            fileId: attachment.fileId,
            filename: attachment.filename,
            contentType: attachment.contentType,
          },
        ]
      : [],
  );
  if (!attachments.length) return { status: "sent" as const };
  const result = await ctx.runAction(internalApi.actions.sendSlack.send, {
    idempotencyKey: `agent:${message._id}:attachments`,
    orgId: presentation.orgId,
    threadId: presentation.threadId,
    threadMessageId: message._id,
    connectionId: presentation.connectionId,
    channelId: presentation.channelId,
    threadTs: presentation.threadTs,
    keepAttachmentsTopLevel: presentation.threadTs === undefined,
    content: "",
    attachments,
  });
  return result;
}

export const start = internalAction({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    connectionId: v.id("slackWorkspaceConnections"),
    channelId: v.string(),
    threadTs: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internalApi.slackOutbound.getSendTarget, {
      connectionId: args.connectionId,
      channelId: args.channelId,
    });
    if (!target?.available) {
      throw new Error(
        target?.unavailableReason ?? "Slack presentation target is unavailable",
      );
    }
    if (!target.connection || target.connection.clientOrgId !== args.orgId) {
      throw new Error("Slack presentation target is unavailable");
    }
    const mode = "message" as const;
    const created = await ctx.runMutation(
      internalApi.slackPresentation.create,
      {
        orgId: args.orgId,
        threadId: args.threadId,
        threadMessageId: args.threadMessageId,
        connectionId: args.connectionId,
        teamId: target.teamId,
        channelId: target.channelId,
        threadTs: args.threadTs,
        mode,
      },
    );
    const presentation =
      created.presentation as Doc<"slackMessagePresentations">;
    if (presentation.phase === "active" || presentation.providerMessageId) {
      return { ...presentation, actionToken: created.actionToken };
    }
    await bestEffortReaction({
      operation: "add",
      teamId: target.teamId,
      channelId: target.channelId,
      messageTs: await sourceMessageTimestamp(ctx, args.threadMessageId),
      name: SLACK_DEFAULT_PROCESSING_REACTION,
    });
    await ctx.runMutation(internalApi.slackPresentation.markActive, {
      id: presentation._id,
      mode,
      processingReaction: SLACK_DEFAULT_PROCESSING_REACTION,
    });
    return {
      ...(await currentPresentation(ctx, args.threadMessageId)),
      actionToken: created.actionToken,
    };
  },
});

export const setReaction = internalAction({
  args: {
    threadMessageId: v.id("threadMessages"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const presentation = await currentPresentation(ctx, args.threadMessageId);
    if (!presentation || presentation.phase === "final") {
      return { applied: false, name: SLACK_DEFAULT_PROCESSING_REACTION };
    }
    const name = processingReactionName(args.name);
    const previousName =
      presentation.processingReaction ?? SLACK_DEFAULT_PROCESSING_REACTION;
    const messageTs = await sourceMessageTimestamp(ctx, args.threadMessageId);
    const added = await bestEffortReaction({
      operation: "add",
      teamId: presentation.teamId,
      channelId: presentation.channelId,
      messageTs,
      name,
    });
    if (!added) return { applied: false, name: previousName };
    if (name === previousName) return { applied: true, name };
    await bestEffortReaction({
      operation: "remove",
      teamId: presentation.teamId,
      channelId: presentation.channelId,
      messageTs,
      name: previousName,
    });
    await ctx.runMutation(internalApi.slackPresentation.setProcessingReaction, {
      id: presentation._id,
      processingReaction: name,
    });
    return { applied: true, name };
  },
});

export const finish = internalAction({
  args: {
    threadMessageId: v.id("threadMessages"),
    actionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [presentation, message] = await Promise.all([
      currentPresentation(ctx, args.threadMessageId),
      ctx.runQuery(internalApi.slack.getMessage, {
        messageId: args.threadMessageId,
      }),
    ]);
    if (!presentation || !message?.content.trim()) return null;
    if (presentation.phase === "final") return presentation;
    const [policies, emailDraft] = await Promise.all([
      policyCards(ctx, message),
      emailDraftCard(ctx, message),
    ]);
    const token = args.actionToken;
    const revision = presentation.revision + 1;
    const richBlocks = token
      ? buildSlackFinalBlocks({
          message,
          policies,
          emailDraft,
          actionToken: token,
          revision,
          showHandoff: presentation.threadTs !== undefined,
        })
      : [
          {
            type: "section",
            block_id: `spot-answer-${message._id}-${revision}`,
            text: {
              type: "mrkdwn",
              text: formatSlackAnswerText(message.content).slice(0, 3000),
            },
          },
        ];
    const classicBlocks = token
      ? buildSlackClassicFinalBlocks({
          message,
          policies,
          emailDraft,
          actionToken: token,
          revision,
          showHandoff: presentation.threadTs !== undefined,
        })
      : richBlocks;
    let finalBlocks = richBlocks;
    let payloadHash = hashPayload(finalBlocks);
    const target = await presentationTarget(ctx, presentation);

    const deliver = async (blocks: SlackBlock[]) => {
      let providerMessageId = presentation.providerMessageId;
      const mrkdwnText = formatSlackAnswerText(message.content);
      if (providerMessageId && presentation.mode === "stream") {
        await workerRequest("/stream/stop", {
          teamId: target.teamId,
          channelId: target.channelId,
          messageTs: providerMessageId,
          blocks,
        });
      } else if (providerMessageId) {
        await workerRequest("/message/update", {
          teamId: target.teamId,
          channelId: target.channelId,
          messageTs: providerMessageId,
          mrkdwnText,
          blocks,
        });
      } else {
        const sent = await workerRequest<{ messageId: string }>("/send", {
          clientMessageId: `agent:${message._id}:final`,
          teamId: target.teamId,
          channelId: target.channelId,
          threadTs: presentation.threadTs,
          mrkdwnText,
          blocks,
        });
        providerMessageId = sent.messageId;
      }
      if (!providerMessageId)
        throw new Error("Slack did not return a final message timestamp");
      return providerMessageId;
    };

    try {
      let providerMessageId: string;
      try {
        providerMessageId = await deliver(richBlocks);
      } catch (error) {
        if (classicBlocks === richBlocks || !fallbackEligible(error))
          throw error;
        console.warn(
          "[slack] Rich block types were rejected; retrying classic Block Kit",
          error,
        );
        finalBlocks = classicBlocks;
        payloadHash = hashPayload(finalBlocks);
        providerMessageId = await deliver(finalBlocks);
      }
      await ctx.runMutation(internalApi.slackPresentation.markFinal, {
        id: presentation._id,
        providerMessageId,
        lastPayloadHash: payloadHash,
      });
      const attachmentDelivery = await appendAttachments(
        ctx,
        presentation,
        message,
      );
      if (attachmentDelivery?.status !== "sent") {
        console.warn(
          "[slack] Final response was delivered but an attachment is still retrying",
          attachmentDelivery?.error,
        );
      }
      return await currentPresentation(ctx, message._id);
    } catch (error) {
      await recordProviderFailure(
        ctx,
        presentation,
        target.channelId,
        `finish:${revision}`,
        error,
      );
      const providerError =
        error instanceof SlackPresentationError ? error : undefined;
      await ctx.runMutation(internalApi.slackPresentation.markFailed, {
        id: presentation._id,
        error: error instanceof Error ? error.message : String(error),
        providerErrorCode: providerError?.providerErrorCode,
        retryable: providerError?.retryable,
      });
      throw error;
    }
  },
});

export const clearReaction = internalAction({
  args: { threadMessageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const presentation = await currentPresentation(ctx, args.threadMessageId);
    if (!presentation) return;
    await bestEffortReaction({
      operation: "remove",
      teamId: presentation.teamId,
      channelId: presentation.channelId,
      messageTs: await sourceMessageTimestamp(ctx, args.threadMessageId),
      name:
        presentation.processingReaction ?? SLACK_DEFAULT_PROCESSING_REACTION,
    });
  },
});

export const processInteraction = internalAction({
  args: {
    interactionId: v.id("slackInteractionEvents"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internalApi.slackPresentation.getInteractionContext,
      { id: args.interactionId },
    );
    if (!context || context.interaction.status !== "processing") return;
    const { interaction, presentation, actor } = context;
    let confirmation = "Done.";
    try {
      if (interaction.actionId === "spot_request_human") {
        const result = await ctx.runMutation(
          internalApi.slack.requestHandoffFromAgent,
          {
            threadId: presentation.threadId,
            slackActorId: actor._id,
          },
        );
        confirmation =
          result.status === "continue_in_primary_channel"
            ? "Please ask for a human in your shared Spot support channel."
            : "A Spot service team member has been requested.";
      } else if (interaction.actionId.startsWith("spot_open_")) {
        await ctx.runMutation(
          internalApi.slackPresentation.completeInteraction,
          {
            id: interaction._id,
            status: "completed",
          },
        );
        return;
      } else {
        await ctx.runMutation(
          internalApi.slackPresentation.completeInteraction,
          {
            id: interaction._id,
            status: "ignored",
          },
        );
        return;
      }
      const target = await presentationTarget(ctx, presentation);
      await workerRequest("/ephemeral", {
        teamId: target.teamId,
        channelId: target.channelId,
        userId: actor.slackUserId,
        threadTs: presentation.threadTs,
        text: confirmation,
      });
      await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
        id: interaction._id,
        status: "completed",
      });
    } catch (error) {
      await recordProviderFailure(
        ctx,
        presentation,
        presentation.channelId,
        `interaction:${interaction._id}`,
        error,
      );
      await ctx.runMutation(internalApi.slackPresentation.completeInteraction, {
        id: interaction._id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
