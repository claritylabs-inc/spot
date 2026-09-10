// convex/notifications.ts
import dayjs from "dayjs";
import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { getCurrentOrgAccess as getOrgAccess, requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

type NotificationVisibilityRow = {
  status: string;
  type: string;
  userId?: Id<"users">;
};

function isBaseVisibleNotification(notification: { status: string; type: string }) {
  return notification.status !== "dismissed";
}

function filterVisibleNotifications<T extends NotificationVisibilityRow>(
  rows: T[],
  userId?: Id<"users">,
) {
  return rows.filter(
    (notification) =>
      isBaseVisibleNotification(notification) &&
      (!notification.userId || !userId || notification.userId === userId),
  );
}

// ── Public queries ──────────────────────────────────────────────────────────

export const listInbox = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("actioned"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access || access.orgId !== args.orgId) return [];

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query("notifications")
      .withIndex("organization_status", (q) =>
        args.status
          ? q.eq("orgId", args.orgId).eq("status", args.status)
          : q.eq("orgId", args.orgId)
      )
      .order("desc")
      .take(limit * 2); // over-fetch to filter dismissed

    const visible = filterVisibleNotifications(rows, access.userId).slice(0, limit);

    // Enrich with relatedOrg name when present
    const enriched = await Promise.all(
      visible.map(async (n) => {
        if (!n.relatedOrgId) return { ...n, relatedOrgName: undefined };
        const org = await ctx.db.get(n.relatedOrgId);
        return { ...n, relatedOrgName: org?.name };
      })
    );

    return enriched;
  },
});

export const unreadCount = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return 0;
    const orgId = args.orgId ?? access.orgId;
    if (orgId !== access.orgId) return 0;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", orgId).eq("status", "unread")
      )
      .take(100);
    return filterVisibleNotifications(unread, access.userId).length;
  },
});

// ── Public mutations ────────────────────────────────────────────────────────

export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireOrgAccess(ctx);
    for (const id of args.ids) {
      const n = await ctx.db.get(id);
      if (
        n &&
        n.orgId === orgId &&
        (!n.userId || n.userId === userId)
      ) {
        await ctx.db.patch(id, { status: "read" });
      }
    }
  },
});

export const markAllRead = mutation({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    const orgId = args.orgId ?? access.orgId;
    if (orgId !== access.orgId) {
      throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
    }

    const unread = await ctx.db
      .query("notifications")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", orgId).eq("status", "unread")
      )
      .collect();
    await Promise.all(
      unread
        .filter((notification) =>
          !notification.userId || notification.userId === access.userId,
        )
        .map((notification) =>
          ctx.db.patch(notification._id, { status: "read" }),
        ),
    );
  },
});

// ── Internal mutations / queries ────────────────────────────────────────────

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
    sourceRef: v.optional(v.any()),
    userId: v.optional(v.id("users")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      ...(args as Parameters<typeof ctx.db.insert<"notifications">>[1]),
      status: "unread",
      createdAt: dayjs().valueOf(),
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const listInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .order("desc")
      .take(limit * 2); // over-fetch to filter dismissed
    return filterVisibleNotifications(rows, args.userId).slice(0, limit);
  },
});

export const patchEmailStatus = internalMutation({
  args: {
    id: v.id("notifications"),
    emailStatus: v.union(
      v.literal("not_scheduled"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("suppressed_by_preference"),
      v.literal("failed"),
    ),
    emailSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const patchImessageStatus = internalMutation({
  args: {
    id: v.id("notifications"),
    imessageStatus: v.union(
      v.literal("not_scheduled"),
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("suppressed_by_preference"),
      v.literal("failed"),
    ),
    imessageSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

export const sweepStale = internalMutation({
  args: {},
  // Keep already-scheduled sweeps harmless; unread notifications require a decision.
  handler: async () => {},
});
