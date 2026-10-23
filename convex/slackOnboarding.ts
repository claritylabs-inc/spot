"use node";

import { getSessionUserId as getAuthUserId } from "./lib/sessionIdentity";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { isSlackMockMode } from "./lib/slackConfig";
import { slackWebApi, type SlackChannel } from "./lib/slackWebApi";
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

function slackErrorCode(message: string | undefined) {
  return message?.split(";")[0]?.trim();
}

async function syncJoinedChannels(
  ctx: ActionCtx,
  args: {
    clientOrgId: Id<"organizations">;
    connectionId: Id<"slackWorkspaceConnections">;
    channels: SlackChannel[];
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

    let result;
    try {
      result = await slackWebApi(ctx).createConnectChannel({
        clientSlug: args.clientSlug,
        inviteEmail: args.inviteEmail,
        operatorUserIds: supportContext.linkedOperatorUserIds,
        existingChannelId: existingBinding?.hostChannelId,
        existingChannelName: existingBinding?.channelName,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
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
        operatorInvitesSucceeded: result.operatorInvites.succeeded,
        operatorInviteError: result.operatorInvites.error,
        supportInviteSucceeded: result.supportInvite.succeeded,
        supportInviteError: result.supportInvite.error,
      },
    );
    const supportInviteError = result.supportInvite.error;
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
    const automaticChannel = resolveInventoryChannel(
      connection,
      supportChannel,
    );
    const channels = await slackWebApi(ctx).listChannels({
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
    const automaticChannel = resolveInventoryChannel(
      connection,
      supportChannel,
    );
    const channels = await slackWebApi(ctx).listChannels({
      teamId: connection.teamId,
      currentChannelId: automaticChannel?.channelId,
      currentChannelName: automaticChannel?.channelName,
    });
    await syncJoinedChannels(ctx, {
      clientOrgId: args.clientOrgId,
      connectionId: connection._id,
      channels,
    });
    const channel = await slackWebApi(ctx).assertJoinedChannel({
      teamId: connection.teamId,
      channelId: args.channelId,
    });
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
    const connection = await ctx.runQuery(
      internalApi.slack.getActiveConnection,
      {
        clientOrgId: args.clientOrgId,
      },
    );
    if (!connection) throw new Error("The Slack workspace is not connected");

    const slack = slackWebApi(ctx);
    const channel = await slack.joinPublicChannel({
      teamId: connection.teamId,
      channelId: args.channelId,
    });
    if (!channel.isMember) {
      throw new Error("Spot could not be added to that channel");
    }
    const channels = await slack.listChannels({ teamId: connection.teamId });
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
        channelId: channel.id,
        channelName: channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return { channel, channels };
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

    const slack = slackWebApi(ctx);
    const channel = await slack.leavePublicChannel({
      teamId: connection.teamId,
      channelId: args.channelId,
    });
    if (channel.isMember) throw new Error("Spot could not leave that channel");
    const channels = await slack.listChannels({ teamId: connection.teamId });
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
        channelId: channel.id,
        channelName: channel.name,
        actorUserId: userId,
        actorKind: permission.kind,
      },
    );
    return { channel, channels };
  },
});
