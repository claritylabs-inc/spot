import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { operatorPeople } from "./lib/operatorAvatar";
import { requireOperator } from "./lib/operatorIdentity";
import { clearTab, latestTab, tabIsFresh } from "./lib/operatorTabs";

const emailActivityValidator = v.union(
  v.literal("viewing"),
  v.literal("replying"),
);

/** Rows older than this are dropped; the client applies the tighter window. */
const PRESENCE_WINDOW_MS = 2 * 60_000;

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
 * One entry per operator from their tabs' rows (newest first): the active
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
  return [...operators.values()].map(({ latest: newest, tabs }) => {
    const latest = latestTab(tabs.filter(tabIsFresh)) ?? newest;
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
    /** When this tab was last focused or entered. */
    activeAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const tabId = args.tabId?.slice(0, 100);
    const now = dayjs().valueOf();
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
      lastSeen: now,
      activeAt:
        args.activeAt === undefined ? undefined : Math.min(args.activeAt, now),
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

/**
 * Drops this tab with its cursor and UI state; once no other tab is active,
 * every tab's are dropped (closed or crashed tabs never clear their own).
 */
export const leave = mutation({
  args: { tabId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const tabId = args.tabId?.slice(0, 100);
    const existing = await tabRow(ctx, operator.userId, tabId);
    if (existing) await ctx.db.delete(existing._id);
    await clearTab(ctx, operator.userId, tabId);
    const otherTabs = await ctx.db
      .query("operatorPresence")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .take(20);
    if (otherTabs.some(tabIsFresh)) return null;
    const cursors = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId_and_tabId", (q) => q.eq("userId", operator.userId))
      .take(20);
    const uis = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId_and_tabId", (q) => q.eq("userId", operator.userId))
      .take(20);
    for (const row of [...cursors, ...uis]) await ctx.db.delete(row._id);
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
