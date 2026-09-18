"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mcpServerToken } from "../lib/operatorMcpOAuth";
import { encryptPassword, decryptPassword } from "../lib/imapMailbox";
import {
  discoverMcpTools,
  mcpHttpsUrl,
  withMcpClient,
} from "../lib/operatorMcpClient";
import { parseOperatorAgentToolInput } from "../lib/operatorAgentToolRegistry";

export const save = action({
  args: {
    serverId: v.optional(v.id("operatorMcpServers")),
    revision: v.optional(v.number()),
    name: v.string(),
    url: v.string(),
    logoUrl: v.optional(v.string()),
    enabled: v.boolean(),
    token: v.optional(v.string()),
    authType: v.optional(v.union(v.literal("bearer"), v.literal("oauth"))),
    oauthClientId: v.optional(v.string()),
    oauthClientSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"operatorMcpServers">> => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Sign in required");
    const existing = await ctx.runQuery(
      internal.operatorMcpServers.configuration,
      { operatorUserId, serverId: args.serverId },
    );
    if (args.serverId && (!existing || existing.revision !== args.revision))
      throw new Error("Server changed. Reopen settings and try again.");
    const name = args.name.trim();
    if (!name || name.length > 100)
      throw new Error("Enter a server name of up to 100 characters");
    if (
      args.url.length > 2000 ||
      (args.logoUrl?.length ?? 0) > 2000 ||
      (args.token?.length ?? 0) > 8000 ||
      /[\r\n]/.test(args.token ?? "")
    )
      throw new Error("Invalid server settings");
    const url = mcpHttpsUrl(args.url);
    const logoUrl = args.logoUrl?.trim()
      ? mcpHttpsUrl(args.logoUrl.trim())
      : undefined;
    const authType = args.authType ?? existing?.authType ?? "bearer";
    if (
      (args.oauthClientId?.length ?? 0) > 2000 ||
      (args.oauthClientSecret?.length ?? 0) > 8000
    )
      throw new Error("OAuth client credentials are too long");
    const oauthClientId =
      authType === "oauth"
        ? args.oauthClientId?.trim() || undefined
        : undefined;
    if (
      authType === "oauth" &&
      existing &&
      existing.url !== url &&
      oauthClientId === existing.oauthClientId &&
      existing.encryptedOAuthClientSecret &&
      args.oauthClientSecret === undefined
    )
      throw new Error(
        "Re-enter the OAuth client secret when changing the endpoint",
      );
    let encryptedOAuthClientSecret: string | undefined;
    if (authType === "oauth" && oauthClientId) {
      if (
        args.oauthClientSecret === undefined &&
        existing?.oauthClientId === oauthClientId
      ) {
        encryptedOAuthClientSecret = existing.encryptedOAuthClientSecret;
      } else if (args.oauthClientSecret) {
        encryptedOAuthClientSecret = encryptPassword(args.oauthClientSecret);
      }
    }
    const preserveOAuth =
      authType === "oauth" &&
      existing?.authType === "oauth" &&
      existing.url === url &&
      existing.oauthClientId === oauthClientId &&
      args.oauthClientSecret === undefined;
    if (
      authType === "bearer" &&
      existing &&
      existing.url !== url &&
      args.token === undefined &&
      existing.encryptedToken
    )
      throw new Error("Re-enter the bearer token when changing the endpoint");
    let encryptedToken: string | undefined;
    if (authType === "bearer") {
      encryptedToken =
        args.token === undefined
          ? existing?.encryptedToken
          : args.token
            ? encryptPassword(args.token)
            : undefined;
    }
    const enabled =
      args.enabled &&
      (authType !== "oauth" ||
        Boolean(preserveOAuth && existing?.encryptedOAuth));
    let token: string | undefined;
    if (enabled) {
      if (authType === "oauth" && existing)
        token = await mcpServerToken(ctx, existing, operatorUserId);
      else if (encryptedToken) token = decryptPassword(encryptedToken);
    }
    // Disabling must remain possible while the remote service is unavailable.
    const tools = enabled
      ? await withMcpClient(url, token, discoverMcpTools)
      : [];
    return await ctx.runMutation(internal.operatorMcpServers.saveInternal, {
      operatorUserId,
      serverId: args.serverId,
      revision: args.revision,
      name,
      url,
      logoUrl,
      enabled,
      authType,
      oauthClientId,
      encryptedOAuthClientSecret,
      preserveOAuth,
      encryptedToken,
      toolsJson: JSON.stringify(tools),
    });
  },
});

export const run = internalAction({
  args: { operatorUserId: v.id("users"), toolName: v.string(), input: v.any() },
  handler: async (ctx, args): Promise<{ result: unknown }> => {
    if (args.toolName === "list_mcp_tools") {
      const input = parseOperatorAgentToolInput("list_mcp_tools", args.input);
      return {
        result: await ctx.runQuery(internal.operatorMcpServers.catalog, {
          operatorUserId: args.operatorUserId,
          serverId: input.serverId as Id<"operatorMcpServers"> | undefined,
        }),
      };
    }
    const input = parseOperatorAgentToolInput("call_mcp_tool", args.input);
    const server = await ctx.runQuery(
      internal.operatorMcpServers.configuration,
      {
        operatorUserId: args.operatorUserId,
        serverId: input.serverId as Id<"operatorMcpServers">,
      },
    );
    if (!server?.enabled || server.revision !== input.serverRevision)
      throw new Error(
        "MCP server changed or was disabled. Discover tools again.",
      );
    const tools = JSON.parse(server.toolsJson) as { name: string }[];
    if (!tools.some((tool) => tool.name === input.toolName))
      throw new Error("MCP tool is not in the saved catalog");
    const token = await mcpServerToken(ctx, server, args.operatorUserId);
    const current = await ctx.runQuery(
      internal.operatorMcpServers.configuration,
      { operatorUserId: args.operatorUserId, serverId: server._id },
    );
    if (!current?.enabled || current.revision !== server.revision)
      throw new Error(
        "MCP server changed before execution. Discover tools again.",
      );
    const result = await withMcpClient(current.url, token, (client) =>
      client.callTool(
        {
          name: String(input.toolName),
          arguments: input.arguments as Record<string, unknown>,
        },
        undefined,
        { timeout: 60_000 },
      ),
    );
    return { result };
  },
});
