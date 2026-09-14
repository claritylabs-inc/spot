"use node";

import dayjs from "dayjs";
import { canonicalAgentAddress } from "../lib/agentEmailDomains";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { buildNotificationEmail } from "../lib/notificationEmailTemplate";
import {
  getAgentDomains,
  getNotificationFromAddress,
  sendResendEmail,
} from "../lib/resend";
import { getPortalUrlForOrg } from "../lib/domains";
import { resolveNotificationThreadContext } from "../lib/notificationThreadContext";

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.runQuery(
      internal.notifications.getInternal,
      { id: args.notificationId },
    );

    if (!notification) return;
    if (notification.emailStatus !== "scheduled") return;

    const recipientOrg = await ctx.runQuery(
      internal.organizations.getInternal,
      { id: notification.orgId },
    );
    if (!recipientOrg) return;

    const {
      thread: contextThread,
      privateThreadOwner,
      threadLabel,
    } = await resolveNotificationThreadContext(ctx, notification);

    // Collect recipients (user-targeted or org-wide)
    const memberships = privateThreadOwner
      ? [{ userId: privateThreadOwner }]
      : notification.userId
        ? [{ userId: notification.userId }]
        : await ctx.runQuery(internal.organizations.listMembershipsForOrg, {
            orgId: notification.orgId,
          });

    // Preference check at send time
    const type = notification.type;
    const severity = notification.severity;

    const recipientsToEmail: Array<{ email: string }> = [];

    for (const m of memberships) {
      const user = await ctx.runQuery(internal.users.getInternal, {
        id: m.userId,
      });
      if (!user?.email) continue;

      const shouldEmail = await ctx.runQuery(
        internal.notificationPreferences.resolveChannelForUser,
        {
          userId: m.userId,
          orgId: notification.orgId,
          type,
          channel: "email",
          severity,
        },
      );
      if (shouldEmail) {
        recipientsToEmail.push({ email: user.email });
      }
    }

    if (recipientsToEmail.length === 0) {
      await ctx.runMutation(internal.notifications.patchEmailStatus, {
        id: args.notificationId,
        emailStatus: "suppressed_by_preference",
      });
      return;
    }

    // Notification emails are Spot-branded. Broker white-labeling was retired
    // when broker organizations became supplier profiles.
    const siteUrl = getPortalUrlForOrg(recipientOrg);
    // Build CTA URL from actionPayload or fallback to inbox
    const ctaUrl = buildCtaUrl(
      notification.actionType,
      notification.actionPayload,
      siteUrl,
    );
    const replyThread =
      notification.actionType === "view_thread" ? contextThread : null;
    const replyTo = trustedThreadReplyAddress(replyThread?.threadEmail);

    const emailContent = buildNotificationEmail({
      title: notification.title,
      body: notification.body,
      ctaUrl,
      ctaLabel: notificationCtaLabel(type),
      siteUrl,
      threadLabel,
    });

    // Send to all recipients
    const to = recipientsToEmail.map((r) => r.email);

    const result = await sendResendEmail(
      {
        from: getNotificationFromAddress(emailContent.fromName),
        to,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
      { retries: 2 },
    );

    if (result.ok) {
      await ctx.runMutation(internal.notifications.patchEmailStatus, {
        id: args.notificationId,
        emailStatus: "sent",
        emailSentAt: dayjs().valueOf(),
      });
    } else {
      await ctx.runMutation(internal.notifications.patchEmailStatus, {
        id: args.notificationId,
        emailStatus: "failed",
      });
      console.error(
        `[sendNotificationEmail] Failed to send notification ${args.notificationId}`,
      );
    }
  },
});

function notificationCtaLabel(type: string): string {
  switch (type) {
    default:
      return "View in Spot";
  }
}

function trustedThreadReplyAddress(
  value: string | undefined,
): string | undefined {
  const address = value?.trim();
  if (!address || /[\r\n]/.test(address)) return undefined;
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return undefined;
  const domain = address.slice(at + 1).toLowerCase();
  return getAgentDomains().includes(domain)
    ? canonicalAgentAddress(address)
    : undefined;
}

function buildCtaUrl(
  actionType: string | undefined,
  actionPayload: unknown,
  siteUrl: string,
): string {
  if (!actionType || !actionPayload) return `${siteUrl}/notifications`;
  const p = actionPayload as Record<string, unknown>;
  switch (actionType) {
    case "view_policy":
      return `${siteUrl}/policies/${p.policyId}${p.tab ? `?tab=${encodeURIComponent(String(p.tab))}` : ""}`;
    case "view_thread":
      return `${siteUrl}/agent/thread/${p.threadId}`;
    case "view_vendor_compliance":
      return `${siteUrl}/connect/vendors`;
    default:
      return `${siteUrl}/notifications`;
  }
}
