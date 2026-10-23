import dayjs from "dayjs";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";

const LEADER_TIMEOUT_MS = 45_000;
const FIELD_TEXT_LIMIT = 5_000;

const fieldValidator = v.object({
  anchor: v.string(),
  text: v.string(),
  selectionStart: v.number(),
  selectionEnd: v.number(),
});

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

/** Drops this operator's cursor once nobody follows them. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const existing = await ctx.db
      .query("operatorCursors")
      .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
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
    // A closed or crashed tab never clears its row; ignore it once the
    // leader's presence lapses (three missed heartbeats).
    const presence = await ctx.db
      .query("operatorPresence")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (
      !presence ||
      presence.lastSeen < dayjs().valueOf() - LEADER_TIMEOUT_MS
    ) {
      return null;
    }
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
