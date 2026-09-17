import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return (await ctx.db.query("operatorMcpServers").collect()).map(
      ({
        encryptedToken,
        encryptedOAuth,
        encryptedOAuthClientSecret,
        oauthRefreshLease: _lease,
        oauthRefreshExpiresAt: _expiry,
        toolsJson,
        ...server
      }) => ({
        ...server,
        hasToken: Boolean(encryptedToken),
        hasOAuth: Boolean(encryptedOAuth),
        hasOAuthClientSecret: Boolean(encryptedOAuthClientSecret),
        toolCount: (JSON.parse(toolsJson) as unknown[]).length,
      }),
    );
  },
});

export const configuration = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    serverId: v.optional(v.id("operatorMcpServers")),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    return args.serverId ? await ctx.db.get(args.serverId) : null;
  },
});

export const catalog = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    serverId: v.optional(v.id("operatorMcpServers")),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    return (await ctx.db.query("operatorMcpServers").collect())
      .filter(
        (server) =>
          server.enabled && (!args.serverId || server._id === args.serverId),
      )
      .map((server) => ({
        serverId: server._id,
        serverRevision: server.revision,
        name: server.name,
        tools: args.serverId
          ? JSON.parse(server.toolsJson)
          : (JSON.parse(server.toolsJson) as { name: string }[]).map(
              (tool) => ({ name: tool.name }),
            ),
      }));
  },
});

export const saveInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    serverId: v.optional(v.id("operatorMcpServers")),
    revision: v.optional(v.number()),
    authType: v.optional(v.union(v.literal("bearer"), v.literal("oauth"))),
    preserveOAuth: v.optional(v.boolean()),
    oauthClientId: v.optional(v.string()),
    encryptedOAuthClientSecret: v.optional(v.string()),
    name: v.string(),
    url: v.string(),
    logoUrl: v.optional(v.string()),
    enabled: v.boolean(),
    encryptedToken: v.optional(v.string()),
    toolsJson: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    if (
      !args.serverId &&
      (await ctx.db.query("operatorMcpServers").take(16)).length >= 16
    )
      throw new Error("Remove a server before adding another (maximum 16).");
    const existing = args.serverId ? await ctx.db.get(args.serverId) : null;
    if (args.serverId && (!existing || existing.revision !== args.revision))
      throw new Error("Server changed. Reopen settings and try again.");
    const {
      operatorUserId,
      serverId,
      revision: _revision,
      preserveOAuth,
      ...fields
    } = args;
    const patch = {
      ...fields,
      encryptedOAuth: preserveOAuth ? existing?.encryptedOAuth : undefined,
      oauthRefreshLease: preserveOAuth
        ? existing?.oauthRefreshLease
        : undefined,
      oauthRefreshExpiresAt: preserveOAuth
        ? existing?.oauthRefreshExpiresAt
        : undefined,
      revision: (existing?.revision ?? 0) + 1,
      updatedBy: operatorUserId,
      updatedAt: dayjs().valueOf(),
    };
    const id = serverId ?? (await ctx.db.insert("operatorMcpServers", patch));
    if (serverId) await ctx.db.patch(serverId, patch);
    await writeOperatorAudit(ctx, {
      operatorUserId,
      type: "setup_write",
      summary: `Saved MCP server ${args.name}`,
      metadata: { serverId: id },
    });
    return id;
  },
});

export const remove = mutation({
  args: { serverId: v.id("operatorMcpServers"), revision: v.number() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const server = await ctx.db.get(args.serverId);
    if (!server || server.revision !== args.revision)
      throw new Error("Server changed. Reopen settings and try again.");
    await ctx.db.delete(server._id);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `Removed MCP server ${server.name}`,
      metadata: { serverId: server._id },
    });
  },
});

export const brand = query({
  args: { serverId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const id = ctx.db.normalizeId("operatorMcpServers", args.serverId);
    const server = id ? await ctx.db.get(id) : null;
    return server
      ? { name: server.name, logoUrl: server.logoUrl, url: server.url }
      : null;
  },
});

export const oauthRedirectUrl = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return process.env.CONVEX_SITE_URL
      ? new URL(
          "/operator-mcp/oauth/callback",
          process.env.CONVEX_SITE_URL,
        ).toString()
      : null;
  },
});
