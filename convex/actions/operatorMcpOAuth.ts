"use node";

import { randomBytes } from "node:crypto";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { encryptPassword, decryptPassword } from "../lib/imapMailbox";
import {
  authorizeMcp,
  oauthClientMetadata,
  oauthStateHash,
  readOAuthData,
  type McpOAuthData,
} from "../lib/operatorMcpOAuth";
import { discoverMcpTools, withMcpClient } from "../lib/operatorMcpClient";
import { getAuthSiteUrl } from "../lib/domains";

export const connect = action({
  args: { serverId: v.id("operatorMcpServers") },
  handler: async (ctx, args): Promise<{ authorizationUrl: string }> => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Sign in required");
    const server = await ctx.runQuery(
      internal.operatorMcpServers.configuration,
      { operatorUserId, serverId: args.serverId },
    );
    if (!server || server.authType !== "oauth")
      throw new Error("Select OAuth authentication first");
    const previous = server.encryptedOAuth
      ? readOAuthData(server.encryptedOAuth)
      : undefined;
    const data: McpOAuthData = {
      clientInformation: server.oauthClientId
        ? {
            client_id: server.oauthClientId,
            client_secret: server.encryptedOAuthClientSecret
              ? decryptPassword(server.encryptedOAuthClientSecret)
              : undefined,
          }
        : previous?.clientInformation,
      discovery: previous?.discovery,
    };
    const state = randomBytes(32).toString("base64url");
    const result = await authorizeMcp({ serverUrl: server.url, data, state });
    if (!result.authorizationUrl)
      throw new Error("OAuth server did not provide an authorization URL");
    await ctx.runMutation(internal.operatorMcpOAuth.createSession, {
      operatorUserId,
      serverId: server._id,
      serverRevision: server.revision,
      stateHash: oauthStateHash(state),
      encryptedData: encryptPassword(JSON.stringify(data)),
    });
    return { authorizationUrl: result.authorizationUrl };
  },
});

export const callback = internalAction({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
    issuer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const redirect = new URL("/operator/settings?section=mcp", getAuthSiteUrl());
    let sessionId;
    try {
      if (args.state.length > 200 || (args.code?.length ?? 0) > 4000)
        throw new Error("Invalid OAuth callback");
      const { session, server } = await ctx.runMutation(
        internal.operatorMcpOAuth.consumeSession,
        { stateHash: oauthStateHash(args.state) },
      );
      sessionId = session._id;
      if (args.error || !args.code)
        throw new Error("OAuth authorization was not completed");
      const data = readOAuthData(session.encryptedData);
      if (
        args.issuer &&
        args.issuer !== data.discovery?.authorizationServerMetadata?.issuer
      )
        throw new Error("OAuth issuer changed");
      await authorizeMcp({ serverUrl: server.url, data, code: args.code });
      if (!data.tokens?.access_token)
        throw new Error("OAuth did not return an access token");
      delete data.verifier;
      const tools = await withMcpClient(
        server.url,
        data.tokens.access_token,
        discoverMcpTools,
      );
      await ctx.runMutation(internal.operatorMcpOAuth.finishSession, {
        id: session._id,
        encryptedOAuth: encryptPassword(JSON.stringify(data)),
        toolsJson: JSON.stringify(tools),
      });
      redirect.searchParams.set("mcp", "connected");
    } catch {
      redirect.searchParams.set("mcp", "oauth_error");
    } finally {
      if (sessionId)
        await ctx.runMutation(internal.operatorMcpOAuth.cleanupSession, {
          id: sessionId,
        });
    }
    return redirect.toString();
  },
});

export const clientMetadata = internalAction({
  args: {},
  handler: async () => oauthClientMetadata(),
});
