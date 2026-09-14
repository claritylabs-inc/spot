import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeEmailAddress } from "./lib/emailAddress";
import { slackRetryDelayMs } from "./lib/slackRetry";
import {
  isSlackBindingReachable,
  isSlackConnectionHealthy,
} from "./lib/slackAvailability";
import {
  isSlackOperatorClassification,
  slackActorUserId,
} from "./lib/slackInteractions";
import {
  getOperatorSlackConfig,
  operatorSlackConversationKey,
} from "./lib/operatorSlackConfig";
import {
  slackChannelTitlePrefix,
  slackThreadTitle,
} from "./lib/slackThreadTitle";
import {
  createSlackThreadContextArtifact,
  slackThreadContextMessageTimestamps,
  slackThreadContextSnapshotValidator,
} from "./lib/slackThreadContext";

import {
  slackAttachments,
  slackInboundAttachmentValidator,
} from "./lib/slackAttachments";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
} from "./lib/agentAttachmentLimits";

const internalApi = internal as any;
const DEBOUNCE_MS = 1_500;
const MAX_BATCH_SIZE = 50;
const LOCAL_FIXTURE_TEAM_ID = "T-COVE-FIXTURE";
const LOCAL_FIXTURE_CHANNEL_ID = "C-COVE-FIXTURE";
const LOCAL_FIXTURE_BOT_USER_IDS = new Set(["U-SPOT", "U-GLASS"]);

function mentionedBotUserId(args: {
  content: string;
  configuredBotUserId?: string;
  teamId: string;
  channelId: string;
}): string | undefined {
  if (
    args.configuredBotUserId &&
    args.content.includes(`<@${args.configuredBotUserId}>`)
  ) {
    return args.configuredBotUserId;
  }
  if (
    process.env.SPOT_ENV !== "local" ||
    args.teamId !== LOCAL_FIXTURE_TEAM_ID ||
    args.channelId !== LOCAL_FIXTURE_CHANNEL_ID ||
    !LOCAL_FIXTURE_BOT_USER_IDS.has(args.configuredBotUserId ?? "")
  ) {
    return undefined;
  }
  return Array.from(LOCAL_FIXTURE_BOT_USER_IDS).find((botUserId) =>
    args.content.includes(`<@${botUserId}>`),
  );
}

export const getActiveConnection = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .first();
    if (!connection || !isSlackConnectionHealthy(connection)) return null;
    const unavailableBinding = await ctx.db
      .query("slackChannelBindings")
      .withIndex("connection_status", (q) =>
        q.eq("connectionId", connection._id).eq("status", "unavailable"),
      )
      .first();
    return unavailableBinding ? null : connection;
  },
});

export const verifyInboundEventMentionsSpotBackfill = internalQuery({
  args: {},
  handler: async (ctx) => {
    const remaining = await ctx.db
      .query("slackInboundEvents")
      .filter((query) =>
        query.or(
          query.eq(query.field("mentionsSpot"), undefined),
          query.neq(query.field("mentionsGlass"), undefined),
        ),
      )
      .first();
    return {
      complete: remaining === null,
      remainingSampleId: remaining?._id,
    };
  },
});

export const verifySlackActorSpotIdentityBackfill = internalQuery({
  args: {},
  handler: async (ctx) => {
    const remaining = await ctx.db
      .query("slackActors")
      .filter((query) =>
        query.or(
          query.eq(query.field("classification"), "glass_operator"),
          query.neq(query.field("glassUserId"), undefined),
        ),
      )
      .first();
    return {
      complete: remaining === null,
      remainingSampleId: remaining?._id,
    };
  },
});

type SlackClassification = Doc<"slackActors">["classification"];

function eventMentionsSpot(
  event: Pick<Doc<"slackInboundEvents">, "mentionsSpot" | "mentionsGlass">,
): boolean {
  return event.mentionsSpot ?? event.mentionsGlass ?? false;
}

async function hasPendingSlackThreadMention(
  ctx: MutationCtx,
  args: {
    connectionId?: Id<"slackWorkspaceConnections">;
    channelId: string;
    threadTs: string;
  },
) {
  const pending = await Promise.all(
    (["queued", "processing"] as const).map((status) =>
      ctx.db
        .query("slackInboundEvents")
        .withIndex("thread_schedule", (q) =>
          q
            .eq("connectionId", args.connectionId)
            .eq("channelId", args.channelId)
            .eq("threadTs", args.threadTs)
            .eq("status", status),
        )
        .order("desc")
        .take(MAX_BATCH_SIZE),
    ),
  );
  return pending.some((events) => events.some(eventMentionsSpot));
}

async function hasActiveOperatorSlackThread(
  ctx: MutationCtx,
  args: { teamId: string; channelId: string; threadTs: string },
) {
  const thread = await ctx.db
    .query("operatorAgentThreads")
    .withIndex("channel_conversation", (q) =>
      q
        .eq("channel", "slack")
        .eq("conversationKey", operatorSlackConversationKey(args)),
    )
    .unique();
  return thread?.visibility === "shared" && thread.archiveState !== "archived";
}

async function resolveSpotUserId(
  ctx: MutationCtx,
  connection: Doc<"slackWorkspaceConnections">,
  email: string | undefined,
) {
  if (!email) return undefined;
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", normalizeEmailAddress(email)))
    .first();
  if (!user || user.accountKind === "operator") return undefined;
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", connection.clientOrgId).eq("userId", user._id),
    )
    .first();
  return membership ? user._id : undefined;
}

async function resolveActor(
  ctx: MutationCtx,
  connection: Doc<"slackWorkspaceConnections">,
  event: Doc<"slackInboundEvents">,
) {
  const senderTeamId = event.senderTeamId;
  if (!senderTeamId) {
    throw new Error("Slack actor workspace has not been resolved");
  }
  const existing = await ctx.db
    .query("slackActors")
    .withIndex("slack_identity", (q) =>
      q
        .eq("connectionId", connection._id)
        .eq("teamId", senderTeamId)
        .eq("slackUserId", event.senderUserId),
    )
    .first();
  const operator = await ctx.db
    .query("operatorProfiles")
    .withIndex("slack_user", (q) =>
      q.eq("slackTeamId", senderTeamId).eq("slackUserId", event.senderUserId),
    )
    .first();
  const classification: SlackClassification =
    event.senderIsBot === true || event.senderUserId === connection.botUserId
      ? "bot"
      : operator?.status === "active"
        ? "spot_operator"
        : senderTeamId === connection.teamId
          ? "customer_member"
          : "external";
  const resolvedSpotUserId =
    classification === "customer_member"
      ? await resolveSpotUserId(ctx, connection, event.senderEmail)
      : undefined;
  let spotUserId = resolvedSpotUserId;
  if (
    classification === "customer_member" &&
    !event.senderEmail &&
    existing &&
    slackActorUserId(existing)
  ) {
    const existingSpotUserId = slackActorUserId(existing);
    if (!existingSpotUserId) {
      throw new Error("Slack actor user identity could not be resolved");
    }
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", connection.clientOrgId).eq("userId", existingSpotUserId),
      )
      .first();
    spotUserId = membership ? existingSpotUserId : undefined;
  }
  const now = dayjs().valueOf();
  if (existing) {
    await ctx.db.patch(existing._id, {
      classification,
      operatorUserId: operator?.userId,
      spotUserId,
      ...(event.senderDisplayName
        ? { displayName: event.senderDisplayName }
        : {}),
      updatedAt: now,
    });
    return {
      ...existing,
      classification,
      operatorUserId: operator?.userId,
      spotUserId,
      displayName: event.senderDisplayName ?? existing.displayName,
    };
  }
  const actorId = await ctx.db.insert("slackActors", {
    connectionId: connection._id,
    clientOrgId: connection.clientOrgId,
    teamId: senderTeamId,
    slackUserId: event.senderUserId,
    classification,
    operatorUserId: operator?.userId,
    spotUserId,
    displayName: event.senderDisplayName,
    createdAt: now,
    updatedAt: now,
  });
  const actor = await ctx.db.get(actorId);
  if (!actor) throw new Error("Could not create Slack actor");
  return actor;
}

function withoutMention(content: string, botUserId: string | undefined) {
  if (!botUserId) return content.trim();
  return content.replace(new RegExp(`<@${botUserId}>`, "gi"), "").trim();
}

function isResolveCommand(content: string, botUserId: string | undefined) {
  return /^(resolve|resolved|close|closed)[.!]?$/i.test(
    withoutMention(content, botUserId),
  );
}

function isHumanRequest(content: string, botUserId: string | undefined) {
  return /^(human|person|operator|handoff|human help|talk to (a )?human)[.!]?$/i.test(
    withoutMention(content, botUserId),
  );
}

async function primaryBinding(
  ctx: MutationCtx,
  connectionId: Id<"slackWorkspaceConnections">,
) {
  const binding = await ctx.db
    .query("slackChannelBindings")
    .withIndex("connection_status", (q) =>
      q.eq("connectionId", connectionId).eq("status", "active"),
    )
    .first();
  return isSlackBindingReachable(binding) ? binding : null;
}

async function claimOperatorInbound(
  ctx: MutationCtx,
  args: {
    eventKey: string;
    providerEventId?: string;
    teamId: string;
    channelId: string;
    threadTs: string;
    replyThreadTs?: string;
    messageTs: string;
    senderTeamId?: string;
    senderUserId: string;
    senderDisplayName?: string;
    senderEmail?: string;
    content: string;
    attachments?: Array<{
      providerFileId: string;
      filename: string;
      contentType: string;
      size?: number;
    }>;
    eventType: "message" | "edit" | "delete";
    isDirectMessage?: boolean;
    isPrivateChannel?: boolean;
    receivedAt: number;
  },
) {
  const config = getOperatorSlackConfig();
  if (!config.enabled || !config.hostTeamId) {
    return { duplicate: false, status: "unknown_workspace" as const };
  }
  if (args.teamId !== config.hostTeamId) {
    return { duplicate: false, status: "unknown_workspace" as const };
  }
  if (args.eventType !== "message") {
    return { duplicate: false, status: "ignored" as const };
  }
  const directMessage = args.isDirectMessage === true;
  const hostInstallation = await ctx.db
    .query("slackInstallations")
    .withIndex("team_status", (q) =>
      q.eq("teamId", args.teamId).eq("status", "active"),
    )
    .first();
  const botUserId = hostInstallation?.botUserId ?? config.mockBotUserId;
  if (botUserId && args.senderUserId === botUserId) {
    return { duplicate: false, status: "ignored" as const };
  }
  const mentionsSpot = Boolean(
    botUserId && args.content.includes(`<@${botUserId}>`),
  );
  if (!directMessage && !mentionsSpot) {
    const isThreadReply = args.threadTs !== args.messageTs;
    const canContinueThread =
      isThreadReply &&
      ((await hasActiveOperatorSlackThread(ctx, args)) ||
        (await hasPendingSlackThreadMention(ctx, {
          channelId: args.channelId,
          threadTs: args.threadTs,
        })));
    if (!canContinueThread) {
      return { duplicate: false, status: "ignored" as const };
    }
  }

  const canonicalEventKey = [
    "operator",
    args.teamId,
    args.channelId,
    args.threadTs,
    args.messageTs,
  ].join(":");
  const mirroredDuplicate = await ctx.db
    .query("slackInboundEvents")
    .withIndex("canonical", (q) => q.eq("canonicalEventKey", canonicalEventKey))
    .first();
  if (mirroredDuplicate) {
    return { duplicate: true, status: mirroredDuplicate.status };
  }

  const scheduledFor = dayjs(args.receivedAt)
    .add(DEBOUNCE_MS, "millisecond")
    .valueOf();
  const queued = await ctx.db
    .query("slackInboundEvents")
    .withIndex("thread_schedule", (q) =>
      q
        .eq("connectionId", undefined)
        .eq("channelId", args.channelId)
        .eq("threadTs", args.threadTs)
        .eq("status", "queued"),
    )
    .order("asc")
    .take(MAX_BATCH_SIZE);
  for (const event of queued) {
    await ctx.db.patch(event._id, {
      scheduledFor,
      updatedAt: args.receivedAt,
    });
  }
  const eventId = await ctx.db.insert("slackInboundEvents", {
    ...args,
    canonicalEventKey,
    isPrimaryChannel: false,
    mentionsSpot,
    mentionedBotUserId: mentionsSpot ? botUserId : undefined,
    status: "queued",
    attemptCount: 0,
    scheduledFor,
    updatedAt: args.receivedAt,
  });
  await ctx.scheduler.runAt(
    scheduledFor,
    internal.actions.handleInboundSlack.processDebounced,
    { eventId },
  );
  return { duplicate: false, status: "queued" as const, eventId };
}

function canonicalEventKey(
  connectionId: Id<"slackWorkspaceConnections">,
  args: {
    eventKey: string;
    providerEventId?: string;
    canonicalChannelKey: string;
    eventPrefix: string;
    messageTs: string;
    eventType: "message" | "edit" | "delete";
  },
) {
  const revisionPrefix = `${args.eventPrefix}:${args.messageTs}:${args.eventType}:`;
  const revisionKey =
    args.eventType !== "message"
      ? args.eventKey.startsWith(revisionPrefix)
        ? args.eventKey.slice(revisionPrefix.length)
        : (args.providerEventId ?? args.eventKey)
      : "";
  return `${connectionId}:${args.canonicalChannelKey}:${args.messageTs}:${args.eventType}:${revisionKey}`;
}

function channelIdentity(
  connection: Doc<"slackWorkspaceConnections">,
  binding: Doc<"slackChannelBindings"> | null,
  args: { teamId: string; channelId: string },
) {
  const isPrimaryChannel = Boolean(
    binding &&
    ((args.teamId === binding.hostTeamId &&
      args.channelId === binding.hostChannelId) ||
      (args.teamId === connection.teamId &&
        binding.customerChannelId === args.channelId)),
  );
  return {
    isPrimaryChannel,
    canonicalChannelKey:
      isPrimaryChannel && binding
        ? `support:${binding._id}`
        : `channel:${args.teamId}:${args.channelId}`,
    threadChannelId:
      isPrimaryChannel && binding
        ? (binding.customerChannelId ?? binding.hostChannelId)
        : args.channelId,
  };
}

async function createHandoff(
  ctx: MutationCtx,
  args: {
    connection: Doc<"slackWorkspaceConnections">;
    actorId: Id<"slackActors">;
    sourceChannelId: string;
    sourceThreadTs: string;
    sourceThreadId: Id<"threads">;
  },
) {
  const existing = await ctx.db
    .query("slackHandoffs")
    .withIndex("source_thread", (q) =>
      q
        .eq("connectionId", args.connection._id)
        .eq("sourceChannelId", args.sourceChannelId)
        .eq("sourceThreadTs", args.sourceThreadTs),
    )
    .first();
  if (existing?.status === "open") return existing._id;

  const binding = await primaryBinding(ctx, args.connection._id);
  if (!binding) return null;
  const now = dayjs().valueOf();
  const handoffId = await ctx.db.insert("slackHandoffs", {
    clientOrgId: args.connection.clientOrgId,
    connectionId: args.connection._id,
    sourceChannelId: args.sourceChannelId,
    sourceThreadTs: args.sourceThreadTs,
    primaryChannelId: binding.customerChannelId ?? binding.hostChannelId,
    sourceThreadId: args.sourceThreadId,
    createdByActorId: args.actorId,
    status: "open",
    createdAt: now,
  });
  const sourceLink = `https://slack.com/archives/${args.sourceChannelId}/p${args.sourceThreadTs.replace(".", "")}`;
  await ctx.scheduler.runAfter(0, internalApi.actions.sendSlack.send, {
    idempotencyKey: `handoff:${handoffId}`,
    orgId: args.connection.clientOrgId,
    connectionId: args.connection._id,
    channelId: binding.customerChannelId ?? binding.hostChannelId,
    content: `Human service requested in another Slack channel. <${sourceLink}|Open the request>.`,
  });
  return handoffId;
}

async function scrubDeletedSlackMessage(
  ctx: MutationCtx,
  args: {
    connectionId: Id<"slackWorkspaceConnections">;
    event: Doc<"slackInboundEvents">;
    message: Doc<"threadMessages">;
    now: number;
  },
) {
  for (const attachment of args.message.attachments ?? []) {
    if (attachment.fileId) await ctx.storage.delete(attachment.fileId);
  }
  const revisions = await ctx.db
    .query("slackMessageRevisions")
    .withIndex("message_edited", (q) =>
      q.eq("threadMessageId", args.message._id),
    )
    .collect();
  for (const revision of revisions) await ctx.db.delete(revision._id);
  const sourceEvents = await ctx.db
    .query("slackInboundEvents")
    .withIndex("thread_message", (q) =>
      q
        .eq("connectionId", args.connectionId)
        .eq("channelId", args.event.channelId)
        .eq("threadTs", args.event.threadTs)
        .eq("messageTs", args.event.messageTs),
    )
    .collect();
  for (const sourceEvent of sourceEvents) {
    await ctx.db.patch(sourceEvent._id, {
      content: "",
      attachment: undefined,
      attachments: undefined,
      updatedAt: args.now,
    });
  }
  await ctx.db.patch(args.message._id, {
    content: "Message deleted in Slack",
    attachments: undefined,
    slackDeletedAt: args.event.receivedAt,
  });
}

export const claimInbound = internalMutation({
  args: {
    eventKey: v.string(),
    providerEventId: v.optional(v.string()),
    spectrumMessageId: v.optional(v.string()),
    teamId: v.string(),
    channelId: v.string(),
    threadTs: v.string(),
    replyThreadTs: v.optional(v.string()),
    messageTs: v.string(),
    senderTeamId: v.optional(v.string()),
    senderUserId: v.string(),
    senderDisplayName: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    content: v.string(),
    attachment: v.optional(slackInboundAttachmentValidator),
    attachments: v.optional(v.array(slackInboundAttachmentValidator)),
    eventType: v.union(
      v.literal("message"),
      v.literal("edit"),
      v.literal("delete"),
    ),
    isDirectMessage: v.optional(v.boolean()),
    isPrivateChannel: v.optional(v.boolean()),
    receivedAt: v.number(),
  },
  handler: async (ctx, input) => {
    const {
      attachment,
      spectrumMessageId: _spectrumMessageId,
      ...fields
    } = input;
    const args = {
      ...fields,
      attachments: slackAttachments({ ...fields, attachment }),
    };
    const duplicate = await ctx.db
      .query("slackInboundEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (duplicate) return { duplicate: true, status: duplicate.status };

    let connection = await ctx.db
      .query("slackWorkspaceConnections")
      .withIndex("team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "active"),
      )
      .first();
    let inboundHostBinding: Doc<"slackChannelBindings"> | null = null;
    if (!connection) {
      const hostBinding = await ctx.db
        .query("slackChannelBindings")
        .withIndex("host_channel", (q) =>
          q.eq("hostTeamId", args.teamId).eq("hostChannelId", args.channelId),
        )
        .first();
      if (
        hostBinding &&
        hostBinding.status !== "archived" &&
        hostBinding.connectionId
      ) {
        const boundConnection = await ctx.db.get(hostBinding.connectionId);
        if (boundConnection?.status === "active") {
          connection = boundConnection;
          inboundHostBinding = hostBinding;
        }
      }
    }
    if (!connection) return await claimOperatorInbound(ctx, args);
    if (args.senderUserId === connection.botUserId) {
      return { duplicate: false, status: "ignored" as const };
    }
    if (args.teamId !== connection.teamId) {
      const installation = await ctx.db
        .query("slackInstallations")
        .withIndex("team_status", (q) =>
          q.eq("teamId", args.teamId).eq("status", "active"),
        )
        .first();
      if (installation?.botUserId === args.senderUserId) {
        return { duplicate: false, status: "ignored" as const };
      }
    }
    const binding =
      inboundHostBinding ?? (await primaryBinding(ctx, connection._id));
    const identity = channelIdentity(connection, binding, args);
    const logicalEventKey = canonicalEventKey(connection._id, {
      eventKey: args.eventKey,
      providerEventId: args.providerEventId,
      canonicalChannelKey: identity.canonicalChannelKey,
      eventPrefix: `${args.teamId}:${args.channelId}`,
      messageTs: args.messageTs,
      eventType: args.eventType,
    });
    const mirroredDuplicate = await ctx.db
      .query("slackInboundEvents")
      .withIndex("canonical", (q) => q.eq("canonicalEventKey", logicalEventKey))
      .first();
    if (mirroredDuplicate) {
      return { duplicate: true, status: mirroredDuplicate.status };
    }
    const settings = await ctx.db
      .query("agentChannelSettings")
      .withIndex("client", (q) => q.eq("clientOrgId", connection.clientOrgId))
      .first();
    if (settings?.slackEnabled !== true) {
      return { duplicate: false, status: "disabled" as const };
    }
    const mentionedBot = mentionedBotUserId({
      content: args.content,
      configuredBotUserId: connection.botUserId,
      teamId: args.teamId,
      channelId: args.channelId,
    });
    const mentionsSpot = mentionedBot !== undefined;
    if (
      args.eventType !== "delete" &&
      !args.isDirectMessage &&
      !identity.isPrimaryChannel &&
      !mentionsSpot
    ) {
      if (args.threadTs === args.messageTs) {
        return { duplicate: false, status: "ignored" as const };
      }
      const activeThread = await ctx.db
        .query("threads")
        .withIndex("slack_thread", (q) =>
          q
            .eq("slackConnectionId", connection._id)
            .eq("slackChannelId", identity.threadChannelId)
            .eq("slackThreadTs", args.threadTs),
        )
        .first();
      const pendingMention = await hasPendingSlackThreadMention(ctx, {
        connectionId: connection._id,
        channelId: args.channelId,
        threadTs: args.threadTs,
      });
      if (activeThread?.slackState !== "active" && !pendingMention) {
        return { duplicate: false, status: "ignored" as const };
      }
    }
    const scheduledFor = dayjs(args.receivedAt)
      .add(DEBOUNCE_MS, "millisecond")
      .valueOf();
    const queued = await ctx.db
      .query("slackInboundEvents")
      .withIndex("thread_schedule", (q) =>
        q
          .eq("connectionId", connection._id)
          .eq("channelId", args.channelId)
          .eq("threadTs", args.threadTs)
          .eq("status", "queued"),
      )
      .order("asc")
      .take(MAX_BATCH_SIZE);
    for (const event of queued) {
      await ctx.db.patch(event._id, {
        scheduledFor,
        updatedAt: args.receivedAt,
      });
    }
    const eventId = await ctx.db.insert("slackInboundEvents", {
      ...args,
      canonicalEventKey: logicalEventKey,
      connectionId: connection._id,
      isPrimaryChannel: identity.isPrimaryChannel,
      mentionsSpot,
      mentionedBotUserId: mentionedBot,
      status: "queued",
      attemptCount: 0,
      scheduledFor,
      updatedAt: args.receivedAt,
    });
    await ctx.scheduler.runAt(
      scheduledFor,
      internal.actions.handleInboundSlack.processDebounced,
      { eventId },
    );
    return { duplicate: false, status: "queued" as const, eventId };
  },
});

export const claimBatch = internalMutation({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => {
    const scheduledEvent = await ctx.db.get(args.eventId);
    const now = dayjs().valueOf();
    if (
      !scheduledEvent ||
      scheduledEvent.status !== "queued" ||
      scheduledEvent.scheduledFor > now
    ) {
      return [];
    }
    const connectionId = scheduledEvent.connectionId;
    const queued = await ctx.db
      .query("slackInboundEvents")
      .withIndex("thread_schedule", (q) =>
        q
          .eq("connectionId", connectionId)
          .eq("channelId", scheduledEvent.channelId)
          .eq("threadTs", scheduledEvent.threadTs)
          .eq("status", "queued")
          .lte("scheduledFor", now),
      )
      .order("asc")
      .take(MAX_BATCH_SIZE);
    const batch = queued.sort(
      (left, right) => left.receivedAt - right.receivedAt,
    );
    for (const event of batch) {
      await ctx.db.patch(event._id, {
        status: "processing",
        attemptCount: event.attemptCount + 1,
        updatedAt: now,
      });
    }
    return batch;
  },
});

export const attachInboundFile = internalMutation({
  args: {
    eventId: v.id("slackInboundEvents"),
    providerFileId: v.string(),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Slack event is no longer available");
    const attachments = slackAttachments(event);
    const target = attachments.find(
      (file) => file.providerFileId === args.providerFileId,
    );
    if (!target) {
      throw new Error("Slack attachment is no longer available");
    }
    if (target.fileId) return { attached: target.fileId === args.fileId };
    let storedBytes = 0;
    let fileSize = 0;
    for (const attachment of attachments) {
      const fileId = attachment === target ? args.fileId : attachment.fileId;
      if (!fileId) continue;
      const metadata = await ctx.db.system.get(fileId);
      if (!metadata) throw new Error("Slack attachment is no longer available");
      if (metadata.size > MAX_AGENT_ATTACHMENT_BYTES) {
        throw new Error("Slack attachment exceeds the 25 MB ingestion limit");
      }
      storedBytes += metadata.size;
      if (attachment === target) fileSize = metadata.size;
    }
    if (storedBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error(
        "Slack attachments exceed the 50 MB aggregate ingestion limit",
      );
    }
    await ctx.db.patch(event._id, {
      attachment: undefined,
      attachments: attachments.map((attachment) =>
        attachment.providerFileId === args.providerFileId
          ? { ...attachment, fileId: args.fileId, size: fileSize }
          : attachment,
      ),
      updatedAt: dayjs().valueOf(),
    });
    return { attached: true };
  },
});

export const enrichInboundActor = internalMutation({
  args: {
    eventId: v.id("slackInboundEvents"),
    senderTeamId: v.string(),
    senderDisplayName: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    senderIsBot: v.boolean(),
    installationBotUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== "processing") return;
    await ctx.db.patch(event._id, {
      senderTeamId: args.senderTeamId,
      ...(args.senderDisplayName
        ? { senderDisplayName: args.senderDisplayName }
        : {}),
      ...(args.senderEmail ? { senderEmail: args.senderEmail } : {}),
      senderIsBot: args.senderIsBot,
      mentionsSpot:
        eventMentionsSpot(event) ||
        Boolean(
          args.installationBotUserId &&
          event.content.includes(`<@${args.installationBotUserId}>`),
        ),
      mentionedBotUserId:
        args.installationBotUserId &&
        event.content.includes(`<@${args.installationBotUserId}>`)
          ? args.installationBotUserId
          : event.mentionedBotUserId,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const authorizeBatch = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")) },
  handler: async (ctx, args) => {
    const authorized: Array<Doc<"slackInboundEvents">> = [];
    const now = dayjs().valueOf();
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      if (
        !event ||
        event.status !== "processing" ||
        !event.connectionId ||
        !event.senderTeamId
      ) {
        continue;
      }
      const connection = await ctx.db.get(event.connectionId);
      if (!connection || connection.status !== "active") {
        await ctx.db.patch(event._id, {
          status: "ignored",
          content: "",
          attachment: undefined,
          attachments: undefined,
          updatedAt: now,
        });
        continue;
      }
      const actor = await resolveActor(ctx, connection, event);
      if (
        actor.classification !== "customer_member" &&
        !isSlackOperatorClassification(actor.classification)
      ) {
        await ctx.db.patch(event._id, {
          status: "ignored",
          content: "",
          attachment: undefined,
          attachments: undefined,
          updatedAt: now,
        });
        continue;
      }
      authorized.push(event);
    }
    return authorized;
  },
});

export const prepareBatch = internalMutation({
  args: {
    eventIds: v.array(v.id("slackInboundEvents")),
    slackThreadContext: v.optional(slackThreadContextSnapshotValidator),
  },
  handler: async (ctx, args) => {
    const events = (
      await Promise.all(args.eventIds.map((eventId) => ctx.db.get(eventId)))
    ).filter((event): event is Doc<"slackInboundEvents"> => Boolean(event));
    const first = events[0];
    if (!first?.connectionId) return null;
    const connection = await ctx.db.get(first.connectionId);
    if (!connection || connection.status !== "active") return null;
    const binding = await primaryBinding(ctx, connection._id);

    let trigger:
      | {
          threadId: Id<"threads">;
          userMessageId: Id<"threadMessages">;
          agentMessageId: Id<"threadMessages">;
          actorId: Id<"slackActors">;
          channelId: string;
          threadTs?: string;
        }
      | undefined;
    const now = dayjs().valueOf();

    for (const event of events) {
      if (!event.senderTeamId) {
        throw new Error("Slack actor workspace has not been resolved");
      }
      const actor = await resolveActor(ctx, connection, event);
      if (
        actor.classification === "bot" ||
        actor.classification === "external"
      ) {
        await ctx.db.patch(event._id, {
          status: "ignored",
          content: "",
          attachment: undefined,
          attachments: undefined,
          updatedAt: now,
        });
        continue;
      }

      const threadChannelId =
        event.isPrimaryChannel && binding
          ? (binding.customerChannelId ?? binding.hostChannelId)
          : event.channelId;
      const existingThread = await ctx.db
        .query("threads")
        .withIndex("slack_thread", (q) =>
          q
            .eq("slackConnectionId", connection._id)
            .eq("slackChannelId", threadChannelId)
            .eq("slackThreadTs", event.threadTs),
        )
        .first();

      if (event.eventType === "edit" || event.eventType === "delete") {
        const message = existingThread
          ? await ctx.db
              .query("threadMessages")
              .withIndex("thread_message", (q) =>
                q
                  .eq("threadId", existingThread._id)
                  .eq("slackMessageTs", event.messageTs),
              )
              .first()
          : null;
        if (message && event.eventType === "delete") {
          await scrubDeletedSlackMessage(ctx, {
            connectionId: connection._id,
            event,
            message,
            now,
          });
          if (trigger?.userMessageId === message._id) {
            await ctx.db.delete(trigger.agentMessageId);
            trigger = undefined;
          }
        } else if (message && message.content !== event.content) {
          await ctx.db.insert("slackMessageRevisions", {
            threadMessageId: message._id,
            slackTeamId: event.teamId,
            slackMessageTs: event.messageTs,
            previousContent: message.content,
            revisedContent: event.content,
            editedAt: event.receivedAt,
          });
          await ctx.db.patch(message._id, {
            content: event.content,
            slackEditedAt: event.receivedAt,
          });
        }
        await ctx.db.patch(event._id, { status: "completed", updatedAt: now });
        continue;
      }

      const authorizedCustomer = actor.classification === "customer_member";
      const operator = isSlackOperatorClassification(actor.classification);
      const actorUserId = slackActorUserId(actor);
      const isDirectMessage = event.isDirectMessage === true;
      const mentionedBotUserId =
        event.mentionedBotUserId ?? connection.botUserId;
      const shouldRecord = isDirectMessage
        ? authorizedCustomer
        : event.isPrimaryChannel
          ? true
          : eventMentionsSpot(event) || existingThread?.slackState === "active";
      if (!shouldRecord) {
        await ctx.db.patch(event._id, { status: "ignored", updatedAt: now });
        continue;
      }

      const membership = !isDirectMessage
        ? await ctx.db
            .query("slackChannelMemberships")
            .withIndex("connection_channel", (q) =>
              q
                .eq("connectionId", connection._id)
                .eq("channelId", threadChannelId),
            )
            .first()
        : null;
      const isPrivateChannel =
        !isDirectMessage &&
        !event.isPrimaryChannel &&
        (event.isPrivateChannel === true ||
          membership?.isPrivate === true ||
          threadChannelId.startsWith("G"));
      const isUserPrivate = isDirectMessage || isPrivateChannel;
      const privateOwnerId =
        !isDirectMessage && existingThread?.visibility === "user_private"
          ? existingThread.createdBy
          : (actorUserId ?? connection.serviceUserId);

      let thread = existingThread;
      let titleGeneration:
        | { expectedTitle: string; titlePrefix: string }
        | undefined;
      if (!thread) {
        const channelLabel =
          membership?.status === "active"
            ? membership.channelName
            : event.isPrimaryChannel && binding
              ? binding.channelName
              : threadChannelId;
        const actorName = actor.displayName ?? event.senderUserId;
        const channelTitlePrefix = slackChannelTitlePrefix({
          channelId: threadChannelId,
          channelName: channelLabel,
        });
        const initialTitle = isDirectMessage
          ? `DM · ${actorName}`
          : slackThreadTitle(channelTitlePrefix, actorName);
        const threadId = await ctx.db.insert("threads", {
          orgId: connection.clientOrgId,
          title: initialTitle,
          createdBy: isUserPrivate ? privateOwnerId : connection.serviceUserId,
          lastMessageAt: event.receivedAt,
          originChannel: "slack",
          visibility: isUserPrivate ? "user_private" : undefined,
          slackConnectionId: connection._id,
          slackChannelId: threadChannelId,
          slackThreadTs: event.threadTs,
          slackConversationKind: isDirectMessage ? "direct_message" : "channel",
          slackState:
            isDirectMessage && authorizedCustomer
              ? "active"
              : (actor.classification === "customer_member" ||
                    (!event.isPrimaryChannel && operator)) &&
                  eventMentionsSpot(event)
                ? "active"
                : "resolved",
        });
        thread = await ctx.db.get(threadId);
        if (!thread) throw new Error("Could not create Slack thread");
        if (!isDirectMessage) {
          titleGeneration = {
            expectedTitle: initialTitle,
            titlePrefix: channelTitlePrefix,
          };
        }
      } else if (isUserPrivate) {
        if (
          thread.createdBy !== privateOwnerId ||
          thread.visibility !== "user_private" ||
          (isDirectMessage && thread.slackConversationKind !== "direct_message")
        ) {
          await ctx.db.patch(thread._id, {
            createdBy: privateOwnerId,
            visibility: "user_private",
            ...(isDirectMessage
              ? { slackConversationKind: "direct_message" as const }
              : {}),
          });
        }
      }

      const inboundAttachments = slackAttachments(event);
      const attachments = inboundAttachments.flatMap((attachment) =>
        attachment.fileId
          ? [
              {
                filename: attachment.filename,
                contentType: attachment.contentType,
                size: attachment.size ?? 0,
                fileId: attachment.fileId,
              },
            ]
          : [],
      );
      const messageId = await ctx.db.insert("threadMessages", {
        threadId: thread._id,
        orgId: connection.clientOrgId,
        channel: "slack",
        role: "user",
        userId:
          isDirectMessage && actorUserId
            ? actorUserId
            : connection.serviceUserId,
        userName: actor.displayName,
        slackActorId: actor._id,
        slackTeamId: event.teamId,
        slackUserId: event.senderUserId,
        slackMessageTs: event.messageTs,
        content:
          event.content ||
          `[Attached ${inboundAttachments.map((attachment) => attachment.filename).join(", ") || "file"}]`,
        attachments: attachments.length ? attachments : undefined,
      });
      if (titleGeneration) {
        await ctx.scheduler.runAfter(0, internal.actions.threadTitle.generate, {
          threadId: thread._id,
          userMessageId: messageId,
          ...titleGeneration,
        });
      }
      await ctx.db.patch(thread._id, {
        lastMessageAt: event.receivedAt,
        archivedAt: undefined,
      });

      if (operator && (event.isPrimaryChannel || !eventMentionsSpot(event))) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "human_paused" });
      } else if (
        authorizedCustomer &&
        (isDirectMessage || eventMentionsSpot(event)) &&
        isResolveCommand(event.content, mentionedBotUserId)
      ) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "resolved" });
      } else if (
        authorizedCustomer &&
        !isDirectMessage &&
        isHumanRequest(event.content, mentionedBotUserId)
      ) {
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        trigger = undefined;
        await ctx.db.patch(thread._id, { slackState: "human_paused" });
        if (!event.isPrimaryChannel) {
          await createHandoff(ctx, {
            connection,
            actorId: actor._id,
            sourceChannelId: event.channelId,
            sourceThreadTs: event.threadTs,
            sourceThreadId: thread._id,
          });
        }
      } else if (
        (authorizedCustomer || operator) &&
        (isDirectMessage ||
          eventMentionsSpot(event) ||
          thread.slackState === "active")
      ) {
        await ctx.db.patch(thread._id, { slackState: "active" });
        if (trigger) await ctx.db.delete(trigger.agentMessageId);
        const agentMessageId = await ctx.db.insert("threadMessages", {
          threadId: thread._id,
          orgId: connection.clientOrgId,
          channel: "slack",
          role: "agent",
          content: "",
          status: "processing",
          replyToMessageId: messageId,
        });
        trigger = {
          threadId: thread._id,
          userMessageId: messageId,
          agentMessageId,
          actorId: actor._id,
          channelId: event.channelId,
          threadTs: isDirectMessage ? event.replyThreadTs : event.threadTs,
        };
      }
      await ctx.db.patch(event._id, { status: "completed", updatedAt: now });
    }

    if (trigger && args.slackThreadContext) {
      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("thread", (q) => q.eq("threadId", trigger.threadId))
        .order("desc")
        .take(256);
      const knownMessageTimestamps = new Set(
        messages.flatMap((message) => [
          ...(message.slackMessageTs ? [message.slackMessageTs] : []),
          ...slackThreadContextMessageTimestamps(message.toolArtifacts),
        ]),
      );
      const currentMessage = messages.find(
        (message) => message._id === trigger.userMessageId,
      );
      const contextArtifact = createSlackThreadContextArtifact(
        args.slackThreadContext,
        {
          knownMessageTimestamps,
          latestMessageTs: currentMessage?.slackMessageTs,
        },
      );
      if (contextArtifact && currentMessage) {
        await ctx.db.patch(currentMessage._id, {
          toolArtifacts: [
            ...(currentMessage.toolArtifacts ?? []),
            contextArtifact,
          ],
        });
      }
    }

    return trigger
      ? {
          ...trigger,
          orgId: connection.clientOrgId,
          serviceUserId: connection.serviceUserId,
          connectionId: connection._id,
        }
      : null;
  },
});

export const getMessage = internalQuery({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => await ctx.db.get(args.messageId),
});

export const getInboundEvent = internalQuery({
  args: { eventId: v.id("slackInboundEvents") },
  handler: async (ctx, args) => await ctx.db.get(args.eventId),
});

export const failEvents = internalMutation({
  args: { eventIds: v.array(v.id("slackInboundEvents")), error: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      if (event?.status === "processing") {
        const shouldRetry = event.attemptCount < 3;
        const scheduledFor = shouldRetry
          ? dayjs()
              .add(
                slackRetryDelayMs(args.error, event.attemptCount),
                "millisecond",
              )
              .valueOf()
          : event.scheduledFor;
        await ctx.db.patch(eventId, {
          status: shouldRetry ? "queued" : "error",
          error: args.error,
          scheduledFor,
          updatedAt: now,
        });
        if (shouldRetry) {
          await ctx.scheduler.runAt(
            scheduledFor,
            internalApi.actions.handleInboundSlack.processDebounced,
            { eventId },
          );
        }
      }
    }
  },
});

export const recordAgentActions = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    threadMessageId: v.id("threadMessages"),
    slackActorId: v.id("slackActors"),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const call of args.toolCalls) {
      await ctx.db.insert("agentActionAuditEvents", {
        orgId: args.orgId,
        threadId: args.threadId,
        threadMessageId: args.threadMessageId,
        actorKind: "slack",
        slackActorId: args.slackActorId,
        authorizationKind: "slack_workspace",
        action: call.name,
        input: call.input,
        output: call.output,
        status: "succeeded",
        createdAt: dayjs().valueOf(),
      });
    }
  },
});

export const requestHandoffFromAgent = internalMutation({
  args: {
    threadId: v.id("threads"),
    slackActorId: v.id("slackActors"),
  },
  handler: async (ctx, args) => {
    const [thread, actor] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.slackActorId),
    ]);
    if (
      !thread?.slackConnectionId ||
      !thread.slackChannelId ||
      !thread.slackThreadTs ||
      !actor ||
      actor.connectionId !== thread.slackConnectionId
    ) {
      throw new Error("Slack handoff context is unavailable");
    }
    const connection = await ctx.db.get(thread.slackConnectionId);
    if (!connection) throw new Error("Slack connection not found");
    if (thread.slackConversationKind === "direct_message") {
      return { status: "continue_in_primary_channel" as const };
    }
    await ctx.db.patch(thread._id, { slackState: "human_paused" });
    const binding = await primaryBinding(ctx, connection._id);
    const isPrimary = Boolean(
      binding &&
      (binding.hostChannelId === thread.slackChannelId ||
        binding.customerChannelId === thread.slackChannelId),
    );
    if (isPrimary) return { status: "paused" as const };
    const handoffId = await createHandoff(ctx, {
      connection,
      actorId: actor._id,
      sourceChannelId: thread.slackChannelId,
      sourceThreadTs: thread.slackThreadTs,
      sourceThreadId: thread._id,
    });
    return handoffId
      ? { status: "handed_off" as const, handoffId }
      : { status: "paused" as const };
  },
});
