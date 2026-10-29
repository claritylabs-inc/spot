import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

// Claims keep the `role` column for rows written before operator iMessage was
// removed; every new claim is a customer claim.
const ROLE = "customer";

// Photon retries a delivery for a few minutes at most; its docs recommend a
// 24-48 hour dedupe window on `message.id`.
const WEBHOOK_MESSAGE_TTL_MS = 48 * 60 * 60 * 1000;
// Matches the former worker's in-memory clientMessageId cache.
const SEND_TTL_MS = 10 * 60 * 1000;
const EXPIRED_PRUNE_BATCH = 25;

async function findClaim(
  ctx: MutationCtx,
  kind: "webhook_message" | "send",
  key: string,
) {
  return await ctx.db
    .query("imessageTransportClaims")
    .withIndex("role_kind_key", (q) =>
      q.eq("role", ROLE).eq("kind", kind).eq("key", key),
    )
    .unique();
}

async function pruneExpiredClaims(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("imessageTransportClaims")
    .withIndex("expiration", (q) => q.lt("expiresAt", now))
    .take(EXPIRED_PRUNE_BATCH);
  for (const claim of expired) await ctx.db.delete(claim._id);
}

/**
 * Dedupes a verified Spectrum delivery on `message.id` and schedules its
 * processing in the same transaction, so a retry after a failed schedule is
 * never mistaken for a duplicate.
 */
export const acceptWebhookMessage = internalMutation({
  args: { messageId: v.string(), body: v.bytes() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await findClaim(ctx, "webhook_message", args.messageId);
    if (existing && existing.expiresAt > now) return { accepted: false };
    if (existing) await ctx.db.delete(existing._id);
    await pruneExpiredClaims(ctx, now);
    await ctx.db.insert("imessageTransportClaims", {
      role: ROLE,
      kind: "webhook_message",
      key: args.messageId,
      status: "accepted",
      expiresAt: now + WEBHOOK_MESSAGE_TTL_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.imessageWebhook.processMessage,
      { body: args.body },
    );
    return { accepted: true };
  },
});

export const claimSend = internalMutation({
  args: { clientMessageId: v.string() },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await findClaim(ctx, "send", args.clientMessageId);
    if (existing && existing.expiresAt > now) return { claimed: false };
    if (existing) await ctx.db.delete(existing._id);
    await pruneExpiredClaims(ctx, now);
    await ctx.db.insert("imessageTransportClaims", {
      role: ROLE,
      kind: "send",
      key: args.clientMessageId,
      status: "sending",
      expiresAt: now + SEND_TTL_MS,
    });
    return { claimed: true };
  },
});

export const completeSend = internalMutation({
  args: { clientMessageId: v.string() },
  handler: async (ctx, args) => {
    const existing = await findClaim(ctx, "send", args.clientMessageId);
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "sent",
      expiresAt: dayjs().valueOf() + SEND_TTL_MS,
    });
  },
});

export const releaseSend = internalMutation({
  args: { clientMessageId: v.string() },
  handler: async (ctx, args) => {
    const existing = await findClaim(ctx, "send", args.clientMessageId);
    if (existing?.status === "sending") await ctx.db.delete(existing._id);
  },
});
