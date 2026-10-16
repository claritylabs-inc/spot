import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

const RECEIPT_TTL_MS = 10 * 60 * 1_000;

async function receiptFor(ctx: MutationCtx, clientMessageId: string) {
  return await ctx.db
    .query("slackSendReceipts")
    .withIndex("by_clientMessageId", (q) =>
      q.eq("clientMessageId", clientMessageId),
    )
    .unique();
}

/**
 * Claims one Slack send for ten minutes. A completed send returns its stored
 * result, and a concurrent claim reports that the original send is in flight.
 */
export const claim = internalMutation({
  args: { clientMessageId: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await receiptFor(ctx, args.clientMessageId);
    if (existing && existing.expiresAt > now) {
      return existing.status === "sent"
        ? { claimed: false as const, messageId: existing.messageId }
        : { claimed: false as const, sending: true as const };
    }
    if (existing) await ctx.db.delete(existing._id);
    const expiresAt = dayjs(now).add(RECEIPT_TTL_MS, "millisecond").valueOf();
    const id = await ctx.db.insert("slackSendReceipts", {
      clientMessageId: args.clientMessageId,
      status: "sending",
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.slackSendReceipts.expire, {
      id,
    });
    return { claimed: true as const };
  },
});

export const complete = internalMutation({
  args: { clientMessageId: v.string(), messageId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await receiptFor(ctx, args.clientMessageId);
    if (!existing) return null;
    const expiresAt = dayjs().add(RECEIPT_TTL_MS, "millisecond").valueOf();
    await ctx.db.patch(existing._id, {
      status: "sent",
      messageId: args.messageId,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.slackSendReceipts.expire, {
      id: existing._id,
    });
    return null;
  },
});

export const release = internalMutation({
  args: { clientMessageId: v.string() },
  handler: async (ctx, args) => {
    const existing = await receiptFor(ctx, args.clientMessageId);
    if (existing?.status === "sending") await ctx.db.delete(existing._id);
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("slackSendReceipts") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing && existing.expiresAt <= dayjs().valueOf()) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
