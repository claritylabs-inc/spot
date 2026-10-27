import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
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
