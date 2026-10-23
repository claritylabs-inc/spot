import dayjs from "dayjs";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  OPERATOR_NOTIFICATION_CATEGORIES, isOperatorNotificationTargetCompatible,
  operatorNotificationCategoryValidator,
} from "./lib/operatorNotificationTypes";
import {
  deliverOperatorNotificationRef, operatorNotificationHost, operatorNotificationRoute,
  resolveOperatorNotificationTarget, type OperatorNotificationDestination,
  type OperatorNotificationHost,
} from "./lib/operatorNotify";

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 5 * 60_000;
const LEASE_MS = 120_000;
const RECOVERY_PAGE_SIZE = 50;
type Event = Doc<"operatorNotificationEvents">;
export type NotificationSettingsContext = OperatorNotificationHost & {
  route: Doc<"operatorNotificationRoutes"> | null;
};
export type NotificationPreparation = OperatorNotificationDestination & { attempts: number };
export type NotificationClaim = OperatorNotificationDestination & { href: string; category: Event["category"] };

async function writableOperator(ctx: QueryCtx | MutationCtx) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  return operator;
}

export const getRoutes = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const host = await operatorNotificationHost(ctx);
    const routes = await Promise.all(OPERATOR_NOTIFICATION_CATEGORIES.map(async ({ category }) => {
      const [route, latest] = await Promise.all([
        operatorNotificationRoute(ctx, category),
        ctx.db.query("operatorNotificationEvents")
          .withIndex("by_category_and_createdAt", q => q.eq("category", category)).order("desc").first(),
      ]);
      return {
        category, enabled: route?.enabled ?? false, channelId: route?.channelId,
        channelName: route?.channelName, revision: route?.revision ?? 0,
        latestDelivery: latest ? { status: latest.status, errorCode: latest.errorCode, createdAt: latest.createdAt } : undefined,
      };
    }));
    return { available: host.available, unavailableReason: host.unavailableReason, routes };
  },
});

export const settingsContextInternal = internalQuery({
  args: { category: v.optional(operatorNotificationCategoryValidator), forWrite: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<NotificationSettingsContext> => {
    if (args.forWrite) await writableOperator(ctx);
    else await requireOperator(ctx);
    return { ...await operatorNotificationHost(ctx), route: args.category ? await operatorNotificationRoute(ctx, args.category) : null };
  },
});

export const saveRouteInternal = internalMutation({
  args: {
    category: operatorNotificationCategoryValidator, enabled: v.boolean(), expectedRevision: v.number(),
    teamId: v.optional(v.string()), channelId: v.optional(v.string()), channelName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const operator = await writableOperator(ctx);
    const route = await operatorNotificationRoute(ctx, args.category);
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 ||
      (route?.revision ?? 0) !== args.expectedRevision)
      throw new Error("Notification settings changed. Reload and try again.");
    const selectingChannel = args.channelId !== undefined;
    if (args.enabled || selectingChannel) {
      const host = await operatorNotificationHost(ctx);
      if (!host.available || !args.teamId || args.teamId !== host.teamId || !args.channelId || !args.channelName)
        throw new Error("The Slack notification destination is unavailable.");
    }
    const patch = {
      enabled: args.enabled, revision: (route?.revision ?? 0) + 1,
      teamId: selectingChannel ? args.teamId : route?.teamId,
      channelId: selectingChannel ? args.channelId : route?.channelId,
      channelName: selectingChannel ? args.channelName : route?.channelName,
      updatedBy: operator.userId, updatedAt: dayjs().valueOf(),
    };
    if (route) await ctx.db.patch(route._id, patch);
    else await ctx.db.insert("operatorNotificationRoutes", { category: args.category, ...patch });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId, type: "setup_write", summary: "Updated operator notification route",
      metadata: { category: args.category, enabled: args.enabled, channelId: patch.channelId, revision: patch.revision },
    });
    await ctx.scheduler.runAfter(0, internal.operatorNotifications.cancelStaleRoutesInternal, { category: args.category, cursor: null });
    return null;
  },
});

export const cancelStaleRoutesInternal = internalMutation({
  args: { category: operatorNotificationCategoryValidator, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const route = await operatorNotificationRoute(ctx, args.category);
    const page = await ctx.db.query("operatorNotificationEvents")
      .withIndex("by_category_and_status", q => q.eq("category", args.category).eq("status", "pending"))
      .order("desc").paginate({ cursor: args.cursor, numItems: RECOVERY_PAGE_SIZE });
    for (const event of page.page) {
      if (event.status === "pending" && (!route?.enabled || route.revision !== event.routeRevision))
        await ctx.db.patch(event._id, {
          status: "cancelled", errorCode: "route_changed", nextAttemptAt: undefined, updatedAt: dayjs().valueOf(),
        });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.operatorNotifications.cancelStaleRoutesInternal, { category: args.category, cursor: page.continueCursor });
    return null;
  },
});

async function currentTarget(ctx: MutationCtx, event: Event): Promise<string | null> {
  const route = await operatorNotificationRoute(ctx, event.category);
  if (!route?.enabled || !event.teamId || !event.channelId || route.revision !== event.routeRevision ||
    route.teamId !== event.teamId || route.channelId !== event.channelId ||
    event.teamId !== process.env.SLACK_CLARITY_TEAM_ID?.trim()) {
    await ctx.db.patch(event._id, {
      status: "cancelled", errorCode: "route_changed", nextAttemptAt: undefined, updatedAt: dayjs().valueOf(),
    });
    return null;
  }
  const href = isOperatorNotificationTargetCompatible(event) && await resolveOperatorNotificationTarget(ctx, event.target);
  if (!href) {
    await ctx.db.patch(event._id, {
      status: "cancelled", errorCode: "source_unavailable", nextAttemptAt: undefined, updatedAt: dayjs().valueOf(),
    });
    return null;
  }
  return href;
}

async function rejectedBeforeDelivery(ctx: MutationCtx, event: Event, retryable: boolean, errorCode: string, retryAfterMs = 0) {
  const now = dayjs().valueOf();
  const retry = retryable && event.attempts < MAX_ATTEMPTS &&
    Number.isFinite(retryAfterMs) && retryAfterMs <= MAX_BACKOFF_MS;
  const nextAttemptAt = retry
    ? dayjs(now).add(Math.max(Math.min(60_000, 1000 * 2 ** event.attempts), retryAfterMs), "millisecond").valueOf()
    : undefined;
  await ctx.db.patch(event._id, {
    status: retry ? "pending" : "failed", attempts: event.attempts,
    errorCode, nextAttemptAt, leaseToken: undefined, leaseUntil: undefined, updatedAt: now,
  });
  if (nextAttemptAt !== undefined)
    await ctx.scheduler.runAt(nextAttemptAt, deliverOperatorNotificationRef, { eventId: event._id });
}

export const prepareInternal = internalMutation({
  args: { eventId: v.id("operatorNotificationEvents") },
  handler: async (ctx, { eventId }): Promise<NotificationPreparation | null> => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending" || (event.nextAttemptAt ?? 0) > dayjs().valueOf()) return null;
    if (!await currentTarget(ctx, event)) return null;
    if (event.attempts >= MAX_ATTEMPTS) {
      await rejectedBeforeDelivery(ctx, event, false, "attempts_exhausted");
      return null;
    }
    const host = await operatorNotificationHost(ctx);
    if (!host.available) {
      await rejectedBeforeDelivery(ctx, { ...event, attempts: event.attempts + 1 }, true, "host_unavailable");
      return null;
    }
    return { teamId: event.teamId!, channelId: event.channelId!, routeRevision: event.routeRevision!, attempts: event.attempts };
  },
});

export const failPreparationInternal = internalMutation({
  args: {
    eventId: v.id("operatorNotificationEvents"), expectedAttempts: v.number(), routeRevision: v.number(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== "pending" || event.attempts !== args.expectedAttempts ||
      event.routeRevision !== args.routeRevision || !await currentTarget(ctx, event)) return null;
    await rejectedBeforeDelivery(ctx, { ...event, attempts: event.attempts + 1 }, args.retryable, "channel_unavailable");
    return null;
  },
});

export const claimInternal = internalMutation({
  args: {
    eventId: v.id("operatorNotificationEvents"), leaseToken: v.string(),
    routeRevision: v.number(), expectedAttempts: v.number(),
  },
  handler: async (ctx, args): Promise<NotificationClaim | null> => {
    const event = await ctx.db.get(args.eventId);
    const now = dayjs().valueOf();
    if (!event || event.status !== "pending" || (event.nextAttemptAt ?? 0) > now ||
      event.attempts !== args.expectedAttempts || event.routeRevision !== args.routeRevision || event.attempts >= MAX_ATTEMPTS) return null;
    const href = await currentTarget(ctx, event);
    if (!href) return null;
    if (!(await operatorNotificationHost(ctx)).available) {
      await rejectedBeforeDelivery(ctx, { ...event, attempts: event.attempts + 1 }, true, "host_unavailable");
      return null;
    }
    const leaseUntil = dayjs(now).add(LEASE_MS, "millisecond").valueOf();
    await ctx.db.patch(event._id, {
      status: "sending", attempts: event.attempts + 1, leaseToken: args.leaseToken,
      leaseUntil, nextAttemptAt: undefined, errorCode: undefined, updatedAt: now,
    });
    await ctx.scheduler.runAt(leaseUntil, internal.operatorNotifications.recoverInternal, {});
    return { teamId: event.teamId!, channelId: event.channelId!, routeRevision: event.routeRevision!, href, category: event.category };
  },
});

const outcomeValidator = v.union(
  v.object({ kind: v.literal("sent"), providerMessageId: v.string() }),
  v.object({ kind: v.literal("rejected"), retryable: v.boolean(), retryAfterMs: v.optional(v.number()) }),
  v.object({ kind: v.literal("unknown") }),
);
export type NotificationDeliveryOutcome = Infer<typeof outcomeValidator>;

export const finishInternal = internalMutation({
  args: { eventId: v.id("operatorNotificationEvents"), leaseToken: v.string(), outcome: outcomeValidator },
  handler: async (ctx, args): Promise<null> => {
    const event = await ctx.db.get(args.eventId);
    const now = dayjs().valueOf();
    if (!event || event.status !== "sending" || event.leaseToken !== args.leaseToken || (event.leaseUntil ?? 0) <= now) return null;
    if (args.outcome.kind === "rejected") {
      // A rejected send may retry only on its original, still-current route.
      if (!await currentTarget(ctx, event)) {
        await ctx.db.patch(event._id, { leaseToken: undefined, leaseUntil: undefined });
        return null;
      }
      await rejectedBeforeDelivery(ctx, event, args.outcome.retryable, "slack_rejected",
        Number.isFinite(args.outcome.retryAfterMs) ? Math.max(0, args.outcome.retryAfterMs ?? 0) : 0);
    } else {
      await ctx.db.patch(event._id, {
        status: args.outcome.kind, leaseToken: undefined, leaseUntil: undefined, updatedAt: now,
        ...(args.outcome.kind === "sent"
          ? { providerMessageId: args.outcome.providerMessageId, sentAt: now, errorCode: undefined }
          : { errorCode: "send_outcome_unknown" }),
      });
    }
    return null;
  },
});

export const recoverInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; unknown: number }> => {
    const now = dayjs().valueOf();
    const [pending, sending] = await Promise.all([
      ctx.db.query("operatorNotificationEvents").withIndex("by_status_and_nextAttemptAt",
        q => q.eq("status", "pending").lte("nextAttemptAt", now)).take(RECOVERY_PAGE_SIZE),
      ctx.db.query("operatorNotificationEvents").withIndex("by_status_and_leaseUntil",
        q => q.eq("status", "sending").lte("leaseUntil", now)).take(RECOVERY_PAGE_SIZE),
    ]);
    let scheduled = 0;
    for (const event of pending) {
      if (!await currentTarget(ctx, event)) continue;
      if (event.attempts >= MAX_ATTEMPTS) {
        await rejectedBeforeDelivery(ctx, event, false, "attempts_exhausted");
        continue;
      }
      await ctx.scheduler.runAfter(0, deliverOperatorNotificationRef, { eventId: event._id });
      scheduled++;
    }
    for (const event of sending) {
      await ctx.db.patch(event._id, {
        status: "unknown", errorCode: "send_outcome_unknown", leaseToken: undefined,
        leaseUntil: undefined, nextAttemptAt: undefined, updatedAt: now,
      });
    }
    return { scheduled, unknown: sending.length };
  },
});
