// convex/lib/notify.ts
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  COALESCE_WINDOW_MS,
  NOTIFICATION_SEVERITY,
  buildCoalesceKey,
  type NotificationSeverity,
  type NotificationType,
  slackNotificationCategory,
} from "./notificationTypes";
import { resolveChannelPreference } from "../notificationPreferences";
import { resolveSlackAutomaticChannelId } from "./slackChannelRouting";
import {
  isSlackBindingReachable,
  isSlackConnectionHealthy,
} from "./slackAvailability";

export interface NotifyArgs {
  orgId: Id<"organizations">;
  type: NotificationType;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  userId?: Id<"users">;
  relatedOrgId?: Id<"organizations">;
  actionType?: string;
  actionPayload?: unknown;
  sourceRef?: unknown;
  coalesceKeyParts?: string[];
  /** Injectable for testing; defaults to dayjs().valueOf() */
  nowMs?: number;
}

export const notifyPolicyExtractionReviewInternal = internalMutation({
  args: { policyId: v.id("policies"), questionCount: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy || args.questionCount < 1) return false;
    const scanImport = await ctx.db
      .query("operatorWorkspaceScanImports")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .first();
    if (scanImport) return false;
    const label =
      policy.policyNumber && policy.policyNumber !== "Unknown"
        ? `policy ${policy.policyNumber}`
        : policy.carrier
          ? `${policy.carrier} policy`
          : "a policy";
    await ctx.runMutation(internal.lib.notify.notifyInternal, {
      orgId: policy.orgId,
      type: "incomplete_extraction",
      title: "Policy extraction needs review",
      body: `Spot finished extracting ${label}, but ${args.questionCount} coverage ${args.questionCount === 1 ? "term needs" : "terms need"} review.`,
      severity: "warning",
      actionType: "view_policy",
      actionPayload: { policyId: args.policyId, tab: "review" },
      sourceRef: { policyId: args.policyId, kind: "extraction_review" },
    });
    return true;
  },
});

/**
 * Resolve whether a given user should receive email for a notification type.
 * Exported for testability.
 */
export async function resolveEmailPreference(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: NotificationType,
  severity: NotificationSeverity,
): Promise<{ shouldEmail: boolean }> {
  return {
    shouldEmail: await resolveChannelPreference(ctx, {
      userId,
      orgId,
      type,
      channel: "email",
      severity,
    }),
  };
}

async function resolveImessagePreference(
  ctx: MutationCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
  type: NotificationType,
  severity: NotificationSeverity,
): Promise<boolean> {
  return await resolveChannelPreference(ctx, {
    userId,
    orgId,
    type,
    channel: "imessage",
    severity,
  });
}

/**
 * Internal mutation — the single notification creation path.
 * Exposed as `internal.lib.notify.notifyInternal` for cross-module use.
 */
export const notifyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    severity: v.optional(
      v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    ),
    userId: v.optional(v.id("users")),
    relatedOrgId: v.optional(v.id("organizations")),
    actionType: v.optional(v.string()),
    actionPayload: v.optional(v.any()),
    sourceRef: v.optional(v.any()),
    coalesceKeyParts: v.optional(v.array(v.string())),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"notifications">> => {
    const type = args.type as NotificationType;
    const nowMs = args.nowMs ?? dayjs().valueOf();
    const severity = args.severity ?? NOTIFICATION_SEVERITY[type] ?? "info";

    // 1. Coalesce
    let coalesceKey: string | undefined;
    const windowMs = COALESCE_WINDOW_MS[type];

    if (args.coalesceKeyParts && windowMs) {
      coalesceKey = buildCoalesceKey(args.coalesceKeyParts, windowMs, nowMs);

      const existing = await ctx.db
        .query("notifications")
        .withIndex("coalesce_status", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("coalesceKey", coalesceKey!)
            .eq("status", "unread"),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          coalescedCount: (existing.coalescedCount ?? 1) + 1,
          lastEventAt: nowMs,
          body: args.body,
          title: args.title,
        });
        return existing._id;
      }
    }

    // 2. Insert new notification
    const notificationId = await ctx.db.insert("notifications", {
      orgId: args.orgId,
      userId: args.userId,
      type,
      title: args.title,
      body: args.body,
      severity,
      status: "unread",
      actionType: args.actionType,
      actionPayload: args.actionPayload,
      sourceRef: args.sourceRef,
      relatedOrgId: args.relatedOrgId,
      coalesceKey,
      coalescedCount: 1,
      lastEventAt: nowMs,
      emailStatus: "not_scheduled",
      imessageStatus: "not_scheduled",
      slackStatus: "not_scheduled",
      createdAt: nowMs,
    });

    // 3. External scheduling — per-user or org-wide
    const memberships = args.userId
      ? [{ userId: args.userId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("organization", (q) => q.eq("orgId", args.orgId))
          .collect();

    let anyEmailScheduled = false;
    let anyImessageScheduled = false;
    for (const m of memberships) {
      const { shouldEmail } = await resolveEmailPreference(
        ctx,
        m.userId,
        args.orgId,
        type,
        severity,
      );
      if (shouldEmail) {
        anyEmailScheduled = true;
      }
      const shouldImessage = await resolveImessagePreference(
        ctx,
        m.userId,
        args.orgId,
        type,
        severity,
      );
      if (shouldImessage) anyImessageScheduled = true;
      if (anyEmailScheduled && anyImessageScheduled) break;
    }

    if (anyEmailScheduled) {
      await ctx.db.patch(notificationId, { emailStatus: "scheduled" });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.sendNotificationEmail.send,
        {
          notificationId,
        },
      );
    } else {
      // Determine if suppressed by preference or just not applicable
      const hasPrefs = memberships.length > 0;
      await ctx.db.patch(notificationId, {
        emailStatus: hasPrefs ? "suppressed_by_preference" : "not_scheduled",
      });
    }

    if (anyImessageScheduled) {
      await ctx.db.patch(notificationId, { imessageStatus: "scheduled" });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.sendNotificationImessage.send,
        {
          notificationId,
        },
      );
    } else {
      const hasPrefs = memberships.length > 0;
      await ctx.db.patch(notificationId, {
        imessageStatus: hasPrefs ? "suppressed_by_preference" : "not_scheduled",
      });
    }

    const slackCategory = args.userId ? null : slackNotificationCategory(type);
    const channelSettings = slackCategory
      ? await ctx.db
          .query("agentChannelSettings")
          .withIndex("client", (q) => q.eq("clientOrgId", args.orgId))
          .first()
      : null;
    const shouldSendSlack =
      channelSettings?.slackEnabled === true &&
      (slackCategory === "safe"
        ? channelSettings.slackSafeAlertsEnabled
        : channelSettings.slackVendorAlertsEnabled);
    if (shouldSendSlack) {
      const connection = await ctx.db
        .query("slackWorkspaceConnections")
        .withIndex("client_status", (q) =>
          q.eq("clientOrgId", args.orgId).eq("status", "active"),
        )
        .first();
      const primary = connection
        ? ((await ctx.db
            .query("slackChannelBindings")
            .withIndex("connection_status", (q) =>
              q.eq("connectionId", connection._id).eq("status", "active"),
            )
            .first()) ??
          (await ctx.db
            .query("slackChannelBindings")
            .withIndex("connection_status", (q) =>
              q.eq("connectionId", connection._id).eq("status", "unavailable"),
            )
            .first()))
        : null;
      if (
        connection &&
        isSlackConnectionHealthy(connection) &&
        (!primary || isSlackBindingReachable(primary)) &&
        resolveSlackAutomaticChannelId(
          connection,
          isSlackBindingReachable(primary) ? primary : null,
        )
      ) {
        await ctx.db.patch(notificationId, { slackStatus: "scheduled" });
        await ctx.scheduler.runAfter(
          0,
          (internal as any).actions.sendNotificationSlack.send,
          { notificationId },
        );
      } else {
        await ctx.db.patch(notificationId, {
          slackStatus: "suppressed_by_preference",
        });
      }
    } else {
      await ctx.db.patch(notificationId, {
        slackStatus: slackCategory
          ? "suppressed_by_preference"
          : "not_scheduled",
      });
    }

    return notificationId;
  },
});

/**
 * Convenience wrapper called from other Convex mutations.
 * Usage: await notify(ctx, { orgId, type, title, body, ... })
 */
export async function notify(
  ctx: MutationCtx,
  args: NotifyArgs,
): Promise<Id<"notifications">> {
  return await ctx.runMutation(internal.lib.notify.notifyInternal, args);
}
