import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { operatorPeople } from "./lib/operatorAvatar";
import { requireOperator } from "./lib/operatorIdentity";

const emailActivityValidator = v.union(
  v.literal("viewing"),
  v.literal("replying"),
);

/** Rows older than this are dropped; the client applies the tighter window. */
const PRESENCE_WINDOW_MS = 2 * 60_000;
/** Matches the client's active window: three missed heartbeats. */
const ACTIVE_WINDOW_MS = 45_000;

function tabRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  tabId: string | undefined,
) {
  return ctx.db
    .query("operatorPresence")
    .withIndex("by_userId_and_tabId", (q) =>
      q.eq("userId", userId).eq("tabId", tabId),
    )
    .first();
}

/**
 * One entry per operator from their tabs' rows (newest first): the newest
 * tab's page and chat, every open page, an email thread they are replying in
 * from any tab, and whoever any tab follows.
 */
function byOperator(rows: Doc<"operatorPresence">[]) {
  const operators = new Map<
    Id<"users">,
    { latest: Doc<"operatorPresence">; tabs: Doc<"operatorPresence">[] }
  >();
  for (const row of rows) {
    const entry = operators.get(row.userId);
    if (entry) entry.tabs.push(row);
    else operators.set(row.userId, { latest: row, tabs: [row] });
  }
  return [...operators.values()].map(({ latest, tabs }) => {
    const email =
      tabs.find((tab) => tab.emailThreadId && tab.activity === "replying") ??
      tabs.find((tab) => tab.emailThreadId) ??
      null;
    return {
      latest,
      pathnames: [...new Set(tabs.map((tab) => tab.pathname))],
      email,
      followingUserId:
        tabs.find((tab) => tab.followingUserId)?.followingUserId ?? null,
    };
  });
}

export const heartbeat = mutation({
  args: {
    pathname: v.string(),
    threadId: v.optional(v.id("operatorAgentThreads")),
    emailThreadId: v.optional(v.id("teamEmailThreads")),
    activity: v.optional(emailActivityValidator),
    followingUserId: v.optional(v.id("users")),
    tabId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const tabId = args.tabId?.slice(0, 100);
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
    const existing = await tabRow(ctx, operator.userId, tabId);
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("operatorPresence", {
        userId: operator.userId,
        tabId,
        ...fields,
      });
    return null;
  },
});

/** Drops this tab; the operator's cursor and UI state go once no other tab is active. */
export const leave = mutation({
  args: { tabId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const existing = await tabRow(
      ctx,
      operator.userId,
      args.tabId?.slice(0, 100),
    );
    if (existing) await ctx.db.delete(existing._id);
    const otherTabs = await ctx.db
      .query("operatorPresence")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .take(20);
    const fresh = dayjs().valueOf() - ACTIVE_WINDOW_MS;
    if (otherTabs.some((tab) => tab.lastSeen >= fresh)) return null;
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
    return byOperator(rows).map(
      ({ latest, pathnames, email, followingUserId }) => ({
        ...people.get(latest.userId)!,
        self: latest.userId === operator.userId,
        pathname: latest.pathname,
        /** Every page this operator has open, one per tab. */
        pathnames,
        threadId: latest.threadId ?? null,
        followingUserId,
        emailThreadId: email?.emailThreadId ?? null,
        activity: email?.emailThreadId ? (email.activity ?? "viewing") : null,
        lastSeen: latest.lastSeen,
      }),
    );
  },
});

/** Active operators with titles for what they have open, for the team sessions page. */
export const listSessions = query({
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
    return await Promise.all(
      byOperator(rows).map(async ({ latest: row, email, followingUserId }) => {
        const [thread, emailThread] = await Promise.all([
          row.threadId ? ctx.db.get(row.threadId) : null,
          email?.emailThreadId ? ctx.db.get(email.emailThreadId) : null,
        ]);
        // A private chat stays hidden from everyone but its owner.
        const chat =
          thread &&
          (thread.visibility === "shared" ||
            thread.ownerUserId === operator.userId)
            ? { id: thread._id, title: thread.title }
            : null;
        return {
          ...people.get(row.userId)!,
          self: row.userId === operator.userId,
          pathname: row.pathname,
          chat,
          email: emailThread
            ? {
                id: emailThread._id,
                subject: emailThread.subject,
                activity: email?.activity ?? "viewing",
              }
            : null,
          followingUserId,
          lastSeen: row.lastSeen,
        };
      }),
    );
  },
});
