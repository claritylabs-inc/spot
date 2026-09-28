// convex/lib/notificationEmailTemplate.ts
// Notification-email composition built on the shared shell in emailTemplate.
import { DEFAULT_CLIENT_PORTAL_URL } from "./domains";
import {
  buildNotificationEmailBodyHtml,
} from "@claritylabs-inc/ui/lib/email";
import { buildEmailShell, escapeHtml } from "./emailTemplate";

const SITE_URL_DEFAULT = DEFAULT_CLIENT_PORTAL_URL;
const NOTIFICATION_FROM_NAME = "Spot Notifications";

export interface BuildNotificationEmailArgs {
  title: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  siteUrl?: string;
  threadLabel?: string;
}

export interface NotificationEmailResult {
  fromName: string;
  subject: string;
  html: string;
  text: string;
}

export function buildNotificationEmail(
  args: BuildNotificationEmailArgs,
): NotificationEmailResult {
  const {
    title,
    body,
    ctaUrl,
    ctaLabel,
    siteUrl = SITE_URL_DEFAULT,
    threadLabel,
  } = args;

  const html = buildEmailShell({
    title: escapeHtml(title),
    bodyHtml: buildNotificationEmailBodyHtml({
      title,
      body,
      ctaUrl,
      ctaLabel,
      linkLabel: "Open in Spot",
      threadLabel,
    }),
    siteUrl,
  });

  const text = [
    threadLabel ? `Thread: ${threadLabel}` : null,
    title,
    "",
    body,
    "",
    `${ctaLabel}: ${ctaUrl}`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return { fromName: NOTIFICATION_FROM_NAME, subject: title, html, text };
}
