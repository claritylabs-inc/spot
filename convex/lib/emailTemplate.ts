// Note: Gmail's image proxy strips data: URIs, so email logos must be absolute
// URLs pointing to a publicly-reachable host serving the asset (e.g. SITE_URL).
// This module owns the shared email HTML shell and generic auth/invite email
// bodies. Notification-specific composition belongs in notificationEmailTemplate.
import type { BrandingContext } from "./branding";
import { getDefaultBranding } from "./branding";
import { getClientPortalUrl, getEmailAssetBaseUrl } from "./domains";
import { SLACK_INSTALL_INVITE_EXPIRATION_DAYS } from "./slackOAuthPolicy";

const SITE_URL = getClientPortalUrl();
const EMAIL_ASSET_BASE_URL = getEmailAssetBaseUrl();
const SLACK_ADD_TO_BUTTON_URL =
  "https://platform.slack-edge.com/img/add_to_slack.png";
const SLACK_ADD_TO_BUTTON_2X_URL =
  "https://platform.slack-edge.com/img/add_to_slack@2x.png";

const EMAIL_COLOR_SCHEME_STYLES = `
:root {
  color-scheme: light dark;
  supported-color-schemes: light dark;
}

.spot-email-lockup-on-dark {
  display: none !important;
  max-height: 0 !important;
  overflow: hidden !important;
}

@media (prefers-color-scheme: dark) {
  body,
  .spot-email-page,
  .spot-email-container {
    background-color: #111111 !important;
  }

  .spot-email-body,
  .spot-email-text-secondary,
  .spot-email-link {
    color: #d1d5db !important;
  }

  .spot-email-text-primary {
    color: #f5f5f5 !important;
  }

  .spot-email-text-muted {
    color: #9ca3af !important;
  }

  .spot-email-surface {
    background-color: #1f1f1f !important;
  }

  .spot-email-divider {
    background-color: #374151 !important;
  }

  .spot-email-button {
    background-color: #f5f5f5 !important;
    color: #111111 !important;
  }

  .spot-email-lockup-on-light {
    display: none !important;
  }

  .spot-email-lockup-on-dark {
    display: block !important;
    max-height: none !important;
    overflow: visible !important;
  }
}

[data-ogsc] .spot-email-body,
[data-ogsc] .spot-email-text-secondary,
[data-ogsc] .spot-email-link {
  color: #d1d5db !important;
}

[data-ogsc] .spot-email-text-primary {
  color: #f5f5f5 !important;
}

[data-ogsc] .spot-email-text-muted {
  color: #9ca3af !important;
}

[data-ogsc] .spot-email-button {
  background-color: #f5f5f5 !important;
  color: #111111 !important;
}

[data-ogsc] .spot-email-lockup-on-light {
  display: none !important;
}

[data-ogsc] .spot-email-lockup-on-dark {
  display: block !important;
  max-height: none !important;
  overflow: visible !important;
}

[data-ogsb] .spot-email-page,
[data-ogsb] .spot-email-container {
  background-color: #111111 !important;
}

[data-ogsb] .spot-email-surface {
  background-color: #1f1f1f !important;
}

[data-ogsb] .spot-email-divider {
  background-color: #374151 !important;
}`;

/** Resolve a logo URL to an absolute URL usable from an email client. */
function absoluteLogoUrl(logoUrl: string, siteUrl: string = SITE_URL): string {
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  const base = siteUrl.replace(/\/$/, "");
  const path = logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`;
  return `${base}${path}`;
}

/** Resolve built-in email assets from a public web host, not the sending domain. */
export function absoluteEmailAssetUrl(assetPath: string): string {
  return absoluteLogoUrl(assetPath, EMAIL_ASSET_BASE_URL);
}

/** Hosted Spot mark used where the app LogoIcon would normally appear. */
export function buildSpotEmailIconHtml({
  size = 20,
  borderRadius = 4,
  margin = "0 8px 0 0",
}: {
  size?: number;
  borderRadius?: number;
  margin?: string;
} = {}): string {
  const iconUrl = absoluteEmailAssetUrl("/spot-icon.jpg");
  return `<img src="${iconUrl}" alt="" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;border-radius:${borderRadius}px;margin:${margin};object-fit:cover;border:0;" />`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildThemeAwareEmailLockup({
  lightBackgroundUrl,
  darkBackgroundUrl,
  alt,
  width,
  height,
}: {
  lightBackgroundUrl: string;
  darkBackgroundUrl: string;
  alt: string;
  width: number;
  height: number;
}): string {
  const sharedStyle = `width:${width}px;height:auto;border:0;outline:none;text-decoration:none;`;
  return `<img src="${lightBackgroundUrl}" alt="${alt}" width="${width}" height="${height}" class="spot-email-lockup-on-light" style="display:block;${sharedStyle}" /><img src="${darkBackgroundUrl}" alt="${alt}" width="${width}" height="${height}" class="spot-email-lockup-on-dark" style="display:none;max-height:0;overflow:hidden;${sharedStyle}" />`;
}

/** Official Spot lockup by default; organization mark and name when white-labeled. */
export function buildEmailLogoHtml(branding: BrandingContext = getDefaultBranding(), _siteUrl: string = SITE_URL): string {
  const name = branding.brandName;
  const isDefaultBrand = name === "Spot";
  if (isDefaultBrand) {
    return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center">
      ${buildThemeAwareEmailLockup({
        lightBackgroundUrl: absoluteEmailAssetUrl("/brand/spot-lockup@2x.png"),
        darkBackgroundUrl: absoluteEmailAssetUrl(
          "/brand/spot-lockup-light@2x.png",
        ),
        alt: "Spot",
        width: 103,
        height: 20,
      })}
    </td>
  </tr>
</table>`;
  }

  const src = /^https?:\/\//i.test(branding.logoUrl)
    ? branding.logoUrl
    : absoluteEmailAssetUrl(branding.logoUrl);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" class="spot-email-text-primary" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1;color:#000000;">
      <img src="${src}" alt="" width="28" height="28" style="display:inline-block;vertical-align:middle;width:28px;height:28px;border-radius:7px;margin-right:10px;object-fit:cover;border:0;" />
      <span style="font-weight:600;vertical-align:middle;">${name}</span>
    </td>
  </tr>
</table>`;
}

/** Canonical publisher attribution for fixed transactional emails. */
export function buildPlatformFooterHtml(_siteUrl: string = SITE_URL): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr>
    <td align="center" valign="middle" class="spot-email-text-muted" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1;">
      from Tools for Enlightenment
    </td>
  </tr>
</table>`;
}

/** Shared email shell: light/dark body, branded logo header, platform footer.
 * Callers provide the unique middle content via `bodyHtml`. */
export function buildEmailShell({
  title,
  bodyHtml,
  branding = getDefaultBranding(),
  siteUrl = SITE_URL,
}: {
  title: string;
  bodyHtml: string;
  branding?: BrandingContext;
  siteUrl?: string;
}): string {
  const logo = buildEmailLogoHtml(branding, siteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>${EMAIL_COLOR_SCHEME_STYLES}</style>
<!--[if mso]>
<style>table{border-collapse:collapse;}td{padding:0;}</style>
<![endif]-->
</head>
<body bgcolor="#ffffff" class="spot-email-page" style="margin:0;padding:0;background-color:#ffffff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="spot-email-page" style="background-color:#ffffff;">
<tr><td align="center" style="padding:40px 16px 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="spot-email-container spot-email-body" style="max-width:520px;background-color:#ffffff;color:#374151;">

<!-- Logo -->
<tr><td align="center" style="padding:36px 40px 0 40px;">${logo}</td></tr>

${bodyHtml}

</table>

<!-- Platform attribution -->
<div style="padding:24px 0 0 0;text-align:center;">
  ${buildPlatformFooterHtml(siteUrl)}
</div>
</td></tr>
</table>
</body>
</html>`;
}

function buildCodeDisplay(token: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td nowrap="nowrap" class="spot-email-text-primary spot-email-surface" style="padding:10px 14px 10px 20px;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:600;letter-spacing:6px;color:#000000;background-color:#f5f5f5;border-radius:8px;">${escapeHtml(token)}</td></tr></table>`;
}

export function buildOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const codeDisplay = buildCodeDisplay(token);

  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-primary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#000000;line-height:1.5;">
    Your sign-in code
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  ${codeDisplay}
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">
    Enter this code in the browser window where you started signing in. It expires in 15 minutes.
  </p>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div class="spot-email-divider" style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    If you didn't request this code, you can safely ignore this email.
  </p>
</td></tr>`;

  const html = buildEmailShell({ title: "Your sign-in code", bodyHtml, branding, siteUrl });
  const text = `Your ${branding.brandName} sign-in code is: ${token}\n\nEnter this code in the browser window where you started signing in. It expires in 15 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;
  return { html, text };
}

export function buildEmailChangeOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const codeDisplay = buildCodeDisplay(token);
  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-primary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:500;color:#000000;line-height:1.5;">
    Confirm your email change
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  ${codeDisplay}
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.5;">
    Enter this code in Spot to finish changing your account email. It expires in 15 minutes.
  </p>
</td></tr>
<tr><td style="padding:32px 40px 0 40px;">
  <div class="spot-email-divider" style="height:1px;background-color:rgba(17,24,39,0.06);"></div>
</td></tr>
<tr><td align="center" style="padding:20px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#9ca3af;line-height:1.5;">
    If you didn't request this change, you can safely ignore this email.
  </p>
</td></tr>`;

  const html = buildEmailShell({ title: "Confirm your email change", bodyHtml, branding, siteUrl });
  const text = `Your ${branding.brandName} email change code is: ${token}\n\nEnter this code in Spot to finish changing your account email. It expires in 15 minutes.\n\nIf you didn't request this change, you can safely ignore this email.`;
  return { html, text };
}

export function buildSlackInstallInviteEmail({
  clientName,
  installUrl,
  mode = "install",
  expiresInDays = SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
  siteUrl = SITE_URL,
}: {
  clientName: string;
  installUrl: string;
  mode?: "install" | "update";
  expiresInDays?: number;
  siteUrl?: string;
}): { html: string; text: string; subject: string } {
  const normalizedClientName = clientName.replace(/[\r\n]+/g, " ").trim();
  const safeClientName = escapeHtml(normalizedClientName);
  const safeInstallUrl = escapeHtml(installUrl);
  const action = mode === "update" ? "Update" : "Install";
  const subject = `${action} the Spot Slack app for ${normalizedClientName}`;
  const bodyHtml = `
<tr><td align="center" style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-primary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.5;">
    ${action} Spot for ${safeClientName} in Slack
  </p>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;">
    ${mode === "update" ? "Approve the latest Spot permissions" : "Install the Spot app once in your workspace"} to work with policies, documents, and insurance requests in private 1:1 messages or any channels where you add it.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${safeInstallUrl}" style="display:inline-block;text-decoration:none;">
    <img src="${SLACK_ADD_TO_BUTTON_URL}" srcset="${SLACK_ADD_TO_BUTTON_URL} 1x, ${SLACK_ADD_TO_BUTTON_2X_URL} 2x" alt="Add to Slack" width="139" height="40" style="display:block;width:139px;height:40px;border:0;" />
  </a>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td valign="top" class="spot-email-text-primary" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">1.</td>
      <td valign="top" class="spot-email-text-secondary" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Choose the <strong class="spot-email-text-secondary" style="color:#374151;">${safeClientName}</strong> Slack workspace.</td>
    </tr>
    <tr>
      <td valign="top" class="spot-email-text-primary" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">2.</td>
      <td valign="top" class="spot-email-text-secondary" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Review the requested permissions, then allow the Spot Slack app.</td>
    </tr>
    <tr>
      <td valign="top" class="spot-email-text-primary" style="width:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">3.</td>
      <td valign="top" class="spot-email-text-secondary" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Add <strong class="spot-email-text-secondary" style="color:#374151;">@Spot</strong> to any channels where you want it to respond.</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <div class="spot-email-surface" style="padding:12px 14px;background-color:#f5f5f5;border-radius:8px;">
    <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#4b5563;line-height:1.6;">
      Clarity Labs sets up your shared support channel separately. You can also add Spot to as many other channels as your team needs. Direct messages stay between that Slack member and Spot; everyone in a channel can see messages and responses posted there.
    </p>
  </div>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    If the button does not work, copy this link into your browser:<br><a href="${safeInstallUrl}" class="spot-email-link" style="color:#6b7280;word-break:break-all;">${safeInstallUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;">
    This one-time invitation expires in ${expiresInDays} days. If you were not expecting it, you can safely ignore this email.
  </p>
</td></tr>`;
  const text = `${action} Spot for ${normalizedClientName} in Slack\n\n${mode === "update" ? "Approve the latest Spot permissions" : "Install the Spot app once in your workspace"} to work with policies, documents, and insurance requests in private 1:1 messages or any channels where you add it.\n\n1. Open the install link: ${installUrl}\n2. Choose the ${normalizedClientName} Slack workspace.\n3. Review the requested permissions, then allow the Spot Slack app.\n4. Add @Spot to any channels where you want it to respond.\n\nClarity Labs sets up your shared support channel separately. You can also add Spot to as many other channels as your team needs. Direct messages stay between that Slack member and Spot; everyone in a channel can see messages and responses posted there.\n\nThis one-time invitation expires in ${expiresInDays} days. If you were not expecting it, you can safely ignore this email.`;

  return {
    subject,
    html: buildEmailShell({
      title: escapeHtml(subject),
      bodyHtml,
      branding: getDefaultBranding(),
      siteUrl,
    }),
    text,
  };
}
