import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import { activeTab, clearTab } from "./lib/operatorTabs";

const UI_STATE_LIMIT = 50_000;

/** Retired: older clients still send it, but shared fields now sync through `collab`. */
const fieldValidator = v.object({
  anchor: v.string(),
  text: v.string(),
  selectionStart: v.number(),
  selectionEnd: v.number(),
});

/** Publishes this operator's pointer while a teammate shares their page or follows them. */
export const move = mutation({
  args: {
    href: v.string(),
    anchor: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    viewportX: v.number(),
    viewportY: v.number(),
    visible: v.boolean(),
    field: v.optional(fieldValidator),
    tabId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    // Followers navigate to this, so it must stay an in-app path.
    if (!args.href.startsWith("/") || args.href.startsWith("//")) {
      throw new Error("Cursor href must be an app path");
    }
    const { field: _retired, tabId: _tab, ...pointer } = args;
    const tabId = args.tabId?.slice(0, 100);
    const fields = {
      ...pointer,
      href: args.href.slice(0, 1000),
      anchor: args.anchor?.slice(0, 2000),
      field: undefined,
      updatedAt: dayjs().valueOf(),
    };
    const existing = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId_and_tabId", (q) =>
        q.eq("userId", operator.userId).eq("tabId", tabId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("operatorCursors", {
        userId: operator.userId,
        tabId,
        ...fields,
      });
    return null;
  },
});

/** Drops this tab's cursor and UI state once nobody can see them. */
export const clear = mutation({
  args: { tabId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await clearTab(ctx, operator.userId, args.tabId?.slice(0, 100));
    return null;
  },
});

/** Publishes this operator's followed UI state; called only when it changes. */
export const publishUi = mutation({
  args: { ui: v.string(), tabId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (args.ui.length > UI_STATE_LIMIT) {
      throw new Error("Followed UI state is too large");
    }
    const tabId = args.tabId?.slice(0, 100);
    const fields = { ui: args.ui, updatedAt: dayjs().valueOf() };
    const existing = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId_and_tabId", (q) =>
        q.eq("userId", operator.userId).eq("tabId", tabId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("operatorUiStates", {
        userId: operator.userId,
        tabId,
        ...fields,
      });
    return null;
  },
});

/** The UI state of the followed operator's active tab, or null when they are away. */
export const ui = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const tab = await activeTab(ctx, args.userId);
    if (!tab) return null;
    const row = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId_and_tabId", (q) =>
        q.eq("userId", args.userId).eq("tabId", tab.tabId),
      )
      .unique();
    return row?.ui ?? null;
  },
});

/**
 * The pointer of the operator's active tab. Any operator may see or follow
 * any other; no consent step.
 */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const tab = await activeTab(ctx, args.userId);
    if (!tab) return null;
    const cursor = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId_and_tabId", (q) =>
        q.eq("userId", args.userId).eq("tabId", tab.tabId),
      )
      .unique();
    if (!cursor) return null;
    return {
      href: cursor.href,
      anchor: cursor.anchor ?? null,
      x: cursor.x,
      y: cursor.y,
      viewportX: cursor.viewportX,
      viewportY: cursor.viewportY,
      visible: cursor.visible,
    };
  },
});
