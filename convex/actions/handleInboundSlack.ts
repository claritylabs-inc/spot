"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildOperatorSlackConfirmationBlocks,
  buildOperatorSlackConfirmationResolvedBlocks,
  operatorSlackConfirmationText,
  type OperatorSlackConfirmationResolution,
  formatSlackAnswerText,
} from "../lib/slackBlocks";
import {
  handleOperatorChannelConfirmation,
  waitForOperatorAgentRun,
} from "../lib/operatorAgentChannel";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
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
import { decideSlackControlIntent } from "../lib/channelControls";
import { operatorSlackConversationKey } from "../lib/operatorSlackConfig";
import { slackWebApi } from "../lib/slackWebApi";

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
  const filenames = (event.attachments ?? []).map(({ filename }) => filename);
  return filenames.length > 0
    ? `[Attached ${filenames.join(", ")}]`
    : "Please help with this.";
}

export async function sendOperatorSlackResponse(
  ctx: ActionCtx,
  args: {
    delivery: OperatorSlackDelivery;
    clientMessageId: string;
    mentionHere?: boolean;
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
  const attachments = (args.response.attachments ?? []).flatMap((attachment) =>
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
  const content =
    args.response.content?.trim() ||
    (attachments.length > 0 ? "" : "I couldn't complete that request.");
  const result = await slackWebApi(ctx).sendMessage({
    clientMessageId: args.clientMessageId,
    teamId: args.delivery.teamId,
    channelId: args.delivery.channelId,
    threadTs: args.delivery.threadTs,
    mrkdwnText: `${args.mentionHere ? "<!here> " : ""}${formatSlackAnswerText(content)}`,
    blocks: args.confirmation
      ? buildOperatorSlackConfirmationBlocks({
          confirmationId: args.confirmation._id,
          summary: args.confirmation.summary,
          destructive: args.confirmation.effect === "destructive",
        })
      : undefined,
    attachments,
  });
  if (result.attachmentFailures.length) {
    throw new Error(
      result.attachmentFailures
        .map(({ filename, error }) => `${filename}: ${error}`)
        .join("; "),
    );
  }
  return result.messageId;
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

export async function updateOperatorSlackActivity(
  ctx: ActionCtx,
  event: Pick<Doc<"slackInboundEvents">, "teamId" | "channelId" | "messageTs">,
  state: OperatorSlackActivityState,
) {
  const slack = slackWebApi(ctx);
  const reaction = async (operation: "add" | "remove", name: string) => {
    const input = {
      teamId: event.teamId,
      channelId: event.channelId,
      messageTs: event.messageTs,
      name,
    };
    try {
      if (operation === "add") await slack.addReaction(input);
      else await slack.removeReaction(input);
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
  } & OperatorSlackConfirmationResolution,
) {
  await slackWebApi(ctx).updateMessage({
    teamId: args.delivery.teamId,
    channelId: args.delivery.channelId,
    messageTs: args.messageTs,
    mrkdwnText: operatorSlackConfirmationText(args),
    blocks: buildOperatorSlackConfirmationResolvedBlocks({
      summary: args.summary,
      decision: args.decision,
      error: args.error,
    }),
  });
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
      updateOperatorSlackActivity(ctx, event, "processing"),
    ),
  );
  try {
    const firstAuthorizedEvent = authorized[0]?.event;
    const channelName = firstAuthorizedEvent?.isDirectMessage
      ? undefined
      : await resolveSlackChannelName(ctx, firstAuthorizedEvent).catch(
          (error) => {
            console.warn(
              "[slack] Could not resolve operator channel name",
              error,
            );
            return undefined;
          },
        );
    const slackThreadContext = authorized.at(-1)?.event
      ? await fetchThreadContext(ctx, authorized.at(-1)!.event)
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
        const clientMessageId = `operator-agent:${confirmation.runId}:${refreshedEvent.eventKey}`;
        const result =
          confirmation.status === "queued"
            ? await waitForOperatorAgentRun(
                ctx,
                operatorUserId,
                confirmation.runId,
                {
                  channel: "slack",
                  ...operatorSlackDelivery(refreshedEvent),
                  eventId: refreshedEvent._id,
                  clientMessageId,
                },
              )
            : { response: { content: confirmation.content } };
        if (result) {
          await sendOperatorSlackResponse(ctx, {
            delivery: operatorSlackDelivery(refreshedEvent),
            clientMessageId,
            response: result.response ?? {},
          });
          await updateOperatorSlackActivity(ctx, refreshedEvent, "complete");
        }
        await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
          eventId: refreshedEvent._id,
        });
        pendingActivity.delete(event._id);
        continue;
      }
      await fetchAttachment(ctx, refreshedEvent);
      refreshedEvent = (await ctx.runQuery(internalApi.slack.getInboundEvent, {
        eventId: refreshedEvent._id,
      })) as Doc<"slackInboundEvents"> | null;
      if (!refreshedEvent) continue;
      const inboundAttachments = refreshedEvent.attachments ?? [];
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
          dedupeKey:
            refreshedEvent.canonicalEventKey ?? refreshedEvent.eventKey,
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
        {
          channel: "slack",
          ...operatorSlackDelivery(refreshedEvent),
          eventId: refreshedEvent._id,
          clientMessageId: `operator-agent:${queued.runId}:${refreshedEvent.eventKey}`,
        },
      );
      if (!result) {
        await ctx.runMutation(internalApi.operatorSlack.completeEvent, {
          eventId: refreshedEvent._id,
        });
        pendingActivity.delete(event._id);
        continue;
      }
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
      await updateOperatorSlackActivity(ctx, refreshedEvent, "complete");
      pendingActivity.delete(event._id);
    }
  } finally {
    await Promise.all(
      [...pendingActivity.values()].map((event) =>
        updateOperatorSlackActivity(ctx, event, "failed"),
      ),
    );
  }
}

async function resolveSlackChannelName(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents"> | undefined,
) {
  if (!event) return undefined;
  const name = await slackWebApi(ctx).resolveChannelName({
    teamId: event.teamId,
    channelId: event.channelId,
    timeoutMs: CHANNEL_NAME_TIMEOUT_MS,
  });
  return name.trim() || undefined;
}

async function fetchThreadContext(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents">,
): Promise<SlackThreadContextSnapshot | undefined> {
  if (event.isDirectMessage) return undefined;
  try {
    const context = await slackWebApi(ctx).fetchThreadContext({
      teamId: event.teamId,
      channelId: event.channelId,
      threadTs: event.threadTs,
      latestMessageTs: event.messageTs,
    });
    return {
      messages: context.messages
        .slice(0, MAX_SLACK_THREAD_CONTEXT_MESSAGES)
        .map((message) => ({
          messageTs: message.messageTs.slice(0, 50),
          ...(message.senderUserId
            ? { senderUserId: message.senderUserId.slice(0, 100) }
            : {}),
          ...(message.senderName
            ? { senderName: message.senderName.slice(0, 200) }
            : {}),
          content: message.content.slice(0, 4_000),
        })),
      truncated: context.truncated,
    };
  } catch (error) {
    console.warn("[slack] Thread context retrieval failed", error);
    return undefined;
  }
}

async function fetchAttachment(
  ctx: ActionCtx,
  event: Doc<"slackInboundEvents">,
) {
  const attachments = event.attachments ?? [];
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
  const slack = slackWebApi(ctx);
  const downloaded: Array<{
    attachment: (typeof pending)[number];
    bytes: ArrayBuffer;
  }> = [];
  let downloadedBytes = 0;
  for (const attachment of pending) {
    const { bytes } = await slack.downloadFile({
      teamId: event.teamId,
      fileId: attachment.providerFileId,
    });
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
      const result = await ctx.runMutation(internal.slack.attachInboundFile, {
        eventId: event._id,
        providerFileId: attachment.providerFileId,
        fileId,
      });
      if (!result.attached) await ctx.storage.delete(fileId);
    } catch (error) {
      await ctx.storage.delete(fileId);
      throw error;
    }
  }
}

async function enrichActor(ctx: ActionCtx, event: Doc<"slackInboundEvents">) {
  const actor = await slackWebApi(ctx).resolveActor({
    teamId: event.teamId,
    userId: event.senderUserId,
  });
  if (actor.userId !== event.senderUserId) {
    throw new Error("Slack actor resolution failed");
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
        ? await fetchThreadContext(ctx, authorized.at(-1)!)
        : undefined;
      await Promise.all(authorized.map((event) => fetchAttachment(ctx, event)));
      const controlIntents = await Promise.all(
        authorized
          .filter((event) => event.eventType === "message")
          .map(async (event) => ({
            eventId: event._id,
            ...(await decideSlackControlIntent(ctx, {
              messageText: event.content,
              botUserId: event.mentionedBotUserId,
            })),
          })),
      );
      const prepared = await ctx.runMutation(internalApi.slack.prepareBatch, {
        eventIds: authorized.map((event) => event._id),
        slackThreadContext,
        controlIntents,
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
    // Accept jobs queued before resolution moved to a fresh persisted-state read.
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
    const readResolution =
      (): Promise<OperatorSlackConfirmationResolution | null> =>
        ctx.runQuery(internal.operatorSlack.getConfirmationResolution, {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          confirmationId: args.confirmationId,
        });
    const resolution = await readResolution();
    if (resolution) {
      await updateOperatorSlackConfirmation(ctx, {
        delivery,
        messageTs: args.messageTs,
        summary: args.summary,
        ...resolution,
      });
      return { status: resolution.decision };
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
          summary: args.summary,
          error: error instanceof Error ? error.message : undefined,
          decision: "error",
        });
        return { status: "error" as const };
      });
    if (result.status === "error") return result;
    try {
      await updateOperatorSlackConfirmation(ctx, {
        delivery,
        messageTs: args.messageTs,
        summary: args.summary,
        ...((await readResolution()) ?? { decision: "inactive" as const }),
      });
    } catch (error) {
      console.warn("[slack] Could not resolve operator confirmation UI", error);
    }
    if (result.status === "needs_refresh") return result;

    const response =
      result.status === "queued"
        ? await waitForOperatorAgentRun(
            ctx,
            args.operatorUserId,
            result.runId,
            {
              channel: "slack",
              ...delivery,
              clientMessageId: `operator-confirmation:${args.confirmationId}:${args.decision}`,
            },
          )
        : { response: { content: result.content } };
    if (!response) return result;
    await sendOperatorSlackResponse(ctx, {
      delivery,
      clientMessageId: `operator-confirmation:${args.confirmationId}:${args.decision}`,
      response: response.response ?? {},
    });
    return result;
  },
});
