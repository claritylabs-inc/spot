import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Matches the client's active window, which outlasts throttled background heartbeats. */
export const TAB_ACTIVE_WINDOW_MS = 90_000;

/**
 * The tab its operator used last among `tabs`: the one most recently focused
 * or entered, or (rows from older clients) the newest heartbeat.
 */
export function latestTab(tabs: Doc<"operatorPresence">[]) {
  let latest: Doc<"operatorPresence"> | null = null;
  for (const tab of tabs) {
    if (
      !latest ||
      (tab.activeAt ?? tab.lastSeen) > (latest.activeAt ?? latest.lastSeen)
    ) {
      latest = tab;
    }
  }
  return latest;
}

/** Whether a tab's heartbeat is within the active window. */
export function tabIsFresh(tab: Doc<"operatorPresence">) {
  return tab.lastSeen >= dayjs().valueOf() - TAB_ACTIVE_WINDOW_MS;
}

/**
 * The operator's active tab, whose pointer and UI state teammates see, or
 * null when no tab is present. A closed or crashed tab never clears its rows,
 * so only tabs with a fresh heartbeat count.
 */
export async function activeTab(ctx: QueryCtx, userId: Id<"users">) {
  const tabs = await ctx.db
    .query("operatorPresence")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20);
  return latestTab(tabs.filter(tabIsFresh));
}

/** Deletes one tab's cursor and UI state. */
export async function clearTab(
  ctx: MutationCtx,
  userId: Id<"users">,
  tabId: string | undefined,
) {
  const cursor = await ctx.db
    .query("operatorCursors")
    .withIndex("by_userId_and_tabId", (q) =>
      q.eq("userId", userId).eq("tabId", tabId),
    )
    .unique();
  if (cursor) await ctx.db.delete(cursor._id);
  const ui = await ctx.db
    .query("operatorUiStates")
    .withIndex("by_userId_and_tabId", (q) =>
      q.eq("userId", userId).eq("tabId", tabId),
    )
    .unique();
  if (ui) await ctx.db.delete(ui._id);
}
