import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { extractEmailAddress } from "./emailAddress";
import type { InboxRecord } from "./providerOutreachValidators";
import { getEmailDeliveryMode, isSpotOutboundAddress } from "./resend";
import {
  capturedResourceId,
  ensureInbox,
  ensureOutreachInboxLabels,
  isCapturedResourceId,
  ResendInboxError,
  updateInbox,
} from "./resendInbox";
import {
  agentInboxAddress,
  assertTeamLocalpart,
  deriveOperatorLocalpart,
  getTeamEmailDomain,
  operatorFromName,
  operatorTeamAddress,
  TeamEmailError,
} from "./teamEmail";

/**
 * Inbox lifecycle for team email: create (or adopt) the operator's Resend
 * inbox, retire it when the address changes, and repair a stale `fromName`
 * lazily. Naming rules live in `teamEmail.ts`, transport in `resendInbox.ts`,
 * storage in `convex/operatorInboxes.ts`.
 *
 * `EMAIL_DELIVERY_MODE=capture` makes no Resend call and writes no row; the
 * result is flagged `captured` with placeholder ids that
 * `isCapturedResourceId` recognises. Under `restricted`, setup calls run
 * (they send nothing); the transport enforces recipients at draft/send time.
 */

export type EnsuredTeamInbox = {
  inbox: InboxRecord;
  /** Capture mode: `inbox` carries placeholder ids and nothing was persisted. */
  captured: boolean;
};

export type EnsuredOperatorInbox = EnsuredTeamInbox & {
  /** The operator's saved Always CC address, if any. Validated when saved, not here. */
  alwaysCcEmail: string | null;
};

function capturedInbox(key: string, emailAddress: string, fromName: string): InboxRecord {
  return {
    inboxId: capturedResourceId("inbox", key),
    emailAddress,
    fromName,
    labelIds: {
      automated: capturedResourceId("label", `${key}:automated`),
      needsReply: capturedResourceId("label", `${key}:needsReply`),
    },
  };
}

/**
 * Brings Resend and the database to `desired`:
 * - the stored active inbox already has this address: only `fromName` is
 *   repaired (Resend first, then the row);
 * - otherwise the inbox is created (or adopted on a 409), labelled and
 *   recorded, and `persist` retires whatever it replaces.
 */
async function reconcileInbox(
  ctx: ActionCtx,
  desired: { emailAddress: string; fromName: string },
  current: InboxRecord | null,
  persist: (inbox: InboxRecord) => Promise<InboxRecord | null>,
): Promise<InboxRecord> {
  const usable =
    current &&
    !isCapturedResourceId(current.inboxId) &&
    current.emailAddress.toLowerCase() === desired.emailAddress
      ? current
      : null;

  if (usable) {
    if (usable.fromName === desired.fromName) return usable;
    const updated = await updateInbox({
      inboxId: usable.inboxId,
      fromName: desired.fromName,
    });
    if (updated.status !== "ok") throw unavailable("updateInbox");
    await ctx.runMutation(internal.operatorInboxes.updateInboxFromNameInternal, {
      inboxId: usable.inboxId,
      fromName: desired.fromName,
    });
    return { ...usable, fromName: desired.fromName };
  }

  const ensured = await ensureInbox({
    emailAddress: desired.emailAddress,
    fromName: desired.fromName,
    name: desired.emailAddress,
  });
  if (ensured.status !== "ok" || isCapturedResourceId(ensured.data.id)) {
    throw unavailable("ensureInbox");
  }
  // An adopted inbox must be the exact address derived for this identity.
  if (ensured.data.emailAddress.toLowerCase() !== desired.emailAddress) {
    throw new ResendInboxError("permanent", "ensureInbox", "inbox address mismatch", {
      code: "inbox_address_mismatch",
    });
  }
  if (ensured.data.adopted && ensured.data.fromName !== desired.fromName) {
    const updated = await updateInbox({
      inboxId: ensured.data.id,
      fromName: desired.fromName,
    });
    if (updated.status !== "ok") throw unavailable("updateInbox");
  }
  const labels = await ensureOutreachInboxLabels(ensured.data.id);
  if (labels.status !== "ok") throw unavailable("ensureLabels");

  const stored = await persist({
    inboxId: ensured.data.id,
    emailAddress: desired.emailAddress,
    fromName: desired.fromName,
    labelIds: labels.data,
  });
  if (!stored) {
    throw new ResendInboxError(
      "permanent",
      "ensureInbox",
      "inbox is already registered to another owner",
      { code: "inbox_conflict" },
    );
  }
  return stored;
}

function unavailable(operation: "ensureInbox" | "updateInbox" | "ensureLabels") {
  return new ResendInboxError(
    "permanent",
    operation,
    "inbox provisioning unavailable",
    { code: "captured_resource_id" },
  );
}

/**
 * The operator's team inbox, created or repaired as needed. The address is
 * `operatorProfiles.teamEmailLocalpart` (else derived from the login email) on
 * `getTeamEmailDomain()`; the display name is the operator's full name.
 *
 * Throws `TeamEmailError` (`name_required`, `invalid_localpart`,
 * `reserved_localpart`, `not_configured`) for identity problems the operator
 * must fix, and `ResendInboxError` for transport failures.
 */
export async function ensureOperatorInbox(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<EnsuredOperatorInbox> {
  const identity = await ctx.runQuery(
    internal.operatorInboxes.getTeamIdentityInternal,
    { userId },
  );
  const fromName = operatorFromName(identity.name);
  const localpart = identity.teamEmailLocalpart
    ? assertTeamLocalpart(identity.teamEmailLocalpart)
    : identity.email
      ? deriveOperatorLocalpart(identity.email)
      : null;
  if (!localpart) {
    throw new TeamEmailError(
      "invalid_localpart",
      "Your account has no email; set a team address in Profile",
    );
  }
  const emailAddress = operatorTeamAddress(localpart, getTeamEmailDomain());

  if (getEmailDeliveryMode() === "capture") {
    return {
      inbox: capturedInbox(String(userId), emailAddress, fromName),
      captured: true,
      alwaysCcEmail: identity.alwaysCcEmail,
    };
  }
  const inbox = await reconcileInbox(
    ctx,
    { emailAddress, fromName },
    identity.inbox,
    (candidate) =>
      ctx.runMutation(internal.operatorInboxes.recordOperatorInboxInternal, {
        userId,
        inbox: candidate,
      }),
  );
  return { inbox, captured: false, alwaysCcEmail: identity.alwaysCcEmail };
}

/**
 * The shared command-channel inbox (`agent@team…`, `kind: "agent"`), created
 * or repaired as needed. Its display name is "Spot".
 */
export async function ensureAgentInbox(ctx: ActionCtx): Promise<EnsuredTeamInbox> {
  const emailAddress = agentInboxAddress(getTeamEmailDomain());
  const fromName = "Spot";
  if (getEmailDeliveryMode() === "capture") {
    return { inbox: capturedInbox("agent", emailAddress, fromName), captured: true };
  }
  const current = await ctx.runQuery(internal.operatorInboxes.getAgentInboxInternal, {});
  const inbox = await reconcileInbox(
    ctx,
    { emailAddress, fromName },
    current,
    (candidate) =>
      ctx.runMutation(internal.operatorInboxes.recordAgentInboxInternal, {
        inbox: candidate,
      }),
  );
  return { inbox, captured: false };
}

/**
 * Validates an operator's Always CC setting: exactly one address, not
 * Spot-owned (agent, notification, auth or team domains), and not one of the
 * operator's own addresses (`ownAddresses`: team address and login emails).
 * Returns the normalized address; throws `TeamEmailError("invalid_always_cc")`.
 * Restricted delivery mode still applies at send time.
 */
export function validateAlwaysCcEmail(
  value: string,
  ownAddresses: readonly string[],
): string {
  const invalid = (message: string) => new TeamEmailError("invalid_always_cc", message);
  if (/[,;]/.test(value)) throw invalid("Enter a single Always CC address");
  const address = extractEmailAddress(value);
  if (!address) throw invalid("Enter a valid email address");
  if (isSpotOutboundAddress(address)) {
    throw invalid("Always CC cannot be a Spot address");
  }
  const own = new Set(
    ownAddresses.map((a) => (extractEmailAddress(a) ?? a.trim().toLowerCase())),
  );
  if (own.has(address)) {
    throw invalid("Always CC cannot be your own address");
  }
  return address;
}
