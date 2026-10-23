"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getAuthSiteUrl } from "../lib/domains";
import { buildNotificationEmail } from "../lib/notificationEmailTemplate";
import { getNotificationFromAddress, sendResendEmail } from "../lib/resend";

/**
 * Emails the owner of an unlinked team conversation when genuine inbound mail
 * arrives. Linked conversations notify through `mailbox_attention`; this covers
 * mail with no client to file a notification under. Only the known inbox owner
 * is notified, never for mail Spot sent, and delivery goes through the shared
 * sender, so capture and restricted modes apply.
 */
export const notifyOwnerOfUnlinkedMail = internalAction({
  args: { userId: v.id("users"), threadId: v.id("teamEmailThreads") },
  handler: async (ctx, args): Promise<{ status: "sent" | "skipped" | "failed" }> => {
    const context = await ctx.runQuery(internal.teamInbox.unlinkedMailNotificationInternal, args);
    if (!context) return { status: "skipped" };
    const siteUrl = getAuthSiteUrl();
    const email = buildNotificationEmail({
      title: "New email in the team inbox",
      body: `${context.from}: ${context.subject}${context.preview ? ` — ${context.preview}` : ""}`,
      ctaUrl: `${siteUrl}/operator/inbox/${args.threadId}`,
      ctaLabel: "Open in Spot",
      siteUrl,
    });
    const result = await sendResendEmail(
      {
        from: getNotificationFromAddress(email.fromName),
        to: context.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      { retries: 2 },
    );
    if (!result.ok) console.error("[team-inbox] owner notification failed");
    return { status: result.ok ? "sent" : "failed" };
  },
});
