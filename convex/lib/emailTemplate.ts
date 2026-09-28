// Note: Gmail's image proxy strips data: URIs, so email logos must be absolute
// URLs pointing to a publicly-reachable host serving the asset (e.g. SITE_URL).
// Layout, dark-mode styling and generic bodies live in @claritylabs-inc/ui/lib/email;
// this module binds them to Spot branding and hosted assets, and owns the Slack invite.
import {
  absoluteEmailUrl,
  buildCodeEmailBodyHtml,
  buildEmailFooterHtml,
  buildEmailIconHtml,
  buildEmailLockupHtml,
  buildEmailNamedLogoHtml,
  buildEmailShell as buildSharedEmailShell,
  escapeHtml,
} from "@claritylabs-inc/ui/lib/email";
import type { BrandingContext } from "./branding";
import { getDefaultBranding } from "./branding";
import { getClientPortalUrl, getEmailAssetBaseUrl } from "./domains";
import { SLACK_INSTALL_INVITE_EXPIRATION_DAYS } from "./slackOAuthPolicy";

export { escapeHtml };

const SITE_URL = getClientPortalUrl();
const EMAIL_ASSET_BASE_URL = getEmailAssetBaseUrl();
const SLACK_ADD_TO_BUTTON_URL =
  "https://platform.slack-edge.com/img/add_to_slack.png";
const SLACK_ADD_TO_BUTTON_2X_URL =
  "https://platform.slack-edge.com/img/add_to_slack@2x.png";

/** Resolve built-in email assets from a public web host, not the sending domain. */
export function absoluteEmailAssetUrl(assetPath: string): string {
  return absoluteEmailUrl(assetPath, EMAIL_ASSET_BASE_URL);
}

/** Hosted Spot mark used where the app LogoIcon would normally appear. */
export function buildSpotEmailIconHtml(
  options: { size?: number; borderRadius?: number; margin?: string } = {},
): string {
  return buildEmailIconHtml({
    src: absoluteEmailAssetUrl("/spot-icon.jpg"),
    ...options,
  });
}

/** Official Spot lockup by default; organization mark and name when white-labeled. */
export function buildEmailLogoHtml(
  branding: BrandingContext = getDefaultBranding(),
  _siteUrl: string = SITE_URL,
): string {
  if (branding.brandName === "Spot") {
    return buildEmailLockupHtml({
      lightBackgroundUrl: absoluteEmailAssetUrl("/brand/spot-lockup@2x.png"),
      darkBackgroundUrl: absoluteEmailAssetUrl("/brand/spot-lockup-light@2x.png"),
      alt: "Spot",
      width: 103,
      height: 20,
    });
  }
  return buildEmailNamedLogoHtml({
    logoSrc: absoluteEmailAssetUrl(branding.logoUrl),
    name: branding.brandName,
  });
}

/** Canonical publisher attribution for fixed transactional emails. */
export function buildPlatformFooterHtml(_siteUrl: string = SITE_URL): string {
  return buildEmailFooterHtml("from Tools for Enlightenment");
}

/** Spot-branded shell. Callers provide the unique middle content via `bodyHtml`. */
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
  return buildSharedEmailShell({
    title,
    bodyHtml,
    logoHtml: buildEmailLogoHtml(branding, siteUrl),
    footerHtml: buildPlatformFooterHtml(siteUrl),
  });
}

export function buildOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const bodyHtml = buildCodeEmailBodyHtml({
    heading: "Your sign-in code",
    token,
    instructions:
      "Enter this code in the browser window where you started signing in. It expires in 15 minutes.",
    disclaimer: "If you didn't request this code, you can safely ignore this email.",
  });
  const html = buildEmailShell({ title: "Your sign-in code", bodyHtml, branding, siteUrl });
  const text = `Your ${branding.brandName} sign-in code is: ${token}\n\nEnter this code in the browser window where you started signing in. It expires in 15 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;
  return { html, text };
}

export function buildEmailChangeOtpEmail(token: string, siteUrl: string = SITE_URL, branding: BrandingContext = getDefaultBranding()): { html: string; text: string } {
  const bodyHtml = buildCodeEmailBodyHtml({
    heading: "Confirm your email change",
    token,
    instructions:
      "Enter this code in Spot to finish changing your account email. It expires in 15 minutes.",
    disclaimer: "If you didn't request this change, you can safely ignore this email.",
  });
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
  <p class="cl-email-text-primary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:#000000;line-height:1.5;">
    ${action} Spot for ${safeClientName} in Slack
  </p>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
  <p class="cl-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;">
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
      <td valign="top" class="cl-email-text-primary" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">1.</td>
      <td valign="top" class="cl-email-text-secondary" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Choose the <strong class="cl-email-text-secondary" style="color:#374151;">${safeClientName}</strong> Slack workspace.</td>
    </tr>
    <tr>
      <td valign="top" class="cl-email-text-primary" style="width:24px;padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">2.</td>
      <td valign="top" class="cl-email-text-secondary" style="padding:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Review the requested permissions, then allow the Spot Slack app.</td>
    </tr>
    <tr>
      <td valign="top" class="cl-email-text-primary" style="width:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#000000;line-height:1.6;">3.</td>
      <td valign="top" class="cl-email-text-secondary" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;">Add <strong class="cl-email-text-secondary" style="color:#374151;">@Spot</strong> to any channels where you want it to respond.</td>
    </tr>
  </table>
</td></tr>
<tr><td style="padding:24px 40px 0 40px;">
  <div class="cl-email-surface" style="padding:12px 14px;background-color:#f5f5f5;border-radius:8px;">
    <p class="cl-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#4b5563;line-height:1.6;">
      Clarity Labs sets up your shared support channel separately. You can also add Spot to as many other channels as your team needs. Direct messages stay between that Slack member and Spot; everyone in a channel can see messages and responses posted there.
    </p>
  </div>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p class="cl-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    If the button does not work, copy this link into your browser:<br><a href="${safeInstallUrl}" class="cl-email-link" style="color:#6b7280;word-break:break-all;">${safeInstallUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p class="cl-email-text-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;">
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
