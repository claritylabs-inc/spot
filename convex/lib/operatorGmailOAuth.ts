"use node";

import { google } from "googleapis";
import { ConvexError } from "convex/values";

const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;

export function gmailOAuthRedirectUrl() {
  const origin = process.env.CONVEX_SITE_URL;
  if (!origin) throw new Error("CONVEX_SITE_URL is required for Gmail OAuth");
  return new URL("/operator-gmail/oauth/callback", origin).toString();
}

export function gmailOAuthConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY
  );
}

export function gmailOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new ConvexError("Gmail connections are not configured.");
  return new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri: gmailOAuthRedirectUrl(),
    transporterOptions: { timeout: GOOGLE_REQUEST_TIMEOUT_MS },
  });
}

/** Google reports a revoked or expired refresh token as `invalid_grant`. */
export function isInvalidGrant(error: unknown) {
  const data = (error as { response?: { data?: { error?: unknown } } } | null)
    ?.response?.data;
  return (
    data?.error === "invalid_grant" ||
    (error instanceof Error && error.message.includes("invalid_grant"))
  );
}
