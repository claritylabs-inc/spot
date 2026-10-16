import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";
import {
  getAuthSessionId,
  invalidateSessions,
  retrieveAccount,
} from "@convex-dev/auth/server";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getActiveOperatorImpersonation } from "./lib/operatorIdentity";
import { getSessionUserId } from "./lib/sessionIdentity";
import {
  PASSWORD_PROVIDER_ID,
  RECENT_SIGN_IN_MS,
  assertNewPassword,
  normalizePasswordEmail,
} from "./lib/passwordAuth";
import { throwUserFacingError, userFacingErrorCodes } from "./lib/userFacingErrors";

/**
 * Optional password sign-in. No account has a password by default: a signed-in,
 * verified human sets one from settings, and email OTP stays the recovery path.
 *
 * Failure modes: anonymous, service, intake-restricted, unverified, impersonated
 * or pending-email-change callers cannot set one; identity is derived from the
 * session, never args; a revoked session cannot change credentials; a stale
 * session needs the current password; only `signIn` exists (no sign-up/reset);
 * only a scrypt hash is stored. The write is one transaction that re-derives the
 * caller and rejects any drift (email, session, account, hash, freshness) before
 * touching `authAccounts`, so the credential can only land on the same user and
 * email that were checked, and concurrent changes cannot both win.
 */

type Reason =
  | "anonymous"
  | "service_account"
  | "intake_restricted"
  | "email_unverified"
  | "email_change_pending"
  | "impersonating";

type Derived = {
  userId: Id<"users">;
  email: string;
  sessionId: Id<"authSessions">;
  recentSignInExpiresAt: number;
  account: Doc<"authAccounts"> | null;
  reason?: Reason;
};

async function passwordAccountFor(ctx: QueryCtx, email: string) {
  return email
    ? await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", email),
        )
        .first()
    : null;
}

/** The authenticated caller, from the session only. `null` unless the session is live. */
async function derive(ctx: QueryCtx): Promise<Derived | null> {
  // Re-reads the session row, so a revoked or expired token is not a caller.
  const userId = await getSessionUserId(ctx, true);
  const sessionId = await getAuthSessionId(ctx);
  if (!userId || !sessionId) return null;
  const [user, session] = await Promise.all([ctx.db.get(userId), ctx.db.get(sessionId)]);
  if (!user || !session || session.userId !== userId) return null;
  const email = normalizePasswordEmail(user.email);
  const now = dayjs().valueOf();
  const pending = await ctx.db
    .query("userEmailChangeRequests")
    .withIndex("target_status", (q) =>
      q.eq("targetUserId", userId).eq("status", "pending"),
    )
    .take(20);
  const reason: Reason | undefined = user.isAnonymous
    ? "anonymous"
    : user.serviceAccountKind
      ? "service_account"
      : user.intakeRestricted
        ? "intake_restricted"
        : !email || !user.emailVerificationTime
          ? "email_unverified"
          : pending.some((request) => request.expiresAt > now)
            ? "email_change_pending"
            : (await getActiveOperatorImpersonation(ctx))
              ? "impersonating"
              : undefined;
  return {
    userId,
    email,
    sessionId,
    recentSignInExpiresAt: session._creationTime + RECENT_SIGN_IN_MS,
    account: await passwordAccountFor(ctx, email),
    reason,
  };
}

/** The caller's own password state for settings; `null` when signed out. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const derived = await derive(ctx);
    if (!derived) return null;
    return {
      eligible: derived.reason === undefined,
      reason: derived.reason,
      hasPassword: derived.account?.userId === derived.userId,
      recentSignIn: dayjs().valueOf() <= derived.recentSignInExpiresAt,
      /** Epoch ms when the sign-in stops counting as recent; use it to refresh the UI. */
      recentSignInExpiresAt: derived.recentSignInExpiresAt,
    };
  },
});

export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const derived = await derive(ctx);
    if (!derived) return null;
    return {
      userId: derived.userId,
      email: derived.email,
      sessionId: derived.sessionId,
      recent: dayjs().valueOf() <= derived.recentSignInExpiresAt,
      reason: derived.reason,
      accountId: derived.account?._id ?? null,
      accountUserId: derived.account?.userId ?? null,
      secret: derived.account?.secret ?? null,
    };
  },
});

const changed = () =>
  new ConvexError({
    category: "authentication",
    code: "PASSWORD_CHANGE_CONFLICT",
    message: "Your account changed while saving. Try again.",
  });

/**
 * The only writer of a self-service credential. Re-derives the caller inside
 * this transaction and applies the new hash only if everything the action
 * checked still holds; then drops other sessions.
 */
export const commit = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("authSessions"),
    email: v.string(),
    /** The account the action verified or saw: its id and hash, or null for none. */
    expectedAccountId: v.union(v.id("authAccounts"), v.null()),
    expectedSecret: v.union(v.string(), v.null()),
    /** The current password was verified against `expectedSecret`. */
    currentVerified: v.boolean(),
    hash: v.string(),
  },
  handler: async (ctx: MutationCtx, args) => {
    const derived = await derive(ctx);
    if (
      !derived ||
      derived.reason ||
      derived.userId !== args.userId ||
      derived.sessionId !== args.sessionId ||
      derived.email !== args.email
    ) {
      throw changed();
    }
    // Exactly one user owns this email; it is the caller.
    const owners = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(2);
    if (owners.length !== 1 || owners[0]._id !== args.userId) throw changed();

    const account = derived.account;
    if (account && account.userId !== args.userId) throw changed();
    if ((account?._id ?? null) !== args.expectedAccountId) throw changed();
    if ((account?.secret ?? null) !== args.expectedSecret) throw changed();
    const recent = dayjs().valueOf() <= derived.recentSignInExpiresAt;
    if (!recent && !(args.currentVerified && account)) throw changed();

    if (account) {
      await ctx.db.patch(account._id, { secret: args.hash });
    } else {
      await ctx.db.insert("authAccounts", {
        userId: args.userId,
        provider: PASSWORD_PROVIDER_ID,
        providerAccountId: args.email,
        secret: args.hash,
      });
    }
    // Password accounts keyed to any other email can no longer sign in; drop them.
    const own = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.userId).eq("provider", PASSWORD_PROVIDER_ID),
      )
      .take(10);
    for (const stale of own) {
      if (stale.providerAccountId !== args.email) await ctx.db.delete(stale._id);
    }
    // Revoke other sessions in the same transaction (bounded; the action finishes
    // any remainder with the library's own invalidation).
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .take(20);
    for (const session of sessions) {
      if (session._id === args.sessionId) continue;
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .take(200);
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }
  },
});

/** Hashes with the same scrypt the `Password` sign-in provider verifies with. */
async function hashPassword(password: string) {
  const crypto = (Password() as unknown as { options?: ConvexCredentialsUserConfig })
    .options?.crypto;
  if (typeof crypto?.hashSecret !== "function") {
    throw new Error("Unexpected Password provider shape");
  }
  return await crypto.hashSecret(password);
}

/**
 * Sets or changes the caller's own password. Allowed with a recent sign-in
 * (an email code, which is also the recovery path) or the current password.
 */
export const setPassword = action({
  args: { newPassword: v.string(), currentPassword: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const snap = await ctx.runQuery(internal.passwordAccounts.snapshot, {});
    if (!snap) throwUserFacingError(userFacingErrorCodes.authRequired);
    if (snap.reason === "impersonating") {
      throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
    }
    if (snap.reason) {
      throw new ConvexError({
        category: "authentication",
        code: "PASSWORD_NOT_AVAILABLE",
        reason: snap.reason,
        message: "Passwords are not available for this account.",
      });
    }
    assertNewPassword(args.newPassword, snap.email);

    let expectedAccountId = snap.accountId;
    let expectedSecret = snap.secret;
    let currentVerified = false;
    if (!snap.recent) {
      if (!snap.accountId || args.currentPassword === undefined) {
        throw new ConvexError({
          category: "authentication",
          code: "RECENT_SIGN_IN_REQUIRED",
          message:
            "Sign in again with an email code, or enter your current password, to change your password.",
        });
      }
      try {
        // Library verification, including its failed-attempt rate limit. The
        // account it returns is the one the commit must still find unchanged.
        const { account } = await retrieveAccount(ctx, {
          provider: PASSWORD_PROVIDER_ID,
          account: { id: snap.email, secret: args.currentPassword },
        });
        expectedAccountId = account._id;
        expectedSecret = account.secret ?? null;
        currentVerified = true;
      } catch (error) {
        // The library throws its own result codes for lockout and bad secrets.
        const lockedOut = String((error as Error)?.message).includes("TooManyFailedAttempts");
        throw new ConvexError(
          lockedOut
            ? {
                category: "authentication",
                code: "TOO_MANY_ATTEMPTS",
                message: "Too many incorrect attempts. Try again later or sign in with an email code.",
              }
            : {
                category: "authentication",
                code: "CURRENT_PASSWORD_INCORRECT",
                message: "Your current password is incorrect.",
              },
        );
      }
    }

    const hash = await hashPassword(args.newPassword);
    await ctx.runMutation(internal.passwordAccounts.commit, {
      userId: snap.userId,
      sessionId: snap.sessionId,
      email: snap.email,
      expectedAccountId,
      expectedSecret,
      currentVerified,
      hash,
    });
    await invalidateSessions(ctx, { userId: snap.userId, except: [snap.sessionId] });
    return { ok: true };
  },
});
