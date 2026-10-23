import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { operatorPeople } from "./lib/operatorAvatar";
import { requireOperator } from "./lib/operatorIdentity";

const emailActivityValidator = v.union(
  v.literal("viewing"),
  v.literal("replying"),
);

/** Rows older than this are dropped; the client applies the tighter window. */
const PRESENCE_WINDOW_MS = 2 * 60_000;

export const heartbeat = mutation({
  args: {
    pathname: v.string(),
    threadId: v.optional(v.id("operatorAgentThreads")),
    emailThreadId: v.optional(v.id("teamEmailThreads")),
    activity: v.optional(emailActivityValidator),
    followingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const fields = {
      pathname: args.pathname.slice(0, 500),
      threadId: args.threadId,
      followingUserId:
        args.followingUserId === operator.userId
          ? undefined
          : args.followingUserId,
      // Activity only means something on an email thread; both clear together.
      emailThreadId: args.emailThreadId,
      activity: args.emailThreadId ? (args.activity ?? "viewing") : undefined,
      lastSeen: dayjs().valueOf(),
    };
    const existing = await ctx.db
      .query("operatorPresence")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("operatorPresence", { userId: operator.userId, ...fields });
    return null;
  },
});

export const leave = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const existing = await ctx.db
      .query("operatorPresence")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    const cursor = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (cursor) await ctx.db.delete(cursor._id);
    const ui = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (ui) await ctx.db.delete(ui._id);
    return null;
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const rows = await ctx.db
      .query("operatorPresence")
      .withIndex("by_lastSeen", (q) =>
        q.gt("lastSeen", dayjs().valueOf() - PRESENCE_WINDOW_MS),
      )
      .order("desc")
      .take(100);
    const people = await operatorPeople(
      ctx,
      rows.map((row) => row.userId),
    );
    return rows.map((row) => ({
      ...people.get(row.userId)!,
      self: row.userId === operator.userId,
      pathname: row.pathname,
      threadId: row.threadId ?? null,
      followingUserId: row.followingUserId ?? null,
      emailThreadId: row.emailThreadId ?? null,
      activity: row.emailThreadId ? (row.activity ?? "viewing") : null,
      lastSeen: row.lastSeen,
    }));
  },
});
