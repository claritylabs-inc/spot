import { v } from "convex/values";
import dayjs from "dayjs";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireOperator, requireOperatorForUser } from "./lib/operatorIdentity";
import { normalizeGmailAddress } from "./lib/operatorGmail";

/** The active connection for a Gmail address, or null. */
export const getActiveByAddressInternal = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    const row = await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_address", (q) => q.eq("address", normalizeGmailAddress(address)))
      .first();
    return row?.status === "active" ? row : null;
  },
});

/** The operator's connection in any status, or null. */
export const getByOwnerInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
      .first(),
});

export const myConnection = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const row = await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", operator.userId))
      .first();
    if (!row || row.status === "disconnected") return null;
    return {
      address: row.address,
      status: row.status,
      sendError: row.sendError,
      connectedAt: row.connectedAt,
    };
  },
});

/** Direct (non-impersonating) operator user id for the Gmail connect/disconnect actions. */
export const authorizeInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    return operator.userId;
  },
});

export const createOAuthStateInternal = internalMutation({
  args: {
    userId: v.id("users"),
    stateHash: v.string(),
    codeVerifier: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.userId);
    await assertNoOperatorImpersonation(ctx, args.userId);
    const now = dayjs().valueOf();
    const expired = await ctx.db
      .query("operatorGmailOAuthStates")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(50);
    for (const row of expired) await ctx.db.delete(row._id);
    await ctx.db.insert("operatorGmailOAuthStates", {
      ...args,
      expiresAt: dayjs().add(10, "minute").valueOf(),
    });
  },
});

/** Single use: deletes the state, and returns null when it is unknown or expired. */
export const consumeOAuthStateInternal = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("operatorGmailOAuthStates")
      .withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt <= dayjs().valueOf()) return null;
    return { userId: row.userId, codeVerifier: row.codeVerifier };
  },
});

export const upsertConnectionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    address: v.string(),
    googleSub: v.string(),
    encryptedRefreshToken: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; reason: "address_in_use" }> => {
    await requireOperatorForUser(ctx, args.userId);
    await assertNoOperatorImpersonation(ctx, args.userId);
    const address = normalizeGmailAddress(args.address);
    const sameAddress = await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_address", (q) => q.eq("address", address))
      .take(20);
    if (
      sameAddress.some(
        (row) => row.ownerUserId !== args.userId && row.status !== "disconnected",
      )
    )
      return { ok: false, reason: "address_in_use" };
    const now = dayjs().valueOf();
    const fields = {
      address,
      googleSub: args.googleSub,
      encryptedRefreshToken: args.encryptedRefreshToken,
      scopes: args.scopes,
      status: "active" as const,
      sendError: undefined,
      connectedAt: now,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", args.userId))
      .first();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("operatorGmailConnections", { ownerUserId: args.userId, ...fields });
    return { ok: true };
  },
});

export const markNeedsReconnectInternal = internalMutation({
  args: { connectionId: v.id("operatorGmailConnections"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row || row.status !== "active") return;
    await ctx.db.patch(row._id, {
      status: "needs_reconnect",
      sendError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

/** Records the latest send failure, or clears it when `error` is omitted. */
export const recordSendErrorInternal = internalMutation({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      sendError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const disconnectInternal = internalMutation({
  args: { connectionId: v.id("operatorGmailConnections") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      status: "disconnected",
      encryptedRefreshToken: "",
      sendError: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});
