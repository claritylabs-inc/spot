import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { normalizeGmailAddress } from "./lib/operatorGmail";

/**
 * The connection an inbound address belongs to, in any status (newest first,
 * an active row preferred). A lapsed connection still marks its owner's own
 * mail; only sending needs `active`.
 */
export async function gmailConnectionForAddress(ctx: QueryCtx, address: string) {
  const rows = await ctx.db
    .query("operatorGmailConnections")
    .withIndex("by_address", (q) => q.eq("address", normalizeGmailAddress(address)))
    .order("desc")
    .take(20);
  return rows.find((row) => row.status === "active") ?? rows[0] ?? null;
}

/** Whether `fromEmail` belongs to a connected Gmail, for the inbox webhook's sender check. */
export const senderConnectionInternal = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    const row = await gmailConnectionForAddress(ctx, address);
    return row ? { connectionId: row._id, address: row.address } : null;
  },
});
