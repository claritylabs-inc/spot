"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import { getSessionUserId } from "../lib/sessionIdentity";
import { OPERATOR_NOTIFICATION_CATEGORIES, operatorNotificationCategoryValidator } from "../lib/operatorNotificationTypes";
import type { NotificationDeliveryOutcome } from "../operatorNotifications";
import { slackWebApi, SlackProviderError } from "../lib/slackWebApi";
import { isDefinitiveSlackRejection } from "../lib/slackErrors";
import { requireSlackMessageId, assertSlackAttachmentsDelivered } from "../lib/slackDelivery";
import { slackRetryDelayMs } from "../lib/slackRetry";

export const listSlackChannels = action({
  args: {},
  handler: async (ctx): Promise<Array<{ id: string; name: string }>> => {
    if (!await getSessionUserId(ctx)) throw new Error("Operator authentication required.");
    const host = await ctx.runQuery(internal.operatorNotifications.settingsContextInternal, {});
    if (!host.available || !host.teamId) return [];
    const channels = await slackWebApi(ctx).listChannels({ teamId: host.teamId });
    return channels.filter(channel => channel.isMember && !channel.isShared)
      .map(({ id, name }) => ({ id, name }));
  },
});

export const setRoute = action({
  args: {
    category: operatorNotificationCategoryValidator, enabled: v.boolean(),
    channelId: v.optional(v.string()), expectedRevision: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!await getSessionUserId(ctx)) throw new Error("Operator authentication required.");
    const host = await ctx.runQuery(internal.operatorNotifications.settingsContextInternal, { category: args.category, forWrite: true });
    const requestedChannelId = args.channelId?.trim();
    const selectionChanged = requestedChannelId !== undefined && requestedChannelId !== host.route?.channelId;
    // A pure disable remains available during outages; a new audience is probed.
    if (!args.enabled && !selectionChanged) return ctx.runMutation(internal.operatorNotifications.saveRouteInternal, {
      category: args.category, enabled: false, expectedRevision: args.expectedRevision,
    });
    const channelId = requestedChannelId ?? host.route?.channelId;
    if (!host.available || !host.teamId || !channelId)
      throw new Error("Choose an available internal Slack channel.");
    const channel = await slackWebApi(ctx).assertJoinedChannel({
      teamId: host.teamId, channelId, allowShared: false,
    });
    await ctx.runMutation(internal.operatorNotifications.saveRouteInternal, {
      category: args.category, enabled: args.enabled, expectedRevision: args.expectedRevision,
      teamId: host.teamId, channelId: channel.id, channelName: channel.name,
    });
    return null;
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("operatorNotificationEvents") },
  handler: async (ctx, args): Promise<null> => {
    const prepared = await ctx.runMutation(internal.operatorNotifications.prepareInternal, args);
    if (!prepared) return null;
    const slack = slackWebApi(ctx);
    try {
      await slack.assertJoinedChannel({ teamId: prepared.teamId, channelId: prepared.channelId, allowShared: false });
    } catch (error) {
      // This probe precedes the send claim and cannot have delivered a message.
      await ctx.runMutation(internal.operatorNotifications.failPreparationInternal, {
        ...args, expectedAttempts: prepared.attempts, routeRevision: prepared.routeRevision,
        retryable: !(error instanceof SlackProviderError) || error.retryable,
      });
      return null;
    }
    const leaseToken = randomUUID();
    const claim = await ctx.runMutation(internal.operatorNotifications.claimInternal, {
      ...args, leaseToken, routeRevision: prepared.routeRevision, expectedAttempts: prepared.attempts,
    });
    if (!claim) return null;
    const copy = OPERATOR_NOTIFICATION_CATEGORIES.find(row => row.category === claim.category)!;
    let outcome: NotificationDeliveryOutcome;
    try {
      const result = await slack.sendMessage({
        clientMessageId: `operator-notification:${args.eventId}`, teamId: claim.teamId,
        channelId: claim.channelId, mrkdwnText: `*${copy.title}*\n${copy.body}\n<${claim.href}|Open in Spot>`,
      });
      assertSlackAttachmentsDelivered(result);
      outcome = { kind: "sent", providerMessageId: requireSlackMessageId(result) };
    } catch (error) {
      // Once invoked, only an explicit no-send rejection permits another send.
      outcome = isDefinitiveSlackRejection(error) ? {
        kind: "rejected", retryable: error.retryable && !["invalid_arguments", "invalid_blocks", "msg_too_long", "no_text"].includes(error.code),
        retryAfterMs: slackRetryDelayMs(error.message, 0),
      } : { kind: "unknown" };
    }
    // Database failures propagate; recovery settles an abandoned sending lease.
    await ctx.runMutation(internal.operatorNotifications.finishInternal, { ...args, leaseToken, outcome });
    return null;
  },
});
