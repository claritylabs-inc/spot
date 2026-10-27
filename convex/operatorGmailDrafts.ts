import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Immutable Gmail send payloads (`operatorGmailDrafts`). A draft is claimed
 * (`sending`) before any Gmail write and never replays after an unknown
 * outcome: only positive evidence (the Message-ID found in the account) can
 * move `unknown` or `sending` to `sent`.
 */

export const getInternal = internalQuery({
  args: { id: v.id("operatorGmailDrafts") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/** A draft keyed by its Message-ID, for matching a reconciled send. */
export const getByMessageIdInternal = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("operatorGmailDrafts")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first(),
});

export const getByKeyInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("operatorGmailDrafts")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});

/** Idempotent per key: a replay returns the stored row; different content under one key throws. */
export const storeInternal = internalMutation({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    key: v.string(),
    fingerprint: v.string(),
    payloadId: v.id("_storage"),
    messageId: v.string(),
    recipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("operatorGmailDrafts")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (old) {
      await ctx.storage.delete(args.payloadId);
      if (old.fingerprint !== args.fingerprint) {
        throw new Error("Draft key does not match its approved content");
      }
      return { id: old._id, replayed: true };
    }
    const id = await ctx.db.insert("operatorGmailDrafts", {
      ...args,
      status: "draft",
      createdAt: dayjs().valueOf(),
    });
    return { id, replayed: false };
  },
});

/** Reserves the send before any Gmail write. Only a never-sent or definitively failed draft is claimed. */
export const claimInternal = internalMutation({
  args: { id: v.id("operatorGmailDrafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.id);
    if (!draft) throw new Error("Gmail draft not found");
    const connection = await ctx.db.get(draft.connectionId);
    if (!connection || connection.status !== "active") {
      return { status: "blocked" as const };
    }
    if (draft.status !== "draft" && draft.status !== "failed") {
      return { status: draft.status };
    }
    await ctx.db.patch(draft._id, { status: "sending", error: undefined });
    return { status: "claimed" as const };
  },
});

const FINISH_FROM = {
  sent: ["sending", "unknown"],
  unknown: ["sending"],
  failed: ["sending"],
} as const;

export const finishInternal = internalMutation({
  args: {
    id: v.id("operatorGmailDrafts"),
    status: v.union(v.literal("sent"), v.literal("unknown"), v.literal("failed")),
    gmailMessageId: v.optional(v.string()),
    gmailThreadId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.id);
    if (!draft) throw new Error("Gmail draft not found");
    if (draft.status === args.status) return null;
    if (!(FINISH_FROM[args.status] as readonly string[]).includes(draft.status)) {
      return null;
    }
    await ctx.db.patch(draft._id, {
      status: args.status,
      error: args.status === "sent" ? undefined : args.error,
      ...(args.gmailMessageId ? { gmailMessageId: args.gmailMessageId } : {}),
      ...(args.gmailThreadId ? { gmailThreadId: args.gmailThreadId } : {}),
      ...(args.status === "sent" ? { sentAt: dayjs().valueOf() } : {}),
    });
    return null;
  },
});
