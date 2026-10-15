import { getSessionUserId as getAuthUserId } from "./lib/sessionIdentity";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { isSlackMockMode } from "./lib/slackConfig";
import {
  resolveSlackAutomaticChannel,
  type SlackAutomaticChannelConnection,
  type SlackSupportChannelBinding,
} from "./lib/slackChannelRouting";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const internalApi = internal as any;
const WORKER_TIMEOUT_MS = 30_000;
const MANUAL_SETUP_ERRORS = new Set([
  "not_paid",
  "paid_teams_only",
  "not_allowed",
  "access_denied",
  "enterprise_is_restricted",
  "not_allowed_for_grid_workspace",
  "not_allowed_token_type",
  "not_in_channel",
  "not_owner",
  "not_supported",
  "no_external_invite_permission",
  "no_permission",
  "missing_scope",
  "restricted_action",
  "method_not_supported_for_channel_type",
  "external_invites_disabled",
  "team_access_not_granted",
]);

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function slackErrorCode(message: string | undefined) {
  return message?.split(";")[0]?.trim();
}

type AvailableSlackChannel = {
  id: string;
  name: string;
  isMember: boolean;
  isPrivate: boolean;
  isShared: boolean;
};

async function fetchAvailableChannels(args: {
  teamId: string;
  currentChannelId?: string;
  currentChannelName?: string;
}) {
  const response = await fetch(`${requiredEnv("SLACK_WORKER_URL")}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
  });
  const result = (await response.json()) as {
    channels?: AvailableSlackChannel[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.channels)) {
    throw new Error(result.error ?? "Slack channels could not be loaded");
  }
  return result.channels;
}

async function syncJoinedChannels(
  ctx: ActionCtx,
  args: {
    clientOrgId: Id<"organizations">;
    connectionId: Id<"slackWorkspaceConnections">;
    channels: AvailableSlackChannel[];
  },
) {
  return await ctx.runMutation(
    internalApi.agentChannels.syncSlackChannelMembershipsInternal,
    {
      clientOrgId: args.clientOrgId,
      connectionId: args.connectionId,
      channels: args.channels
        .filter((channel) => channel.isMember)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.isPrivate,
          isShared: channel.isShared,
        })),
    },
  );
}

function resolveInventoryChannel(
  connection: SlackAutomaticChannelConnection,
  supportChannel: SlackSupportChannelBinding | null,
) {
  return resolveSlackAutomaticChannel(
    connection,
    supportChannel && isSlackMockMode() && !supportChannel.customerChannelId
      ? { ...supportChannel, customerChannelId: supportChannel.hostChannelId }
      : supportChannel,
  );
}

export const createPrimaryChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    clientSlug: v.string(),
    inviteEmail: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      {
        clientOrgId: args.clientOrgId,
        userId,
      },
    );
    if (permission.kind !== "operator") {
      throwUserFacingError(
        userFacingErrorCodes.operatorRequired,
        "A Spot operator must create the hosted Slack Connect channel.",
      );
    }
    const [connection, supportContext, existingBinding] = await Promise.all([
      ctx.runQuery(internalApi.slack.getActiveConnection, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getSlackSupportSetupContext, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getPrimarySlackBindingForSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);

    const response = await fetch(
      `${requiredEnv("SLACK_WORKER_URL")}/connect-channel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientSlug: args.clientSlug,
          inviteEmail: args.inviteEmail,
          operatorUserIds: supportContext.linkedOperatorUserIds,
          existingChannelId: existingBinding?.hostChannelId,
          existingChannelName: existingBinding?.channelName,
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      },
    );
    const result = (await response.json()) as {
      channelId?: string;
      channelName?: string;
      inviteId?: string;
      reusedChannel?: boolean;
      operatorInvites?: {
        requested: number;
        succeeded: boolean;
        error?: string;
      };
      supportInvite?: {
        succeeded: boolean;
        pending: boolean;
        error?: string;
      };
      error?: string;
    };
    if (!response.ok || !result.channelId || !result.channelName) {
      const code = result.error ?? `HTTP ${response.status}`;
      return {
        created: false as const,
        manualSetupRequired: MANUAL_SETUP_ERRORS.has(code),
        reason: code,
      };
    }
    await ctx.runMutation(
      internalApi.agentChannels.bindPrimaryChannelInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection?._id,
        operatorUserId: userId,
        hostTeamId: supportContext.hostTeamId,
        hostChannelId: result.channelId,
        channelName: result.channelName,
      },
    );
    await ctx.runMutation(
      internalApi.agentChannels.recordSlackSupportSetupOutcome,
      {
        clientOrgId: args.clientOrgId,
        operatorUserId: userId,
        omittedOperators: supportContext.omittedOperators,
        operatorInvitesSucceeded:
          result.operatorInvites?.succeeded ?? true,
        operatorInviteError: result.operatorInvites?.error,
        supportInviteSucceeded: result.supportInvite?.succeeded ?? true,
        supportInviteError: result.supportInvite?.error,
      },
    );
    const supportInviteError = result.supportInvite?.error;
    const supportInviteCode = slackErrorCode(supportInviteError);
    return {
      created: true as const,
      ...result,
      omittedOperators: supportContext.omittedOperators,
      manualSetupRequired: Boolean(
        supportInviteCode && MANUAL_SETUP_ERRORS.has(supportInviteCode),
      ),
      reason: supportInviteError,
    };
  },
});

export const listAvailableChannels = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internalApi.agentChannels.authorizeSetup, {
      clientOrgId: args.clientOrgId,
      userId,
    });
    const [connection, supportChannel] = await Promise.all([
      ctx.runQuery(internalApi.slack.getActiveConnection, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getPrimarySlackBindingForSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);
    if (!connection) throw new Error("The Slack workspace is not connected");
    const automaticChannel = resolveInventoryChannel(connection, supportChannel);
    const channels = await fetchAvailableChannels({
      teamId: connection.teamId,
      currentChannelId: automaticChannel?.channelId,
      currentChannelName: automaticChannel?.channelName,
    });
    await syncJoinedChannels(ctx, {
      clientOrgId: args.clientOrgId,
      connectionId: connection._id,
      channels,
    });
    return {
      channels,
    };
  },
});

export const selectAutomaticChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const [connection, supportChannel] = await Promise.all([
      ctx.runQuery(internalApi.slack.getActiveConnection, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getPrimarySlackBindingForSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);
    if (!connection) throw new Error("The Slack workspace is not connected");
    const automaticChannel = resolveInventoryChannel(connection, supportChannel);
    const channels = await fetchAvailableChannels({
      teamId: connection.teamId,
      currentChannelId: automaticChannel?.channelId,
      currentChannelName: automaticChannel?.channelName,
    });
    await syncJoinedChannels(ctx, {
      clientOrgId: args.clientOrgId,
      connectionId: connection._id,
      channels,
    });
    const channel = channels.find(
      (candidate) => candidate.id === args.channelId && candidate.isMember,
    );
    if (!channel) {
      throw new Error("Select a Slack channel that Spot has joined");
    }
    await ctx.runMutation(
      internalApi.agentChannels.selectAutomaticSlackChannelInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection._id,
        channelId: channel.id,
        channelName: channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return channel;
  },
});

export const joinPublicChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const connection = await ctx.runQuery(internalApi.slack.getActiveConnection, {
      clientOrgId: args.clientOrgId,
    });
    if (!connection) throw new Error("The Slack workspace is not connected");

    const response = await fetch(
      `${requiredEnv("SLACK_WORKER_URL")}/channels/join`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: connection.teamId,
          channelId: args.channelId,
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      },
    );
    const result = (await response.json()) as {
      channel?: AvailableSlackChannel;
      error?: string;
    };
    if (!response.ok || !result.channel?.isMember) {
      throw new Error(result.error ?? "Spot could not be added to that channel");
    }
    const channels = await fetchAvailableChannels({ teamId: connection.teamId });
    await syncJoinedChannels(ctx, {
      clientOrgId: args.clientOrgId,
      connectionId: connection._id,
      channels,
    });
    await ctx.runMutation(
      internalApi.agentChannels.recordSlackChannelJoinedInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection._id,
        channelId: result.channel.id,
        channelName: result.channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return { channel: result.channel, channels };
  },
});

export const leavePublicChannel = action({
  args: {
    clientOrgId: v.id("organizations"),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const connection = await ctx.runQuery(
      internalApi.slack.getActiveConnection,
      { clientOrgId: args.clientOrgId },
    );
    if (!connection) throw new Error("The Slack workspace is not connected");

    const response = await fetch(
      `${requiredEnv("SLACK_WORKER_URL")}/channels/leave`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredEnv("SLACK_WORKER_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: connection.teamId,
          channelId: args.channelId,
        }),
        signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      },
    );
    const result = (await response.json()) as {
      channel?: AvailableSlackChannel;
      error?: string;
    };
    if (!response.ok || result.channel?.isMember !== false) {
      throw new Error(result.error ?? "Spot could not leave that channel");
    }
    const channels = await fetchAvailableChannels({ teamId: connection.teamId });
    await syncJoinedChannels(ctx, {
      clientOrgId: args.clientOrgId,
      connectionId: connection._id,
      channels,
    });
    await ctx.runMutation(
      internalApi.agentChannels.recordSlackChannelLeftInternal,
      {
        clientOrgId: args.clientOrgId,
        connectionId: connection._id,
        channelId: result.channel.id,
        channelName: result.channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return { channel: result.channel, channels };
  },
});
