"use node";

import { Auth, google } from "googleapis";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { gmailPushTopic, gmailSyncEnabled } from "./gmailThreadBinding";
import {
  GoogleWorkspaceProviderError,
  createGoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";
import { gmailOAuthClient } from "./operatorGmailOAuth";
import { isResendInboxError } from "./resendInbox";
import { decryptSecret } from "./secretBox";

/** What the profile card says; fixed text, never a provider message. */
export const SYNC_NOTES = {
  reconnect: "Reconnect Gmail to keep checking replies.",
  throttled: "Google is rate limiting Gmail checks; Spot will retry.",
  failed: "Gmail checks hit an error; Spot will retry on the next update.",
  watchFailed: "Gmail push updates could not be started; Spot still checks when you open a thread.",
  historyExpired: "Gmail history expired; Spot re-checked recent conversations.",
} as const;

const DEFAULT_THROTTLE_MS = 60 * 1000;
const QUOTA_THROTTLE_MS = 60 * 60 * 1000;
const RATE_LIMIT_REASONS = ["ratelimitexceeded", "userratelimitexceeded"];
const QUOTA_REASONS = ["quotaexceeded", "dailylimitexceeded"];
const WATCH_LABELS = ["INBOX", "SENT"];

/** How a failed Gmail call should be handled. Mirrors the send path's `mapGmailError` classes. */
export type SyncFailure =
  | { kind: "reconnect" }
  | { kind: "throttled"; retryAfterMs: number }
  | { kind: "not_found" }
  | { kind: "transient"; status: number | null }
  | { kind: "permanent"; status: number | null };

export function classifySyncError(error: unknown): SyncFailure {
  // The connected-account client: a lapsed grant blocks, an unreachable Google is transient.
  if (isResendInboxError(error))
    return error.outcome === "blocked" ? { kind: "reconnect" } : { kind: "transient", status: null };
  if (!(error instanceof GoogleWorkspaceProviderError)) return { kind: "transient", status: null };
  const { status, reasons } = error;
  if (status === 401) return { kind: "reconnect" };
  if (reasons.some((reason) => QUOTA_REASONS.includes(reason)))
    return { kind: "throttled", retryAfterMs: QUOTA_THROTTLE_MS };
  if (status === 429 || reasons.some((reason) => RATE_LIMIT_REASONS.includes(reason)))
    return { kind: "throttled", retryAfterMs: error.retryAfterMs ?? DEFAULT_THROTTLE_MS };
  if (status === 404) return { kind: "not_found" };
  if (status === null || status >= 500 || status === 408) return { kind: "transient", status };
  return { kind: "permanent", status };
}

/** Log-safe description of a failure: the class and status, never the error object. */
export const describeFailure = (failure: SyncFailure) =>
  "status" in failure ? `${failure.kind}:${failure.status ?? "none"}` : failure.kind;

/** Start (or renew) the connection's Gmail watch. A no-op without a topic or in capture mode. */
export async function startWatch(
  ctx: ActionCtx,
  connection: { _id: Id<"operatorGmailConnections">; address: string },
) {
  const topicName = gmailPushTopic();
  if (!topicName || !gmailSyncEnabled()) return false;
  const watch = await createGoogleWorkspaceProvider({ kind: "oauth", ctx }).watch({
    mailbox: connection.address,
    topicName,
    labelIds: WATCH_LABELS,
    labelFilterBehavior: "include",
  });
  const expiresAt = Number(watch.expiration);
  if (!Number.isFinite(expiresAt)) throw new Error("Gmail returned no watch expiry.");
  await ctx.runMutation(internal.operatorGmailSync.recordWatchInternal, {
    connectionId: connection._id,
    ...(watch.historyId ? { historyId: watch.historyId } : {}),
    watchExpiresAt: expiresAt,
  });
  return true;
}

/**
 * Stops the connection's watch with its own stored grant, whatever its status.
 * Best effort: a revoked grant cannot stop it, and Google lets an unrenewed
 * watch lapse within a week.
 */
export async function stopWatchBestEffort(connection: Doc<"operatorGmailConnections">) {
  if (!connection.encryptedRefreshToken) return;
  try {
    const auth = gmailOAuthClient();
    auth.setCredentials({ refresh_token: decryptSecret(connection.encryptedRefreshToken) });
    await google.gmail({ version: "v1", auth }).users.stop({ userId: "me" });
  } catch {
    // Nothing to report: see above.
  }
}

// ---------------------------------------------------------------------------
// Pub/Sub push authentication
// ---------------------------------------------------------------------------

export function gmailPushAudience() {
  const configured = process.env.GOOGLE_GMAIL_PUSH_AUDIENCE?.trim();
  if (configured) return configured;
  const origin = process.env.CONVEX_SITE_URL;
  return origin ? new URL("/operator-gmail/push", origin).toString() : null;
}

/**
 * Whether the request carries a Google-signed OIDC token for the configured
 * push service account and audience. Anything unverifiable, including a
 * missing configuration, is rejected.
 */
export async function verifyPushAuthorization(authorization: string): Promise<boolean> {
  const idToken = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  const serviceAccount = process.env.GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT?.trim().toLowerCase();
  const audience = gmailPushAudience();
  if (!idToken || !serviceAccount || !audience) return false;
  try {
    const ticket = await new Auth.OAuth2Client().verifyIdToken({ idToken, audience });
    const claims = ticket.getPayload();
    return claims?.email_verified === true && claims.email?.toLowerCase() === serviceAccount;
  } catch {
    return false;
  }
}

/** The address and history id of a Gmail push notification, or null when malformed. */
export function decodePushNotification(body: string) {
  try {
    const envelope = JSON.parse(body) as { message?: { data?: unknown } };
    if (typeof envelope.message?.data !== "string") return null;
    const data = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")) as {
      emailAddress?: unknown;
      historyId?: unknown;
    };
    const historyId = String(data.historyId ?? "");
    if (typeof data.emailAddress !== "string" || !/^\d{1,20}$/.test(historyId)) return null;
    return { emailAddress: data.emailAddress.trim().toLowerCase(), historyId };
  } catch {
    return null;
  }
}
