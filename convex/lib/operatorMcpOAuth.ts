"use node";

import dayjs from "dayjs";
import { createHash, randomBytes } from "node:crypto";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { encryptPassword, decryptPassword } from "./imapMailbox";
import { mcpOAuthFetch } from "./operatorMcpClient";
import { resolvePublicAddress } from "./websiteBrand";

export type McpOAuthData = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  expiresAt?: number;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
};
export function oauthCallbackUrl() {
  const origin = process.env.CONVEX_SITE_URL;
  if (!origin) throw new Error("CONVEX_SITE_URL is required for MCP OAuth");
  return new URL("/operator-mcp/oauth/callback", origin).toString();
}
export function oauthClientMetadata() {
  return {
    client_name: "Spot",
    redirect_uris: [oauthCallbackUrl()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
export function oauthStateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
export function readOAuthData(encrypted: string): McpOAuthData {
  return JSON.parse(decryptPassword(encrypted)) as McpOAuthData;
}

export async function authorizeMcp(args: {
  serverUrl: string;
  data: McpOAuthData;
  state?: string;
  code?: string;
  refreshOnly?: boolean;
}) {
  let authorizationUrl: string | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: oauthCallbackUrl(),
    clientMetadata: oauthClientMetadata(),
    clientMetadataUrl: process.env.CONVEX_SITE_URL?.startsWith("https://")
      ? new URL(
          "/operator-mcp/oauth/client-metadata.json",
          process.env.CONVEX_SITE_URL,
        ).toString()
      : undefined,
    state: () => args.state ?? "",
    clientInformation: () => args.data.clientInformation,
    saveClientInformation: (value) => {
      args.data.clientInformation = value;
    },
    tokens: () => args.data.tokens,
    saveTokens: (tokens) => {
      args.data.tokens = {
        ...tokens,
        refresh_token: tokens.refresh_token ?? args.data.tokens?.refresh_token,
      };
      args.data.expiresAt =
        tokens.expires_in === undefined
          ? undefined
          : dayjs().add(tokens.expires_in, "second").valueOf();
    },
    saveCodeVerifier: (value) => {
      args.data.verifier = value;
    },
    codeVerifier: () => {
      if (!args.data.verifier) throw new Error("Missing OAuth verifier");
      return args.data.verifier;
    },
    discoveryState: () => args.data.discovery,
    saveDiscoveryState: (value) => {
      args.data.discovery = value;
    },
    redirectToAuthorization: async (url) => {
      if (args.refreshOnly)
        throw new Error(
          "OAuth authorization is no longer valid. Reconnect this server in Settings.",
        );
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Error("Invalid OAuth authorization endpoint");
      await resolvePublicAddress(url.hostname);
      authorizationUrl = url.toString();
    },
  };
  let result: "AUTHORIZED" | "REDIRECT";
  try {
    result = await auth(provider, {
      serverUrl: args.serverUrl,
      authorizationCode: args.code,
      fetchFn: mcpOAuthFetch,
    });
  } catch {
    throw new Error(
      "OAuth authorization failed. Check the server and OAuth client settings, then reconnect.",
    );
  }
  return { result, authorizationUrl };
}

export async function mcpServerToken(
  ctx: ActionCtx,
  server: Doc<"operatorMcpServers">,
  operatorUserId: Id<"users">,
): Promise<string | undefined> {
  if (server.authType !== "oauth")
    return server.encryptedToken
      ? decryptPassword(server.encryptedToken)
      : undefined;
  if (!server.encryptedOAuth)
    throw new Error("Connect this MCP server with OAuth in Settings.");
  let data = readOAuthData(server.encryptedOAuth);
  if (
    data.tokens?.access_token &&
    (data.expiresAt === undefined ||
      data.expiresAt > dayjs().add(30, "second").valueOf())
  )
    return data.tokens.access_token;
  if (!data.tokens?.refresh_token)
    throw new Error("OAuth expired. Reconnect this server in Settings.");
  const lease = randomBytes(24).toString("hex");
  const claim = await ctx.runMutation(internal.operatorMcpOAuth.claimRefresh, {
    operatorUserId,
    serverId: server._id,
    revision: server.revision,
    expectedEncrypted: server.encryptedOAuth,
    lease,
  });
  if (!claim.claimed) {
    data = readOAuthData(claim.encryptedOAuth);
    if (
      !data.tokens?.access_token ||
      (data.expiresAt !== undefined && data.expiresAt <= dayjs().valueOf())
    )
      throw new Error("OAuth expired. Reconnect this server.");
    return data.tokens.access_token;
  }
  try {
    await authorizeMcp({ serverUrl: server.url, data, refreshOnly: true });
    if (!data.tokens?.access_token)
      throw new Error("OAuth refresh did not return an access token");
    await ctx.runMutation(internal.operatorMcpOAuth.finishRefresh, {
      serverId: server._id,
      lease,
      encryptedOAuth: encryptPassword(JSON.stringify(data)),
    });
    return data.tokens.access_token;
  } catch (error) {
    await ctx
      .runMutation(internal.operatorMcpOAuth.finishRefresh, {
        serverId: server._id,
        lease,
      })
      .catch(() => undefined);
    throw error;
  }
}
