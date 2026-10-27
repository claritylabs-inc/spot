import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { actionConfirmationFingerprint } from "./actionConfirmationFingerprint";
import { validateAlwaysCcEmail } from "./operatorInbox";
import { operatorEmailAliases, requireOperatorForUser } from "./operatorIdentity";
import { normalizeGmailAddress } from "./inboxIds";
import {
  isTeamEmailError,
  operatorFromHeader,
  operatorFromName,
  operatorTeamAddressFor,
  type TeamEmailErrorCode,
} from "./teamEmail";

/**
 * The person an outreach email is sent as: full name, personal team address and
 * Always CC, read from the profile without provisioning anything. Its
 * `fingerprint` binds a launch approval, a saved draft and the final send
 * checkpoint to the same identity: any change to the name, the From name, the
 * team address or the validated Always CC changes it. The fingerprint covers the
 * configured Always CC, not the per-recipient list (which only drops a CC that
 * equals the recipient), so a preview can compute it before a recipient is known.
 */
export type OutreachSenderIdentity = {
  senderUserId: Id<"users">;
  name: string;
  fromName: string;
  /** `Full Name <address>` as it appears in From. */
  fromHeader: string;
  /** The operator's personal team address. */
  address: string;
  /** The validated Always CC, or null when none is saved. */
  alwaysCc: string | null;
  fingerprint: string;
};

export type OutreachSenderIdentityResult =
  | { ok: true; identity: OutreachSenderIdentity }
  | {
      ok: false;
      code: TeamEmailErrorCode | "operator_inactive";
      /** Readable and fixable by the operator in Profile. */
      message: string;
    };

export async function outreachIdentityFingerprint(parts: {
  senderUserId: Id<"users">;
  name: string;
  fromName: string;
  address: string;
  alwaysCc: string | null;
}) {
  return await actionConfirmationFingerprint({
    kind: "outreach_sender_identity",
    senderUserId: String(parts.senderUserId),
    name: parts.name,
    fromName: parts.fromName,
    address: parts.address.toLowerCase(),
    alwaysCc: parts.alwaysCc?.toLowerCase() ?? null,
  });
}

export async function outreachSenderIdentity(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
): Promise<OutreachSenderIdentityResult> {
  let loaded: Awaited<ReturnType<typeof requireOperatorForUser>>;
  try {
    loaded = await requireOperatorForUser(ctx, operatorUserId);
  } catch {
    return { ok: false, code: "operator_inactive", message: "The sender is not an active operator" };
  }
  const { user, profile } = loaded;
  try {
    const name = (user.name ?? "").replace(/\s+/g, " ").trim();
    const fromName = operatorFromName(name);
    const address = operatorTeamAddressFor({
      email: user.email ?? null,
      teamEmailLocalpart: profile.teamEmailLocalpart ?? null,
    });
    const alwaysCc = profile.alwaysCcEmail
      ? validateAlwaysCcEmail(profile.alwaysCcEmail, [
          address,
          ...(user.email ? [user.email, ...operatorEmailAliases(user.email)] : []),
        ])
      : null;
    return {
      ok: true,
      identity: {
        senderUserId: operatorUserId,
        name,
        fromName,
        fromHeader: operatorFromHeader(name, address),
        address,
        alwaysCc,
        fingerprint: await outreachIdentityFingerprint({
          senderUserId: operatorUserId,
          name,
          fromName,
          address,
          alwaysCc,
        }),
      },
    };
  } catch (error) {
    if (isTeamEmailError(error))
      return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/** The identity operator email is composed from, flattened for the draft and reply paths. */
export type OperatorSenderIdentity = {
  senderUserId: Id<"users">;
  /** Full name, whitespace-collapsed, as signed. */
  name: string;
  /** `Full Name <address>`; the name is sanitized for the header only. */
  fromHeader: string;
  teamAddress: string;
  alwaysCc: string | null;
};

/** `outreachSenderIdentity` for callers that treat an unusable sender as an error. */
export async function operatorSenderIdentity(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
): Promise<OperatorSenderIdentity> {
  const result = await outreachSenderIdentity(ctx, operatorUserId);
  if (!result.ok) throw new Error(result.message);
  const { identity } = result;
  return {
    senderUserId: identity.senderUserId,
    name: identity.name,
    fromHeader: identity.fromHeader,
    teamAddress: identity.address,
    alwaysCc: identity.alwaysCc,
  };
}

/**
 * The identity a launch is approved with. Throws a readable error when it is
 * unusable, or when `expectedFingerprint` (from the preview the operator
 * approved) no longer matches, so the operator reviews the new From and CC.
 */
export async function assertOutreachIdentity(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
  expectedFingerprint?: string,
) {
  const result = await outreachSenderIdentity(ctx, operatorUserId);
  if (!result.ok) throw new Error(result.message);
  if (expectedFingerprint !== undefined && expectedFingerprint !== result.identity.fingerprint)
    throw new Error(
      "Your sender name, team address or Always CC changed since you reviewed this. Review the new From and CC and approve again.",
    );
  return result.identity;
}

/**
 * What a launch preview shows and approves: From (name and team address), the
 * Always CC, and the fingerprint to send back as `expectedIdentityFingerprint`.
 * `problem` is set (and the rest null) when the operator must fix their Profile
 * first; a launch is refused until then.
 */
export type OutreachSenderPanel = {
  name: string | null;
  fromName: string | null;
  fromHeader: string | null;
  /** The personal team address that appears in From. */
  address: string | null;
  alwaysCc: string | null;
  fingerprint: string | null;
  problem: string | null;
};

export async function outreachSenderPanel(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
): Promise<OutreachSenderPanel> {
  const result = await outreachSenderIdentity(ctx, operatorUserId);
  if (!result.ok)
    return {
      name: null,
      fromName: null,
      fromHeader: null,
      address: null,
      alwaysCc: null,
      fingerprint: null,
      problem: result.message,
    };
  const { identity } = result;
  return {
    name: identity.name,
    fromName: identity.fromName,
    fromHeader: identity.fromHeader,
    address: identity.address,
    alwaysCc: identity.alwaysCc,
    fingerprint: identity.fingerprint,
    problem: null,
  };
}

/** Which of the operator's two sending accounts a browser reply or new email goes out from. */
export const sendFromValidator = v.union(v.literal("spot"), v.literal("gmail"));
export type SendFrom = "spot" | "gmail";

export type SendFromOptions = { spot: string; gmail?: string };

/** The operator's connected Gmail in any status, or null. */
export async function operatorGmailConnection(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"operatorGmailConnections"> | null> {
  return await ctx.db
    .query("operatorGmailConnections")
    .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
    .first();
}

export type SendFromChoice =
  | {
      ok: true;
      sendFrom: SendFrom;
      /** The address in From when `sendFrom` is "gmail". */
      gmailAddress?: string;
      /** The connected Gmail in any status; never a correspondent to copy. */
      connectedAddress?: string;
      options: SendFromOptions;
    }
  | { ok: false; reason: string };

/**
 * The sending account for a reply or new email. Gmail is offered only while
 * the connection is active, and is the reply default only when the thread
 * involves that Gmail; a request for Gmail without an active connection is
 * refused rather than sent from the Spot address.
 */
export async function resolveSendFrom(
  ctx: QueryCtx | MutationCtx,
  identity: Pick<OperatorSenderIdentity, "senderUserId" | "teamAddress">,
  requested: SendFrom | undefined,
  threadGmailAddress?: string,
): Promise<SendFromChoice> {
  const connection = await operatorGmailConnection(ctx, identity.senderUserId);
  const active = connection?.status === "active" ? connection.address : undefined;
  const sendFrom: SendFrom =
    requested ??
    (active && threadGmailAddress && normalizeGmailAddress(threadGmailAddress) === active
      ? "gmail"
      : "spot");
  if (sendFrom === "gmail" && !active) {
    return {
      ok: false,
      reason: connection
        ? "Your connected Gmail needs to be reconnected before you can send from it."
        : "Connect Gmail in Profile to send from it.",
    };
  }
  return {
    ok: true,
    sendFrom,
    ...(sendFrom === "gmail" ? { gmailAddress: active } : {}),
    ...(connection ? { connectedAddress: connection.address } : {}),
    options: { spot: identity.teamAddress, ...(active ? { gmail: active } : {}) },
  };
}

/** `Full Name <address>` for the sending account. */
export const senderFromHeader = (
  identity: Pick<OperatorSenderIdentity, "name" | "fromHeader">,
  gmailAddress?: string,
) => (gmailAddress ? operatorFromHeader(identity.name, gmailAddress) : identity.fromHeader);
