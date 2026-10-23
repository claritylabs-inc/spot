import dayjs from "dayjs";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";

const LEADER_TIMEOUT_MS = 45_000;
const FIELD_TEXT_LIMIT = 5_000;
const UI_STATE_LIMIT = 50_000;

const fieldValidator = v.object({
  anchor: v.string(),
  text: v.string(),
  selectionStart: v.number(),
  selectionEnd: v.number(),
});

/**
 * A closed or crashed tab never clears its rows; ignore them once the leader's
 * presence lapses (three missed heartbeats).
 */
async function leaderActive(ctx: QueryCtx, userId: Id<"users">) {
  const presence = await ctx.db
    .query("operatorPresence")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  return (
    !!presence && presence.lastSeen >= dayjs().valueOf() - LEADER_TIMEOUT_MS
  );
}

/** Publishes this operator's pointer while someone follows them. */
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
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    // Followers navigate to this, so it must stay an in-app path.
    if (!args.href.startsWith("/") || args.href.startsWith("//")) {
      throw new Error("Cursor href must be an app path");
    }
    const fields = {
      ...args,
      href: args.href.slice(0, 1000),
      anchor: args.anchor?.slice(0, 2000),
      field: args.field && {
        anchor: args.field.anchor.slice(0, 2000),
        text: args.field.text.slice(0, FIELD_TEXT_LIMIT),
        selectionStart: Math.min(args.field.selectionStart, FIELD_TEXT_LIMIT),
        selectionEnd: Math.min(args.field.selectionEnd, FIELD_TEXT_LIMIT),
      },
      updatedAt: dayjs().valueOf(),
    };
    const existing = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("operatorCursors", {
        userId: operator.userId,
        ...fields,
      });
    return null;
  },
});

/** Drops this operator's cursor and UI state once nobody follows them. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
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

/** Publishes this operator's followed UI state; called only when it changes. */
export const publishUi = mutation({
  args: { ui: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (args.ui.length > UI_STATE_LIMIT) {
      throw new Error("Followed UI state is too large");
    }
    const fields = { ui: args.ui, updatedAt: dayjs().valueOf() };
    const existing = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("operatorUiStates", {
        userId: operator.userId,
        ...fields,
      });
    return null;
  },
});

/** The followed operator's UI state, or null when they are away. */
export const ui = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (!(await leaderActive(ctx, args.userId))) return null;
    const row = await ctx.db
      .query("operatorUiStates")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return row?.ui ?? null;
  },
});

/** Any operator may follow any other; no consent step. */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const cursor = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!cursor) return null;
    if (!(await leaderActive(ctx, args.userId))) return null;
    return {
      href: cursor.href,
      anchor: cursor.anchor ?? null,
      x: cursor.x,
      y: cursor.y,
      viewportX: cursor.viewportX,
      viewportY: cursor.viewportY,
      visible: cursor.visible,
      field: cursor.field ?? null,
    };
  },
});
