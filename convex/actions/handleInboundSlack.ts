"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildOperatorSlackConfirmationBlocks,
  buildOperatorSlackConfirmationResolvedBlocks,
  OPERATOR_SLACK_CONFIRMATION_LABELS,
  formatSlackAnswerText,
} from "../lib/slackBlocks";
import {
  handleOperatorChannelConfirmation,
  waitForOperatorAgentRun,
} from "../lib/operatorAgentChannel";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  normalizeAgentAttachmentFilename,
} from "../lib/agentAttachmentLimits";
import {
  isLegacyOperatorSlackTitle,
  slackChannelTitlePrefix,
} from "../lib/slackThreadTitle";
import {
  MAX_SLACK_THREAD_CONTEXT_MESSAGES,
  type SlackThreadContextSnapshot,
} from "../lib/slackThreadContext";
import { operatorSlackConversationKey } from "../lib/operatorSlackConfig";

const WORKER_TIMEOUT_MS = 30_000;
const CHANNEL_NAME_TIMEOUT_MS = 3_000;
const internalApi = internal as any;
const OPERATOR_SLACK_PROCESSING_REACTION = "eyes";
const OPERATOR_SLACK_COMPLETE_REACTION = "white_check_mark";
const OPERATOR_SLACK_FAILED_REACTION = "warning";

type OperatorAuthorizedEvent = {
  event: Doc<"slackInboundEvents">;
  operatorUserId: Id<"users">;
};

type OperatorChannelThreadResult = {
  threadId: Id<"operatorAgentThreads">;
  created: boolean;
  title: string;
};

type OperatorSlackDelivery = {
  teamId: string;
  channelId: string;
  threadTs?: string;
};

type OperatorSlackConfirmation = {
  _id: Id<"operatorAgentConfirmations">;
  summary: string;
  effect: string;
};

type OperatorSlackActivityState = "processing" | "complete" | "failed";

function operatorSlackContent(event: Doc<"slackInboundEvents">) {
  const withoutMention = event.mentionedBotUserId
    ? event.content.replace(
        new RegExp(`<@${event.mentionedBotUserId}>`, "gi"),
        "",
      )
    : event.content;
  const trimmed = withoutMention.trim();
  if (trimmed) return trimmed;
  const filenames = (
    event.attachments ?? (event.attachment ? [event.attachment] : [])
  ).map(({ filename }) => filename);
  return filenames.length > 0
    ? `[Attached ${filenames.join(", ")}]`
    : "Please help with this.";
}

async function sendOperatorSlackResponse(
  ctx: ActionCtx,
  args: {
    delivery: OperatorSlackDelivery;
    clientMessageId: string;
    response: {
      content?: string;
      attachments?: Array<{
        fileId?: Id<"_storage">;
        filename: string;
        contentType: string;
      }>;
    };
    confirmation?: OperatorSlackConfirmation | null;
  },
) {
  const attachments = await Promise.all(
    (args.response.attachments ?? [])
      .flatMap((attachment) => (attachment.fileId ? [attachment] : []))
      .map(async (attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        url: await ctx.storage.getUrl(attachment.fileId!),
      })),
  );
  const availableAttachments = attachments.flatMap((attachment) =>
    attachment.url ? [{ ...attachment, url: attachment.url }] : [],
  );
  if (availableAttachments.length !== attachments.length) {
    throw new Error("An operator Slack attachment URL is unavailable");
  }
  const content =
    args.response.content?.trim() ||
    (availableAttachments.length > 0
      ? ""
      : "I couldn't complete that request.");
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientMessageId: args.clientMessageId,
      teamId: args.delivery.teamId,
      channelId: args.delivery.channelId,
      threadTs: args.delivery.threadTs,
      mrkdwnText: formatSlackAnswerText(content),
      blocks: args.confirmation
        ? buildOperatorSlackConfirmationBlocks({
            confirmationId: args.confirmation._id,
            summary: args.confirmation.summary,
            destructive: args.confirmation.effect === "destructive",
          })
        : undefined,
      attachments: availableAttachments,
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    sending?: boolean;
    attachmentFailures?: Array<{ filename: string; error: string }>;
  };
  if (!response.ok) {
    throw new Error(result.error ?? `Slack worker returned ${response.status}`);
  }
  if (response.status === 202 || result.sending) {
    throw new Error("Slack worker is still processing this send");
  }
  if (result.attachmentFailures?.length) {
    throw new Error(
      result.attachmentFailures
        .map(({ filename, error }) => `${filename}: ${error}`)
        .join("; "),
    );
  }
}

function operatorSlackDelivery(
  event: Doc<"slackInboundEvents">,
): OperatorSlackDelivery {
  return {
    teamId: event.teamId,
    channelId: event.channelId,
    threadTs: event.isDirectMessage ? event.replyThreadTs : event.threadTs,
  };
}

async function updateOperatorSlackActivity(
  event: Pick<
    Doc<"slackInboundEvents">,
    "teamId" | "channelId" | "messageTs"
  >,
  state: OperatorSlackActivityState,
) {
  const reaction = async (operation: "add" | "remove", name: string) => {
    try {
      const worker = workerConfig();
      const response = await fetch(`${worker.url}/reaction/${operation}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${worker.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: event.teamId,
          channelId: event.channelId,
          messageTs: event.messageTs,
          name,
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          providerErrorCode?: string;
        };
        throw new Error(
          [result.providerErrorCode, result.error].filter(Boolean).join(": ") ||
            `Slack worker returned ${response.status}`,
        );
      }
      return true;
    } catch (error) {
      console.error(
        `[slack] Could not ${operation} operator ${name} reaction on ${event.channelId}/${event.messageTs}`,
        error,
      );
      return false;
    }
  };

  if (state === "processing") {
    await reaction("add", OPERATOR_SLACK_PROCESSING_REACTION);
    return;
  }
  const settled = await reaction(
    "add",
    state === "complete"
      ? OPERATOR_SLACK_COMPLETE_REACTION
      : OPERATOR_SLACK_FAILED_REACTION,
  );
  if (settled) await reaction("remove", OPERATOR_SLACK_PROCESSING_REACTION);
}

async function updateOperatorSlackConfirmation(
  ctx: ActionCtx,
  args: {
    delivery: OperatorSlackDelivery;
    messageTs: string;
    summary: string;
    decision: keyof typeof OPERATOR_SLACK_CONFIRMATION_LABELS;
  },
) {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/message/update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      teamId: args.delivery.teamId,
      channelId: args.delivery.channelId,
      messageTs: args.messageTs,
      mrkdwnText: `${OPERATOR_SLACK_CONFIRMATION_LABELS[args.decision]}: ${args.summary}`,
      blocks: buildOperatorSlackConfirmationResolvedBlocks({
        summary: args.summary,
        decision: args.decision,
      }),
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      result.error ?? `Slack worker returned ${response.status}`,
    );
  }
}

async function processOperatorBatch(
  ctx: ActionCtx,
  batch: Array<Doc<"slackInboundEvents">>,
) {
  const eventIds = batch.map(({ _id }) => _id);
  await Promise.all(batch.map((event) => enrichActor(ctx, event)));
  const authorized = (await ctx.runMutation(
    internalApi.operatorSlack.authorizeBatch,
    { eventIds },
  )) as OperatorAuthorizedEvent[];
  const pendingActivity = new Map(
    authorized.map(({ event }) => [event._id, event] as const),
  );
  await Promise.all(
    authorized.map(({ event }) =>
      updateOperatorSlackActivity(event, "processing"),
    ),
  );
  try {
    const firstAuthorizedEvent = authorized[0]?.event;
    const channelName = firstAuthorizedEvent?.isDirectMessage
      ? undefined
      : await resolveSlackChannelName(firstAuthorizedEvent).catch((error) => {
          console.warn("[slack] Could not resolve operator channel name", error);
          return undefined;
        });
    const slackThreadContext = authorized.at(-1)?.event
      ? await fetchThreadContext(authorized.at(-1)!.event)
      : undefined;
    for (const { event, operatorUserId } of authorized) {
      let refreshedEvent = (await ctx.runQuery(
        internalApi.slack.getInboundEvent,
        { eventId: event._id },
      )) as Doc<"slackInboundEvents"> | null;
      if (!refreshedEvent) continue;
      const titlePrefix = slackChannelTitlePrefix({
        channelId: refreshedEvent.channelId,
        channelName,
      });
      const channelThread = (await ctx.runMutation(
        internalApi.operatorAgent.createOrGetChannelThreadWithStatusInternal,
        {
          operatorUserId,
          channel: "slack",
          conversationKey: operatorSlackConversationKey(refreshedEvent),
          title: refreshedEvent.isDirectMessage
            ? `Slack DM · ${refreshedEvent.senderDisplayName ?? refreshedEvent.senderUserId}`
            : titlePrefix,
          shared: !refreshedEvent.isDirectMessage,
        },
      )) as OperatorChannelThreadResult;
      const threadId = channelThread.threadId;
      const content = operatorSlackContent(refreshedEvent);
      const confirmation = await handleOperatorChannelConfirmation(ctx, {
        operatorUserId,
        threadId,
        channel: "slack",
        content,
      });
      if (confirmation) {
        await sendOperatorSlackResponse(ctx, {
          delivery: operatorSlackDelivery(refreshedEvent),
          clientMessageId: `operator-agent:${confirmation.runId}:${refreshedEvent.eventKey}`,
          response: confirmation.response ?? { content: confirmation.content },
        });
        await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
          eventId: refreshedEvent._id,
        });
        await updateOperatorSlackActivity(refreshedEvent, "complete");
        pendingActivity.delete(event._id);
        continue;
      }
      await fetchAttachment(ctx, refreshedEvent);
      refreshedEvent = (await ctx.runQuery(internalApi.slack.getInboundEvent, {
        eventId: refreshedEvent._id,
      })) as Doc<"slackInboundEvents"> | null;
      if (!refreshedEvent) continue;
      const inboundAttachments =
        refreshedEvent.attachments ??
        (refreshedEvent.attachment ? [refreshedEvent.attachment] : []);
      const titleGeneration =
        !refreshedEvent.isDirectMessage &&
        (channelThread.created ||
          isLegacyOperatorSlackTitle(
            channelThread.title,
            refreshedEvent.channelId,
          ))
          ? { expectedTitle: channelThread.title, titlePrefix }
          : undefined;
      const queued = await ctx.runMutation(
        internalApi.operatorAgent.enqueueMessageInternal,
        {
          operatorUserId,
          threadId,
          channel: "slack",
          content,
          dedupeKey: refreshedEvent.canonicalEventKey ?? refreshedEvent.eventKey,
          slackThreadContext,
          attachments: inboundAttachments.flatMap((attachment) =>
            attachment.fileId
              ? [
                  {
                    fileId: attachment.fileId,
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                    size: attachment.size ?? 0,
                  },
                ]
              : [],
          ),
        },
      );
      if (titleGeneration) {
        await ctx.runMutation(
          internalApi.operatorAgent.scheduleSlackThreadTitleInternal,
          { threadId, ...titleGeneration },
        );
      }
      const result = await waitForOperatorAgentRun(
        ctx,
        operatorUserId,
        queued.runId,
      );
      const pendingConfirmation =
        result.run.status === "waiting_confirmation"
          ? ((await ctx.runQuery(
              internalApi.operatorAgent.getPendingConfirmationInternal,
              { operatorUserId, threadId },
            )) as OperatorSlackConfirmation | null)
          : null;
      await sendOperatorSlackResponse(ctx, {
        delivery: operatorSlackDelivery(refreshedEvent),
        clientMessageId: `operator-agent:${queued.runId}:${refreshedEvent.eventKey}`,
        response: result.response ?? {},
        confirmation: pendingConfirmation,
      });
      await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
        eventId: refreshedEvent._id,
      });
      await updateOperatorSlackActivity(refreshedEvent, "complete");
      pendingActivity.delete(event._id);
    }
  } finally {
    await Promise.all(
      [...pendingActivity.values()].map((event) =>
        updateOperatorSlackActivity(event, "failed"),
      ),
    );
  }
}

function workerConfig() {
  const url = process.env.SLACK_WORKER_URL?.trim();
  const secret = process.env.SLACK_WORKER_SECRET?.trim();
  if (!url || !secret) throw new Error("Slack worker is not configured");
  return { url: url.replace(/\/$/, ""), secret };
}

async function resolveSlackChannelName(
  event: Doc<"slackInboundEvents"> | undefined,
) {
  if (!event) return undefined;
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/channel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      teamId: event.teamId,
      channelId: event.channelId,
    }),
    signal: AbortSignal.timeout(CHANNEL_NAME_TIMEOUT_MS),
  });
  const result = (await response.json().catch(() => ({}))) as {
    channelId?: string;
    name?: string;
  };
  if (!response.ok || result.channelId !== event.channelId) return undefined;
  return result.name?.trim() || undefined;
}

async function fetchThreadContext(
  event: Doc<"slackInboundEvents">,
): Promise<SlackThreadContextSnapshot | undefined> {
  if (event.isDirectMessage) return undefined;
  try {
    const worker = workerConfig();
    const response = await fetch(`${worker.url}/thread-context`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${worker.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        teamId: event.teamId,
        channelId: event.channelId,
        threadTs: event.threadTs,
        latestMessageTs: event.messageTs,
      }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(
        `[slack] Thread context retrieval failed (${response.status})`,
      );
      return undefined;
    }
    const payload = (await response.json()) as {
      messages?: unknown;
      truncated?: unknown;
    };
    if (!Array.isArray(payload.messages)) return undefined;
    const messages = payload.messages
      .slice(0, MAX_SLACK_THREAD_CONTEXT_MESSAGES)
      .flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const message = value as Record<string, unknown>;
        if (
          typeof message.messageTs !== "string" ||
          typeof message.content !== "string"
        ) {
          return [];
        }
        return [
          {
            messageTs: message.messageTs.slice(0, 50),
            ...(typeof message.senderUserId === "string"
              ? { senderUserId: message.senderUserId.slice(0, 100) }
              : {}),
            ...(typeof message.senderName === "string"
              ? { senderName: message.senderName.slice(0, 200) }
              : {}),
            content: message.content.slice(0, 4_000),
          },
        ];
      });
    return { messages, truncated: payload.truncated === true };
  } catch (error) {
    console.warn("[slack] Thread context retrieval failed", error);
    return undefined;
  }
}

async function fetchAttachment(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents">,
) {
  const attachments =
    event.attachments ?? (event.attachment ? [event.attachment] : []);
  if (attachments.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `Slack messages may include at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
    );
  }
  for (const attachment of attachments) {
    normalizeAgentAttachmentFilename(attachment.filename);
  }
  const declaredBytes = attachments.reduce((total, attachment) => {
    if (attachment.size === undefined) return total;
    if (attachment.size < 0 || attachment.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    return total + attachment.size;
  }, 0);
  if (declaredBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
    throw new Error(
      "Slack attachments exceed the 50 MB aggregate ingestion limit",
    );
  }
  const pending = attachments.filter((attachment) => !attachment.fileId);
  if (pending.length === 0) return;
  const worker = workerConfig();
  const downloaded: Array<{
    attachment: (typeof pending)[number];
    bytes: ArrayBuffer;
  }> = [];
  let downloadedBytes = 0;
  for (const attachment of pending) {
    const response = await fetch(`${worker.url}/attachment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${worker.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        teamId: event.teamId,
        fileId: attachment.providerFileId,
      }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Slack attachment retrieval failed (${response.status})`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
    }
    downloadedBytes += bytes.byteLength;
    if (downloadedBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error(
        "Slack attachments exceed the 50 MB aggregate ingestion limit",
      );
    }
    downloaded.push({ attachment, bytes });
  }
  for (const { attachment, bytes } of downloaded) {
    const fileId = await ctx.storage.store(
      new Blob([bytes], { type: attachment.contentType }),
    );
    try {
      await ctx.runMutation(internalApi.slack.attachInboundFile, {
        eventId: event._id,
        providerFileId: attachment.providerFileId,
        fileId,
      });
    } catch (error) {
      await ctx.storage.delete(fileId);
      throw error;
    }
  }
}

async function enrichActor(ctx: ActionCtx, event: Doc<"slackInboundEvents">) {
  const worker = workerConfig();
  const response = await fetch(`${worker.url}/actor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      teamId: event.teamId,
      userId: event.senderUserId,
    }),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const actor = (await response.json()) as {
    teamId?: string;
    userId?: string;
    displayName?: string;
    email?: string;
    isBot?: boolean;
    botUserId?: string;
    error?: string;
  };
  if (
    !response.ok ||
    !actor.teamId ||
    actor.userId !== event.senderUserId ||
    typeof actor.isBot !== "boolean"
  ) {
    throw new Error(
      actor.error ?? `Slack actor resolution failed (${response.status})`,
    );
  }
  await ctx.runMutation(internalApi.slack.enrichInboundActor, {
    eventId: event._id,
    senderTeamId: actor.teamId,
    senderDisplayName: actor.displayName,
    senderEmail: actor.email,
    senderIsBot: actor.isBot,
    installationBotUserId: actor.botUserId,
  });
}

export const processDebounced = internalAction({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const batch = (await ctx.runMutation(
      internalApi.slack.claimBatch,
      args,
    )) as Array<Doc<"slackInboundEvents">>;
    if (batch.length === 0) return;
    if (!batch[0]?.connectionId) {
      try {
        await processOperatorBatch(ctx, batch);
      } catch (error) {
        await ctx.runMutation(internalApi.slack.failEvents, {
          eventIds: batch.map(({ _id }) => _id),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      return;
    }
    const eventIds = batch.map((event: Doc<"slackInboundEvents">) => event._id);
    let presentationMessageId: Id<"threadMessages"> | undefined;
    try {
      await Promise.all(
        batch.map((event: Doc<"slackInboundEvents">) =>
          enrichActor(ctx, event),
        ),
      );
      const authorized = (await ctx.runMutation(
        internalApi.slack.authorizeBatch,
        { eventIds },
      )) as Array<Doc<"slackInboundEvents">>;
      if (authorized.length === 0) return;
      const slackThreadContext = authorized.at(-1)
        ? await fetchThreadContext(authorized.at(-1)!)
        : undefined;
      await Promise.all(authorized.map((event) => fetchAttachment(ctx, event)));
      const prepared = await ctx.runMutation(internalApi.slack.prepareBatch, {
        eventIds: authorized.map((event) => event._id),
        slackThreadContext,
      });
      if (!prepared) return;
      presentationMessageId = prepared.agentMessageId;

      let actionToken: string | undefined;
      try {
        const presentation = await ctx.runAction(
          internalApi.actions.slackPresentation.start,
          {
            orgId: prepared.orgId,
            threadId: prepared.threadId,
            threadMessageId: prepared.agentMessageId,
            connectionId: prepared.connectionId,
            channelId: prepared.channelId,
            threadTs: prepared.threadTs,
          },
        );
        actionToken = presentation?.actionToken;
      } catch (error) {
        console.warn(
          "[slack] Could not start rich response presentation",
          error,
        );
      }

      await ctx.runAction(internal.actions.processThreadChat.run, {
        surface: "slack",
        threadId: prepared.threadId,
        orgId: prepared.orgId,
        userId: prepared.serviceUserId,
        userMessageId: prepared.userMessageId,
        agentMessageId: prepared.agentMessageId,
        slackActorId: prepared.actorId,
      });
      const response = (await ctx.runQuery(internalApi.slack.getMessage, {
        messageId: prepared.agentMessageId,
      })) as Doc<"threadMessages"> | null;
      if (!response?.content.trim()) return;
      if (response.toolCalls?.length) {
        await ctx.runMutation(internalApi.slack.recordAgentActions, {
          orgId: prepared.orgId,
          threadId: prepared.threadId,
          threadMessageId: response._id,
          slackActorId: prepared.actorId,
          toolCalls: response.toolCalls,
        });
      }
      const attachments = (response.attachments ?? []).flatMap((attachment) =>
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
      if (!actionToken) {
        try {
          const presentation = await ctx.runAction(
            internalApi.actions.slackPresentation.start,
            {
              orgId: prepared.orgId,
              threadId: prepared.threadId,
              threadMessageId: prepared.agentMessageId,
              connectionId: prepared.connectionId,
              channelId: prepared.channelId,
              threadTs: prepared.threadTs,
            },
          );
          actionToken = presentation?.actionToken;
        } catch (error) {
          console.warn(
            "[slack] Could not recover rich response presentation",
            error,
          );
        }
      }
      let deliveredRichResponse = false;
      try {
        const finished = await ctx.runAction(
          internalApi.actions.slackPresentation.finish,
          { threadMessageId: response._id, actionToken },
        );
        deliveredRichResponse = finished?.phase === "final";
      } catch (error) {
        console.warn(
          "[slack] Rich response failed; sending plaintext fallback",
          error,
        );
      }
      if (!deliveredRichResponse) {
        const fallback = await ctx.runAction(
          internalApi.actions.sendSlack.send,
          {
            idempotencyKey: `agent:${response._id}:fallback`,
            orgId: prepared.orgId,
            threadId: prepared.threadId,
            threadMessageId: response._id,
            connectionId: prepared.connectionId,
            channelId: prepared.channelId,
            threadTs: prepared.threadTs,
            keepAttachmentsTopLevel: prepared.threadTs === undefined,
            content: response.content,
            attachments,
          },
        );
        if (fallback?.status !== "sent") {
          throw new Error(
            fallback?.error ?? "Slack plaintext fallback is retrying",
          );
        }
        const presentation = await ctx.runQuery(
          internalApi.slackPresentation.get,
          { threadMessageId: response._id },
        );
        if (presentation) {
          await ctx.runMutation(
            internalApi.slackPresentation.markPlaintextFallback,
            {
              id: presentation._id,
              providerMessageId: fallback.providerMessageId,
            },
          );
        }
      }
    } catch (error) {
      await ctx.runMutation(internalApi.slack.failEvents, {
        eventIds,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (presentationMessageId) {
        try {
          await ctx.runAction(
            internalApi.actions.slackPresentation.clearReaction,
            { threadMessageId: presentationMessageId },
          );
        } catch (error) {
          console.warn("[slack] Could not clear processing reaction", error);
        }
      }
    }
  },
});

export const processOperatorConfirmationInteraction = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    confirmationId: v.id("operatorAgentConfirmations"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    teamId: v.string(),
    channelId: v.string(),
    messageTs: v.string(),
    threadTs: v.optional(v.string()),
    summary: v.string(),
    unavailableReason: v.optional(
      v.union(v.literal("expired"), v.literal("inactive")),
    ),
  },
  handler: async (ctx, args) => {
    const delivery = {
      teamId: args.teamId,
      channelId: args.channelId,
      threadTs: args.threadTs,
    };
    if (args.unavailableReason) {
      await updateOperatorSlackConfirmation(ctx, {
        delivery,
        messageTs: args.messageTs,
        summary: args.summary,
        decision: args.unavailableReason,
      });
      return { status: args.unavailableReason };
    }
    const result = await ctx
      .runMutation(internalApi.operatorAgent.confirmActionInternal, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        confirmationId: args.confirmationId,
        decision: args.decision,
        channel: "slack",
      })
      .catch(async (error: unknown) => {
        console.warn("[slack] Could not confirm operator action", error);
        await updateOperatorSlackConfirmation(ctx, {
          delivery,
          messageTs: args.messageTs,
          summary: `${args.summary}\n\n${error instanceof Error ? error.message : "The action could not be validated."}`,
          decision: "failed",
        });
        return { status: "failed" as const };
      });
    if (result.status === "failed") return result;
    try {
      await updateOperatorSlackConfirmation(ctx, {
        delivery,
        messageTs: args.messageTs,
        summary: args.summary,
        decision:
          result.status === "needs_refresh" ? "inactive" : args.decision,
      });
    } catch (error) {
      console.warn("[slack] Could not resolve operator confirmation UI", error);
    }
    if (result.status === "needs_refresh") return result;

    const response =
      result.status === "queued"
        ? await waitForOperatorAgentRun(ctx, args.operatorUserId, result.runId)
        : { response: { content: result.content } };
    await sendOperatorSlackResponse(ctx, {
      delivery,
      clientMessageId: `operator-confirmation:${args.confirmationId}:${args.decision}`,
      response: response.response ?? {},
    });
    return result;
  },
});
