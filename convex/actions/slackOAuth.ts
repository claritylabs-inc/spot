"use node";

import { getSessionUserId as getAuthUserId } from "../lib/sessionIdentity";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  missingSlackHostScopes,
  missingSlackCustomerScopes,
  SLACK_CUSTOMER_SCOPES,
  SLACK_HOST_SCOPES,
  SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
} from "../lib/slackOAuthPolicy";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";
import { getSlackHostConfiguration, isSlackMockMode } from "../lib/slackConfig";
import {
  encryptSlackCredential,
  resolveSlackInstallation,
} from "../lib/slackCredentials";
import { buildSlackInstallInviteEmail } from "../lib/emailTemplate";
import { getAuthFromAddress, sendResendEmail } from "../lib/resend";
import { getAuthSiteUrl } from "../lib/domains";
import dayjs from "dayjs";

const internalApi = internal as any;
const REQUEST_TIMEOUT_MS = 30_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function redirectUri(): string {
  return (
    process.env.SLACK_OAUTH_REDIRECT_URI?.trim() ||
    `${requiredEnv("CONVEX_SITE_URL")}/slack/oauth/callback`
  );
}

function slackOAuthAuthorization(): string {
  return `Basic ${Buffer.from(
    `${requiredEnv("SLACK_CLIENT_ID")}:${requiredEnv("SLACK_CLIENT_SECRET")}`,
  ).toString("base64")}`;
}

function customerOAuthUrl(state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", requiredEnv("SLACK_CLIENT_ID"));
  url.searchParams.set("scope", SLACK_CUSTOMER_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  return url.toString();
}

function normalizeInviteEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid client admin email address");
  }
  return email;
}

function settingsRedirect(
  params: Record<string, string>,
  clientOrgId?: Id<"organizations">,
): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "https://app.spot.insure";
  const url = new URL(
    clientOrgId
      ? "/settings?section=agent&tab=channels"
      : "/settings?section=agent",
    base,
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export const begin = action({
  args: {
    clientOrgId: v.id("organizations"),
    thirdPartyVisibilityAcknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    if (!args.thirdPartyVisibilityAcknowledged) {
      throw new Error(
        "Acknowledge that everyone in a channel can see Spot responses before installing.",
      );
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const permission = await ctx.runQuery(
      internalApi.agentChannels.authorizeSetup,
      { clientOrgId: args.clientOrgId, userId },
    );
    const [setup, existing] = await Promise.all([
      ctx.runQuery(internalApi.agentChannels.getSlackSetupForAction, {
        clientOrgId: args.clientOrgId,
      }),
      ctx.runQuery(internalApi.agentChannels.getSlackConnectionForMockSetup, {
        clientOrgId: args.clientOrgId,
      }),
    ]);
    if (permission.kind === "operator") {
      if (!setup || setup.status !== "in_progress") {
        throw new Error("Start Slack setup before connecting the workspace");
      }
    } else if (
      !existing ||
      (existing.status === "active" && existing.healthStatus !== "degraded")
    ) {
      throw new Error(
        "A client administrator can reinstall Slack only when the retained connection needs recovery.",
      );
    }
    if (isSlackMockMode()) {
      await ctx.runMutation(internalApi.agentChannels.upsertSlackConnection, {
        clientOrgId: args.clientOrgId,
        teamId: existing?.teamId ?? `T-MOCK-${args.clientOrgId}`,
        teamName:
          existing?.teamName ?? `${permission.org.name} local workspace`,
        botUserId: existing?.botUserId ?? "U-SPOT",
        grantedScopes: [...SLACK_CUSTOMER_SCOPES],
        ...(permission.kind === "operator"
          ? { installedByOperatorUserId: userId }
          : { installedByUserId: userId }),
      });
      if (setup?.status === "in_progress") {
        await ctx.runMutation(
          internalApi.agentChannels.markSlackSetupInstallationComplete,
          { setupStateId: setup._id },
        );
      }
      return { url: null, mockRefreshed: true as const };
    }
    const state = await ctx.runMutation(
      internalApi.agentChannels.createOAuthState,
      {
        clientOrgId: args.clientOrgId,
        userId,
        actorKind: permission.kind,
        setupStateId: setup?.status === "in_progress" ? setup._id : undefined,
      },
    );
    return { url: customerOAuthUrl(state), mockRefreshed: false as const };
  },
});

export const sendInstallInvite = action({
  args: {
    clientOrgId: v.id("organizations"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.SLACK_ENABLED !== "true") {
      throw new Error("Slack is not enabled for this environment");
    }
    if (isSlackMockMode()) {
      throw new Error("Slack install invitations require live Slack mode");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const recipientEmail = normalizeInviteEmail(args.recipientEmail);
    const context = await ctx.runQuery(
      internalApi.agentChannels.authorizeSlackInstallInvite,
      { clientOrgId: args.clientOrgId, userId },
    );
    const oauthState = await ctx.runMutation(
      internalApi.agentChannels.createSlackInstallInviteOAuthState,
      {
        clientOrgId: args.clientOrgId,
        setupStateId: context.setupStateId,
        operatorUserId: userId,
        recipientEmail,
        expiresInDays: SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
      },
    );
    const email = buildSlackInstallInviteEmail({
      clientName: context.clientName,
      installUrl: customerOAuthUrl(oauthState.state),
      mode: context.setupMode === "reinstall" ? "update" : "install",
      expiresInDays: SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
      siteUrl: getAuthSiteUrl(),
    });
    const result = await sendResendEmail(
      ctx,
      userId,
      {
        from: getAuthFromAddress(),
        to: recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      { retries: 2 },
    );
    if (!result.ok) {
      await ctx.runMutation(
        internalApi.agentChannels.invalidateSlackOAuthState,
        { stateId: oauthState.stateId },
      );
      throw new Error(
        `Failed to send Slack install invitation: ${result.error}`,
      );
    }
    await ctx.runMutation(
      internalApi.agentChannels.recordSlackInstallInviteSent,
      {
        clientOrgId: args.clientOrgId,
        setupStateId: context.setupStateId,
        operatorUserId: userId,
        recipientEmail,
        expiresAt: oauthState.expiresAt,
      },
    );
    return {
      recipientEmail,
      expiresInDays: SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
      expiresAt: oauthState.expiresAt,
      mode: context.setupMode,
    };
  },
});

export const beginHost = action({
  args: {},
  handler: async (ctx) => {
    const configuration = getSlackHostConfiguration();
    if (configuration.mode === "mock") {
      throw new Error("Slack OAuth is unavailable in mock mode");
    }
    if (!configuration.configured) {
      throw new Error(
        "Slack host setup is not configured for this environment",
      );
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const authorized = await ctx.runQuery(
      internalApi.agentChannels.authorizeSlackHostSetup,
      { userId },
    );
    if (!authorized) {
      throwUserFacingError(userFacingErrorCodes.operatorRequired);
    }
    const state = await ctx.runMutation(
      internalApi.agentChannels.createHostOAuthState,
      { userId },
    );
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", requiredEnv("SLACK_CLIENT_ID"));
    url.searchParams.set("scope", SLACK_HOST_SCOPES.join(","));
    url.searchParams.set("team", requiredEnv("SLACK_CLARITY_TEAM_ID"));
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    return { url: url.toString() };
  },
});

type SlackOAuthResponse = {
  ok?: boolean;
  error?: string;
  app_id?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
};

async function uninstallSlackApp(token: string): Promise<void> {
  await fetch("https://slack.com/api/apps.uninstall", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requiredEnv("SLACK_CLIENT_ID"),
      client_secret: requiredEnv("SLACK_CLIENT_SECRET"),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined);
}

export const complete = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args) => {
    if (isSlackMockMode()) {
      return settingsRedirect({ slack: "error", reason: "mock_mode" });
    }
    const state = await ctx.runMutation(
      internalApi.agentChannels.claimOAuthState,
      { state: args.state },
    );
    if (!state) {
      return settingsRedirect({ slack: "error", reason: "invalid_state" });
    }

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization: slackOAuthAuthorization(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: args.code,
        redirect_uri: redirectUri(),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const token = (await tokenResponse.json()) as SlackOAuthResponse;
    if (
      !tokenResponse.ok ||
      !token.ok ||
      !token.access_token ||
      !token.team?.id
    ) {
      return settingsRedirect(
        {
          slack: "error",
          reason: token.error || "oauth_exchange_failed",
        },
        state.clientOrgId,
      );
    }

    const purpose = state.purpose ?? "customer";
    const isCustomerInstall = purpose !== "host";
    const clientOrgId = state.clientOrgId;
    if (isCustomerInstall && !clientOrgId) {
      await uninstallSlackApp(token.access_token);
      return settingsRedirect({
        slack: "error",
        reason: "missing_customer_organization",
      });
    }
    if (
      purpose === "host" &&
      token.team.id !== requiredEnv("SLACK_CLARITY_TEAM_ID")
    ) {
      await uninstallSlackApp(token.access_token);
      return settingsRedirect({
        slack: "error",
        reason: "wrong_host_workspace",
      });
    }

    const setup = state.setupStateId
      ? await ctx.runQuery(internalApi.agentChannels.getSlackSetupForAction, {
          clientOrgId: clientOrgId!,
        })
      : null;
    const existingConnection = isCustomerInstall
      ? await ctx.runQuery(
          internalApi.agentChannels.getSlackConnectionForMockSetup,
          {
            clientOrgId: clientOrgId!,
          },
        )
      : null;
    const teamConnection = isCustomerInstall
      ? await ctx.runQuery(
          internalApi.agentChannels.getActiveSlackConnectionByTeamId,
          { teamId: token.team.id },
        )
      : null;
    if (
      state.setupStateId &&
      (!setup ||
        setup._id !== state.setupStateId ||
        setup.status !== "in_progress")
    ) {
      if (!existingConnection && !teamConnection) {
        await uninstallSlackApp(token.access_token);
      }
      return settingsRedirect(
        { slack: "error", reason: "setup_not_in_progress" },
        clientOrgId,
      );
    }
    if (existingConnection && existingConnection.teamId !== token.team.id) {
      return settingsRedirect(
        { slack: "error", reason: "wrong_workspace" },
        clientOrgId,
      );
    }
    if (teamConnection && teamConnection.clientOrgId !== clientOrgId) {
      return settingsRedirect(
        { slack: "error", reason: "workspace_already_connected" },
        clientOrgId,
      );
    }
    if (!token.app_id) {
      return settingsRedirect(
        { slack: "error", reason: "missing_app_identity" },
        clientOrgId,
      );
    }
    if (!token.bot_user_id) {
      return settingsRedirect(
        { slack: "error", reason: "missing_bot_identity" },
        clientOrgId,
      );
    }
    if (
      existingConnection?.appId &&
      existingConnection.appId !== token.app_id
    ) {
      return settingsRedirect(
        { slack: "error", reason: "wrong_app" },
        clientOrgId,
      );
    }
    if (
      existingConnection?.botUserId &&
      existingConnection.botUserId !== token.bot_user_id
    ) {
      return settingsRedirect(
        { slack: "error", reason: "wrong_bot_identity" },
        clientOrgId,
      );
    }
    const repairingExistingWorkspace = Boolean(
      existingConnection?.teamId === token.team.id,
    );
    const grantedScopes = (token.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    const missingScopes =
      purpose === "host"
        ? missingSlackHostScopes(grantedScopes)
        : missingSlackCustomerScopes(grantedScopes);
    if (missingScopes.length > 0) {
      if (!repairingExistingWorkspace) {
        await uninstallSlackApp(token.access_token);
      }
      return settingsRedirect(
        {
          slack: "error",
          reason: "missing_scopes",
          scopes: missingScopes.join(","),
        },
        clientOrgId,
      );
    }

    try {
      const credentialArgs = {
        teamId: token.team.id,
        teamName: token.team.name || token.team.id,
        appId: token.app_id,
        encryptedBotToken: encryptSlackCredential(
          token.access_token,
          token.team.id,
        ),
        encryptedRefreshToken: token.refresh_token
          ? encryptSlackCredential(token.refresh_token, token.team.id)
          : undefined,
        botTokenExpiresAt: token.expires_in
          ? dayjs().add(token.expires_in, "second").valueOf()
          : undefined,
        botUserId: token.bot_user_id,
        grantedScopes,
      };
      if (purpose === "host") {
        if (!state.initiatedByOperatorUserId) {
          throw new Error("Slack host installation requires an operator");
        }
        await ctx.runMutation(
          internalApi.agentChannels.upsertSlackHostInstallation,
          {
            ...credentialArgs,
            installedByOperatorUserId: state.initiatedByOperatorUserId,
          },
        );
      } else {
        await ctx.runMutation(internalApi.agentChannels.upsertSlackConnection, {
          ...credentialArgs,
          clientOrgId,
          installedByUserId: state.initiatedByUserId,
          installedByOperatorUserId: state.initiatedByOperatorUserId,
        });
        if (state.setupStateId) {
          await ctx.runMutation(
            internalApi.agentChannels.markSlackSetupInstallationComplete,
            { setupStateId: state.setupStateId },
          );
        }
      }
    } catch (error) {
      if (!repairingExistingWorkspace) {
        await uninstallSlackApp(token.access_token);
        await ctx
          .runMutation(internalApi.agentChannels.revokeByTeamId, {
            teamId: token.team.id,
          })
          .catch(() => undefined);
      }
      return settingsRedirect(
        {
          slack: "error",
          reason: error instanceof Error ? error.message : "connection_failed",
        },
        clientOrgId,
      );
    }
    return settingsRedirect(
      purpose === "host" ? { slack_host: "connected" } : { slack: "connected" },
      clientOrgId,
    );
  },
});

export const disconnect = action({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const authorized = await ctx.runQuery(
      internalApi.agentChannels.authorizeDisconnect,
      { clientOrgId: args.clientOrgId, userId },
    );
    if (!authorized) return { disconnected: false };

    if (!isSlackMockMode() && authorized.connection.nativeInstallationId) {
      const installation = await resolveSlackInstallation(
        ctx,
        authorized.connection.teamId,
      );
      const response = await fetch("https://slack.com/api/apps.uninstall", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${installation.botToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: requiredEnv("SLACK_CLIENT_ID"),
          client_secret: requiredEnv("SLACK_CLIENT_SECRET"),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || `Slack uninstall failed (${response.status})`,
        );
      }
    }
    await ctx.runMutation(internalApi.agentChannels.disconnectInternal, {
      connectionId: authorized.connection._id,
      actorUserId: userId,
      actorKind: authorized.actorKind,
    });
    return { disconnected: true };
  },
});
