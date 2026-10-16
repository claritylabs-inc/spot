"use node";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import dayjs from "dayjs";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const internalApi = internal as any;
const REQUEST_TIMEOUT_MS = 30_000;
const REFRESH_EARLY_MS = 5 * 60 * 1_000;

export class SlackCredentialRefreshInProgressError extends Error {
  constructor() {
    super("Slack token refresh is in progress; retry the request");
    this.name = "SlackCredentialRefreshInProgressError";
  }
}

type EncryptedValue = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

type SlackTokenResponse = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  bot_user_id?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encryptionKey() {
  return createHash("sha256")
    .update(requiredEnv("SLACK_TOKEN_ENCRYPTION_KEY"))
    .digest();
}

export function encryptSlackCredential(value: string, teamId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(teamId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const payload: EncryptedValue = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptSlackCredential(
  encrypted: string,
  teamId: string,
): string {
  const payload = JSON.parse(encrypted) as EncryptedValue;
  if (payload.v !== 1) throw new Error("Unsupported Slack credential version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(teamId, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function refreshSlackToken(
  ctx: ActionCtx,
  installation: {
    _id: Id<"slackInstallations">;
    teamId: string;
    encryptedRefreshToken?: string;
    botUserId?: string;
  },
) {
  const claim = await ctx.runMutation(
    internalApi.agentChannels.claimSlackCredentialRefresh,
    { installationId: installation._id },
  );
  if (!claim.claimed) {
    if (
      claim.reason === "fresh" &&
      claim.installation.encryptedBotToken &&
      (!claim.installation.botTokenExpiresAt ||
        claim.installation.botTokenExpiresAt >
          dayjs().add(10, "second").valueOf())
    ) {
      return {
        teamId: claim.installation.teamId,
        botToken: decryptSlackCredential(
          claim.installation.encryptedBotToken,
          claim.installation.teamId,
        ),
        botUserId: claim.installation.botUserId,
        expiresAt: claim.installation.botTokenExpiresAt,
      };
    }
    throw new SlackCredentialRefreshInProgressError();
  }
  if (!claim.installation.encryptedRefreshToken) {
    await ctx.runMutation(
      internalApi.agentChannels.releaseSlackCredentialRefresh,
      { installationId: installation._id },
    );
    throw new Error("Slack access token expired; reinstall the workspace");
  }
  try {
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${requiredEnv("SLACK_CLIENT_ID")}:${requiredEnv("SLACK_CLIENT_SECRET")}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSlackCredential(
          claim.installation.encryptedRefreshToken,
          installation.teamId,
        ),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const token = (await response.json()) as SlackTokenResponse;
    if (!response.ok || !token.ok || !token.access_token) {
      throw new Error(token.error || "Slack token refresh failed");
    }
    const expiresAt = token.expires_in
      ? dayjs().add(token.expires_in, "second").valueOf()
      : undefined;
    await ctx.runMutation(internalApi.agentChannels.updateSlackCredentials, {
      installationId: installation._id,
      encryptedBotToken: encryptSlackCredential(
        token.access_token,
        installation.teamId,
      ),
      encryptedRefreshToken: token.refresh_token
        ? encryptSlackCredential(token.refresh_token, installation.teamId)
        : claim.installation.encryptedRefreshToken,
      botTokenExpiresAt: expiresAt,
    });
    return {
      teamId: installation.teamId,
      botToken: token.access_token,
      botUserId: token.bot_user_id ?? installation.botUserId,
      expiresAt,
    };
  } catch (error) {
    await ctx.runMutation(
      internalApi.agentChannels.releaseSlackCredentialRefresh,
      { installationId: installation._id },
    );
    throw error;
  }
}

export async function resolveSlackInstallation(
  ctx: ActionCtx,
  teamId: string,
) {
  const installation = await ctx.runQuery(
    internalApi.agentChannels.getSlackCredentialsByTeamId,
    { teamId },
  );
  if (!installation?.encryptedBotToken) {
    throw new Error("Slack installation credentials were not found");
  }
  if (
    installation.botTokenExpiresAt &&
    installation.botTokenExpiresAt <=
      dayjs().add(REFRESH_EARLY_MS, "millisecond").valueOf()
  ) {
    return await refreshSlackToken(ctx, installation);
  }
  return {
    teamId: installation.teamId,
    botToken: decryptSlackCredential(
      installation.encryptedBotToken,
      installation.teamId,
    ),
    botUserId: installation.botUserId,
    expiresAt: installation.botTokenExpiresAt,
  };
}
