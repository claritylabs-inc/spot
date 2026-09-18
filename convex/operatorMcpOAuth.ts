import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";

export const createSession = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    serverId: v.id("operatorMcpServers"),
    serverRevision: v.number(),
    stateHash: v.string(),
    encryptedData: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    const server = await ctx.db.get(args.serverId);
    if (
      !server ||
      server.authType !== "oauth" ||
      server.revision !== args.serverRevision
    )
      throw new Error("MCP server changed. Connect again.");
    const id = await ctx.db.insert("operatorMcpOAuthSessions", {
      ...args,
      expiresAt: dayjs().add(10, "minute").valueOf(),
      exchanging: false,
    });
    await ctx.scheduler.runAfter(
      10 * 60_000,
      internal.operatorMcpOAuth.cleanupSession,
      { id },
    );
  },
});

export const cleanupSession = internalMutation({
  args: { id: v.id("operatorMcpOAuthSessions") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

export const consumeSession = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("operatorMcpOAuthSessions")
      .withIndex("state", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (
      !session ||
      session.exchanging ||
      session.expiresAt <= dayjs().valueOf()
    )
      throw new Error(
        "OAuth connection expired or was already used. Connect again.",
      );
    await requireOperatorForUser(ctx, session.operatorUserId);
    await assertNoOperatorImpersonation(ctx, session.operatorUserId);
    const server = await ctx.db.get(session.serverId);
    if (
      !server ||
      server.authType !== "oauth" ||
      server.revision !== session.serverRevision
    )
      throw new Error("MCP server changed. Connect again.");
    await ctx.db.patch(session._id, { exchanging: true });
    return { session, server };
  },
});

export const finishSession = internalMutation({
  args: {
    id: v.id("operatorMcpOAuthSessions"),
    encryptedOAuth: v.string(),
    toolsJson: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session?.exchanging || session.expiresAt <= dayjs().valueOf())
      throw new Error("OAuth connection expired. Connect again.");
    await requireOperatorForUser(ctx, session.operatorUserId);
    await assertNoOperatorImpersonation(ctx, session.operatorUserId);
    const server = await ctx.db.get(session.serverId);
    if (
      !server ||
      server.authType !== "oauth" ||
      server.revision !== session.serverRevision
    )
      throw new Error("MCP server changed. Connect again.");
    await ctx.db.patch(server._id, {
      encryptedOAuth: args.encryptedOAuth,
      toolsJson: args.toolsJson,
      enabled: true,
      revision: server.revision + 1,
      oauthRefreshLease: undefined,
      oauthRefreshExpiresAt: undefined,
      updatedBy: session.operatorUserId,
      updatedAt: dayjs().valueOf(),
    });
    await ctx.db.delete(session._id);
    await writeOperatorAudit(ctx, {
      operatorUserId: session.operatorUserId,
      type: "setup_write",
      summary: `Connected MCP server ${server.name} with OAuth`,
      metadata: { serverId: server._id },
    });
  },
});

export const claimRefresh = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    serverId: v.id("operatorMcpServers"),
    revision: v.number(),
    expectedEncrypted: v.string(),
    lease: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    const server = await ctx.db.get(args.serverId);
    if (
      !server ||
      server.authType !== "oauth" ||
      server.revision !== args.revision ||
      !server.encryptedOAuth
    )
      throw new Error("MCP server changed. Connect again.");
    if (server.encryptedOAuth !== args.expectedEncrypted)
      return { claimed: false, encryptedOAuth: server.encryptedOAuth };
    if (
      server.oauthRefreshLease &&
      (server.oauthRefreshExpiresAt ?? 0) > dayjs().valueOf()
    )
      throw new Error("OAuth refresh is in progress. Try again shortly.");
    await ctx.db.patch(server._id, {
      oauthRefreshLease: args.lease,
      oauthRefreshExpiresAt: dayjs().add(2, "minute").valueOf(),
    });
    return { claimed: true, encryptedOAuth: server.encryptedOAuth };
  },
});

export const finishRefresh = internalMutation({
  args: {
    serverId: v.id("operatorMcpServers"),
    lease: v.string(),
    encryptedOAuth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const server = await ctx.db.get(args.serverId);
    if (
      !server ||
      server.authType !== "oauth" ||
      server.oauthRefreshLease !== args.lease
    )
      throw new Error("MCP server changed during OAuth refresh.");
    await ctx.db.patch(server._id, {
      ...(args.encryptedOAuth ? { encryptedOAuth: args.encryptedOAuth } : {}),
      oauthRefreshLease: undefined,
      oauthRefreshExpiresAt: undefined,
    });
  },
});
