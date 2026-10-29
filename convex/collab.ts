import dayjs from "dayjs";
import { v } from "convex/values";
import * as Y from "yjs";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import { latestTab } from "./lib/operatorTabs";

/** Matches the client's active window: three missed presence heartbeats. */
const PRESENCE_TIMEOUT_MS = 45_000;
/**
 * A room nobody has rejoined (every 15s) for this long is reset on the next
 * arrival. Longer than a hidden tab's throttled timers (once a minute).
 */
const ROOM_STALE_MS = 2 * 60_000;
const UPDATE_LIMIT_BYTES = 256_000;
/** Merged into one row once this many accumulate. */
const COMPACT_AFTER = 50;
const PAGE_SIZE = 200;
/** Rooms are reset when an operator arrives on an empty page; this only reclaims storage. */
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;

async function purge(ctx: MutationCtx, roomId: Id<"collabRooms">) {
  await ctx.scheduler.runAfter(0, internal.collab.purgeRoom, { roomId });
}

async function othersOnPage(
  ctx: QueryCtx,
  pathname: string,
  userId: Id<"users">,
) {
  const rows = await ctx.db
    .query("operatorPresence")
    .withIndex("by_lastSeen", (q) =>
      q.gt("lastSeen", dayjs().valueOf() - PRESENCE_TIMEOUT_MS),
    )
    .take(100);
  return rows.filter(
    (row) => row.pathname === pathname && row.userId !== userId,
  );
}

/**
 * The page's room, joined by every operator on it once a teammate is there
 * too and rejoined every 15s. A room nobody has rejoined for two minutes is
 * stale, so the next arrival starts a fresh one.
 */
export const join = mutation({
  args: { pathname: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const pathname = args.pathname.slice(0, 500);
    const existing = await ctx.db
      .query("collabRooms")
      .withIndex("by_pathname", (q) => q.eq("pathname", pathname))
      .take(10);
    const fresh = dayjs().valueOf() - ROOM_STALE_MS;
    if (existing.length === 1 && existing[0].updatedAt >= fresh) {
      await ctx.db.patch(existing[0]._id, { updatedAt: dayjs().valueOf() });
      return existing[0]._id;
    }
    for (const room of existing) {
      await ctx.db.delete(room._id);
      await purge(ctx, room._id);
    }
    return await ctx.db.insert("collabRooms", {
      pathname,
      pendingUpdates: 0,
      updatedAt: dayjs().valueOf(),
    });
  },
});

/** Any operator may edit any page they can open; sharing needs no consent. */
export const push = mutation({
  args: { roomId: v.id("collabRooms"), update: v.bytes() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (args.update.byteLength > UPDATE_LIMIT_BYTES) {
      throw new Error("Shared edit is too large");
    }
    const room = await ctx.db.get("collabRooms", args.roomId);
    // The room was reset: the caller rejoins and resends its state.
    if (!room) return { ok: false };
    await ctx.db.insert("collabUpdates", {
      roomId: room._id,
      update: args.update,
    });
    const pendingUpdates = room.pendingUpdates + 1;
    if (pendingUpdates < COMPACT_AFTER) {
      await ctx.db.patch(room._id, {
        pendingUpdates,
        updatedAt: dayjs().valueOf(),
      });
      return { ok: true };
    }
    // Clients apply updates idempotently, so they simply receive the merged
    // row as one more update.
    const rows = await ctx.db
      .query("collabUpdates")
      .withIndex("by_roomId", (q) => q.eq("roomId", room._id))
      .take(PAGE_SIZE);
    const merged = Y.mergeUpdates(
      rows.map((row) => new Uint8Array(row.update)),
    );
    if (merged.byteLength <= UPDATE_LIMIT_BYTES * 3) {
      for (const row of rows) await ctx.db.delete(row._id);
      await ctx.db.insert("collabUpdates", {
        roomId: room._id,
        update: merged.slice().buffer,
      });
    }
    await ctx.db.patch(room._id, {
      pendingUpdates: 0,
      updatedAt: dayjs().valueOf(),
    });
    return { ok: true };
  },
});

/** Updates newer than `after` (a `_creationTime`), oldest first. */
export const updates = query({
  args: { roomId: v.id("collabRooms"), after: v.number() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const rows = await ctx.db
      .query("collabUpdates")
      .withIndex("by_roomId", (q) =>
        q.eq("roomId", args.roomId).gt("_creationTime", args.after),
      )
      .take(PAGE_SIZE);
    return {
      updates: rows.map((row) => row.update),
      last: rows.at(-1)?._creationTime ?? args.after,
    };
  },
});

/** Publishes where this tab's caret is in a shared field, or clears it. */
export const caret = mutation({
  args: {
    roomId: v.id("collabRooms"),
    tabId: v.optional(v.string()),
    field: v.union(
      v.object({
        key: v.string(),
        selectionStart: v.number(),
        selectionEnd: v.number(),
      }),
      v.null(),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const tabId = args.tabId?.slice(0, 100);
    const existing = await ctx.db
      .query("collabCarets")
      .withIndex("by_roomId_and_userId_and_tabId", (q) =>
        q
          .eq("roomId", args.roomId)
          .eq("userId", operator.userId)
          .eq("tabId", tabId),
      )
      .unique();
    if (!args.field) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (!(await ctx.db.get("collabRooms", args.roomId))) return null;
    const fields = {
      key: args.field.key.slice(0, 2000),
      selectionStart: args.field.selectionStart,
      selectionEnd: args.field.selectionEnd,
      updatedAt: dayjs().valueOf(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else
      await ctx.db.insert("collabCarets", {
        roomId: args.roomId,
        userId: operator.userId,
        tabId,
        ...fields,
      });
    return null;
  },
});

/**
 * Carets of the other operators still on the room's page, one each: from
 * their most recently used tab on it.
 */
export const carets = query({
  args: { roomId: v.id("collabRooms") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const room = await ctx.db.get("collabRooms", args.roomId);
    if (!room) return [];
    const tabsByUser = new Map<Id<"users">, Doc<"operatorPresence">[]>();
    for (const row of await othersOnPage(ctx, room.pathname, operator.userId)) {
      tabsByUser.set(row.userId, [...(tabsByUser.get(row.userId) ?? []), row]);
    }
    const rows = await Promise.all(
      [...tabsByUser.values()].map((tabs) => {
        const tab = latestTab(tabs)!;
        return ctx.db
          .query("collabCarets")
          .withIndex("by_roomId_and_userId_and_tabId", (q) =>
            q
              .eq("roomId", args.roomId)
              .eq("userId", tab.userId)
              .eq("tabId", tab.tabId),
          )
          .unique();
      }),
    );
    return rows
      .filter((row) => row !== null)
      .map((row) => ({
        userId: row.userId,
        key: row.key,
        selectionStart: row.selectionStart,
        selectionEnd: row.selectionEnd,
      }));
  },
});

export const purgeRoom = internalMutation({
  args: { roomId: v.id("collabRooms") },
  handler: async (ctx, args) => {
    const updates = await ctx.db
      .query("collabUpdates")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .take(PAGE_SIZE);
    const carets = await ctx.db
      .query("collabCarets")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .take(PAGE_SIZE);
    for (const row of [...updates, ...carets]) await ctx.db.delete(row._id);
    if (updates.length === PAGE_SIZE || carets.length === PAGE_SIZE) {
      await purge(ctx, args.roomId);
    }
    return null;
  },
});

export const purgeIdleRooms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const idle = await ctx.db
      .query("collabRooms")
      .withIndex("by_updatedAt", (q) =>
        q.lt("updatedAt", dayjs().valueOf() - IDLE_ROOM_MS),
      )
      .take(50);
    for (const room of idle) {
      await ctx.db.delete(room._id);
      await purge(ctx, room._id);
    }
    return null;
  },
});
