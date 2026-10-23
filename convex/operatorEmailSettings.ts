import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { ensureOperatorInbox, validateAlwaysCcEmail } from "./lib/operatorInbox";
import {
  operatorEmailAliases,
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { getEmailDeliveryMode } from "./lib/resend";
import { isResendInboxError } from "./lib/resendInbox";
import { getSessionUserId } from "./lib/sessionIdentity";
import {
  agentInboxAddress,
  deriveOperatorLocalpart,
  getTeamEmailDomain,
  isTeamEmailError,
  operatorFromName,
  operatorTeamAddress,
  validateTeamLocalpart,
} from "./lib/teamEmail";

/** The signed-in operator's own team email settings; nothing here takes a user id. */

type SettingsFailure = { ok: false; message: string };
type SaveTeamAddressResult =
  | SettingsFailure
  | { ok: true; address: string; changed: boolean };
type SaveAlwaysCcResult =
  | SettingsFailure
  | { ok: true; alwaysCcEmail: string | null };

export type TeamInboxSetupStatus =
  | "ready"
  | "captured"
  | "needs_name"
  | "needs_setup"
  | "not_configured";

/** Shape of `getTeamIdentityInternal`, annotated to break the api type cycle. */
type TeamIdentity = {
  name: string | null;
  email: string | null;
  teamEmailLocalpart: string | null;
  alwaysCcEmail: string | null;
  inbox: { emailAddress: string } | null;
};

function teamDomainOrNull() {
  try {
    return getTeamEmailDomain();
  } catch {
    return null;
  }
}

function derivedLocalpart(email: string | null | undefined) {
  if (!email) return null;
  try {
    return deriveOperatorLocalpart(email);
  } catch {
    return null;
  }
}

function hasUsableName(name: string | null) {
  try {
    operatorFromName(name);
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): SettingsFailure {
  return { ok: false, message };
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const domain = teamDomainOrNull();
    const identity: TeamIdentity = await ctx.runQuery(
      internal.operatorInboxes.getTeamIdentityInternal,
      { userId: operator.userId },
    );
    if (!domain) {
      return {
        configured: false as const,
        alwaysCcEmail: identity.alwaysCcEmail,
      };
    }
    const defaultLocalpart = derivedLocalpart(identity.email);
    const localpart = identity.teamEmailLocalpart ?? defaultLocalpart ?? "";
    const address = localpart ? operatorTeamAddress(localpart, domain) : null;
    const activeAddress = identity.inbox?.emailAddress.toLowerCase() ?? null;
    const status: TeamInboxSetupStatus = !address
      ? "needs_setup"
      : !hasUsableName(identity.name)
        ? "needs_name"
        : getEmailDeliveryMode() === "capture"
          ? "captured"
          : activeAddress === address
            ? "ready"
            : "needs_setup";
    return {
      configured: true as const,
      domain,
      localpart,
      defaultLocalpart,
      customLocalpart: identity.teamEmailLocalpart !== null,
      address,
      previousAddress:
        activeAddress && activeAddress !== address ? activeAddress : null,
      status,
      alwaysCcEmail: identity.alwaysCcEmail,
      commandAddress: agentInboxAddress(domain),
    };
  },
});

/**
 * Saves the intended team address; empty restores the default from the login
 * email. Nothing external changes: the caller then runs `ensureInbox`, and the
 * old inbox keeps receiving until the new one is recorded.
 */
export const saveTeamAddress = mutation({
  args: { localpart: v.string() },
  handler: async (ctx, args): Promise<SaveTeamAddressResult> => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const domain = teamDomainOrNull();
    if (!domain) return fail("Team email is not configured for this environment");

    const requested = args.localpart.trim();
    let localpart: string;
    if (requested) {
      const validation = validateTeamLocalpart(requested);
      if (!validation.ok) return fail(validation.message);
      localpart = validation.localpart;
    } else {
      const fallback = derivedLocalpart(operator.user.email);
      if (!fallback) {
        return fail("Your login email cannot be used as a team address; enter one");
      }
      localpart = fallback;
    }

    const address = operatorTeamAddress(localpart, domain);
    const ownership = await ctx.runQuery(
      internal.operatorInboxes.addressOwnershipInternal,
      { emailAddress: address, userId: operator.userId },
    );
    if (ownership === "conflict") {
      return fail(`${address} is already used by another team member`);
    }

    const stored = requested ? localpart : undefined;
    const changed = (operator.profile.teamEmailLocalpart ?? undefined) !== stored;
    if (changed) {
      await ctx.db.patch(operator.profile._id, {
        teamEmailLocalpart: stored,
        updatedAt: dayjs().valueOf(),
      });
    }
    return { ok: true, address, changed };
  },
});

/** Saves or clears (empty value) the permanent Always CC address. */
export const saveAlwaysCc = mutation({
  args: { value: v.string() },
  handler: async (ctx, args): Promise<SaveAlwaysCcResult> => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const value = args.value.trim();
    let alwaysCcEmail: string | undefined;
    if (value) {
      const domain = teamDomainOrNull();
      const localpart =
        operator.profile.teamEmailLocalpart ??
        derivedLocalpart(operator.user.email);
      const own = [
        ...(domain && localpart ? [operatorTeamAddress(localpart, domain)] : []),
        ...operatorEmailAliases(operator.user.email),
        ...(operator.user.email ? [operator.user.email] : []),
        operator.profile.email,
      ];
      try {
        alwaysCcEmail = validateAlwaysCcEmail(value, own);
      } catch (error) {
        if (isTeamEmailError(error)) return fail(error.message);
        throw error;
      }
    }
    if ((operator.profile.alwaysCcEmail ?? undefined) !== alwaysCcEmail) {
      await ctx.db.patch(operator.profile._id, {
        alwaysCcEmail,
        updatedAt: dayjs().valueOf(),
      });
    }
    return { ok: true, alwaysCcEmail: alwaysCcEmail ?? null };
  },
});

/** Authorizes `ensureInbox`: an active operator who is not impersonating. */
export const requireOwnProvisioningInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.userId);
    await assertNoOperatorImpersonation(ctx, args.userId);
    return null;
  },
});

export type EnsureInboxResult =
  | { status: "ready"; address: string }
  | { status: "captured"; address: string }
  | { status: "failed"; message: string };

/**
 * Brings the caller's inbox to the address their profile currently intends and
 * retires the previous one. The target is read at run time, so an older request
 * never rolls back a newer save. Capture mode makes no network call.
 */
export const ensureInbox = action({
  args: {},
  handler: async (ctx): Promise<EnsureInboxResult> => {
    const userId = await getSessionUserId(ctx);
    if (!userId) throw new Error("Authentication required");
    const operatorUserId = userId as Id<"users">;
    await ctx.runQuery(internal.operatorEmailSettings.requireOwnProvisioningInternal, {
      userId: operatorUserId,
    });
    try {
      const ensured = await ensureOperatorInbox(ctx, operatorUserId);
      return {
        status: ensured.captured ? "captured" : "ready",
        address: ensured.inbox.emailAddress,
      };
    } catch (error) {
      if (isTeamEmailError(error)) {
        return { status: "failed", message: error.message };
      }
      if (isResendInboxError(error)) {
        return {
          status: "failed",
          message:
            error.code === "inbox_conflict"
              ? "That address is already used by another team member"
              : error.code === "inbox_stale"
                ? "Your team address changed while setting up; retry"
                : "Could not set up your team inbox; retry",
        };
      }
      throw error;
    }
  },
});
