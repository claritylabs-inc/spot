import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { RecordInboxResult } from "../operatorInboxes";
import { extractEmailAddress } from "./emailAddress";
import { gmailInboxId } from "./operatorGmail";
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
  operatorFromName,
  operatorTeamAddressFor,
  TeamEmailError,
} from "./teamEmail";

export type EnsuredTeamInbox = {
  inbox: InboxRecord;
  /** Capture mode: placeholder ids, no Resend call, nothing persisted. */
  captured: boolean;
};

export type EnsuredOperatorInbox = EnsuredTeamInbox & {
  /** The saved Always CC address; validated when saved, not here. */
  alwaysCcEmail: string | null;
};

type Persist = Promise<RecordInboxResult>;

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

function unavailable(operation: "ensureInbox" | "updateInbox" | "ensureLabels") {
  return new ResendInboxError("permanent", operation, "inbox provisioning unavailable", {
    code: "captured_resource_id",
  });
}

function conflict() {
  return new ResendInboxError(
    "permanent",
    "ensureInbox",
    "inbox address is already registered to another owner",
    { code: "inbox_conflict" },
  );
}

async function assertAddressAvailable(
  ctx: ActionCtx,
  emailAddress: string,
  userId?: Id<"users">,
): Promise<void> {
  const ownership = await ctx.runQuery(
    internal.operatorInboxes.addressOwnershipInternal,
    { emailAddress, userId },
  );
  if (ownership === "conflict") throw conflict();
}

/**
 * Brings Resend and the database to `desired`. A stored inbox at this address
 * only needs `fromName` repaired. Otherwise the inbox is created (or adopted
 * on a 409), labelled and persisted; persisting retires the inbox it replaces.
 * An adopted inbox is persisted with its remote `fromName` and repaired only
 * afterwards, so a concurrent claim of the address is rejected before Resend
 * is modified.
 */
async function reconcileInbox(
  ctx: ActionCtx,
  desired: { emailAddress: string; fromName: string },
  current: InboxRecord | null,
  persist: (inbox: InboxRecord) => Persist,
): Promise<InboxRecord> {
  let inbox =
    current &&
    !isCapturedResourceId(current.inboxId) &&
    current.emailAddress.toLowerCase() === desired.emailAddress
      ? current
      : null;

  if (!inbox) {
    const ensured = await ensureInbox({
      emailAddress: desired.emailAddress,
      fromName: desired.fromName,
      name: desired.emailAddress,
    });
    if (ensured.status !== "ok" || isCapturedResourceId(ensured.data.id)) {
      throw unavailable("ensureInbox");
    }
    if (ensured.data.emailAddress.toLowerCase() !== desired.emailAddress) {
      throw new ResendInboxError("permanent", "ensureInbox", "inbox address mismatch", {
        code: "inbox_address_mismatch",
      });
    }
    const labels = await ensureOutreachInboxLabels(ensured.data.id);
    if (labels.status !== "ok") throw unavailable("ensureLabels");

    const recorded = await persist({
      inboxId: ensured.data.id,
      emailAddress: desired.emailAddress,
      fromName: ensured.data.fromName ?? "",
      labelIds: labels.data,
    });
    if (recorded.status === "conflict") throw conflict();
    if (recorded.status === "stale") {
      throw new ResendInboxError(
        "transient",
        "ensureInbox",
        "operator team address changed; retry",
        { code: "inbox_stale" },
      );
    }
    inbox = recorded.inbox;
  }

  if (inbox.fromName !== desired.fromName) {
    const updated = await updateInbox({
      inboxId: inbox.inboxId,
      fromName: desired.fromName,
    });
    if (updated.status !== "ok") throw unavailable("updateInbox");
    await ctx.runMutation(internal.operatorInboxes.updateInboxFromNameInternal, {
      inboxId: inbox.inboxId,
      fromName: desired.fromName,
    });
    inbox = { ...inbox, fromName: desired.fromName };
  }
  return inbox;
}

/**
 * The operator's team inbox, created or repaired as needed. Requires an active
 * operator. The address is their saved team localpart (else derived from the
 * login email) on the team domain; the display name is their full name.
 *
 * Throws `TeamEmailError` for identity problems the operator must fix
 * (`name_required`, `invalid_localpart`, `reserved_localpart`,
 * `not_configured`) and `ResendInboxError` for transport failures and address
 * conflicts (`inbox_conflict`, permanent; checked before any Resend mutation).
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
  const emailAddress = operatorTeamAddressFor(identity);
  await assertAddressAvailable(ctx, emailAddress, userId);

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

export const GMAIL_RECONNECT_MESSAGE =
  "Your connected Gmail needs to be reconnected before Spot can send from it. Reconnect it in Profile, or send from your Spot address.";

/** A Gmail send is refused locally: nothing was sent and it never falls back to Resend. */
export function gmailReconnectError(operation: string) {
  return new ResendInboxError("blocked", operation, GMAIL_RECONNECT_MESSAGE, {
    code: "gmail_needs_reconnect",
  });
}

/** The sender a send resolved to: a Resend team inbox or the operator's connected Gmail. */
export type ResolvedOperatorSender = {
  inbox: Pick<InboxRecord, "inboxId" | "emailAddress" | "fromName">;
  /** Capture mode: placeholder ids, no provider call. */
  captured: boolean;
};

/**
 * The inbox an operator send goes out from. `fromAddress` is the address in the
 * draft's From: the operator's ACTIVE connected Gmail resolves to its
 * `google:` inbox (same `fromName` as the team inbox); a connected Gmail that
 * is not active blocks with a visible error, never falling back to Resend;
 * anything else is the team inbox, which `ensureOperatorInbox` reconciles with
 * Resend as always.
 */
export async function resolveOperatorSender(
  ctx: ActionCtx,
  userId: Id<"users">,
  fromAddress: string | null | undefined,
): Promise<ResolvedOperatorSender> {
  const from = fromAddress?.trim().toLowerCase();
  const connection = from
    ? await ctx.runQuery(internal.operatorGmail.getByOwnerInternal, { userId })
    : null;
  if (!from || !connection || connection.address !== from) {
    return await ensureOperatorInbox(ctx, userId);
  }
  if (connection.status !== "active") throw gmailReconnectError("sendDraft");
  const identity = await ctx.runQuery(
    internal.operatorInboxes.getTeamIdentityInternal,
    { userId },
  );
  const fromName = operatorFromName(identity.name);
  return getEmailDeliveryMode() === "capture"
    ? { inbox: capturedInbox(`${userId}:gmail`, connection.address, fromName), captured: true }
    : {
        inbox: { inboxId: gmailInboxId(connection.address), emailAddress: connection.address, fromName },
        captured: false,
      };
}

/**
 * The shared command-channel inbox (`agent@team…`, `kind: "agent"`), created
 * or repaired as needed with the display name "Spot". Never adopts an address
 * held by an operator row (`inbox_conflict`).
 */
export async function ensureAgentInbox(ctx: ActionCtx): Promise<EnsuredTeamInbox> {
  const emailAddress = agentInboxAddress();
  const fromName = "Spot";
  await assertAddressAvailable(ctx, emailAddress);

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
 * Validates Always CC: one address, not Spot-owned, not in `ownAddresses` (the
 * team address and login emails). Returns it normalized or throws
 * `TeamEmailError("invalid_always_cc")`.
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
