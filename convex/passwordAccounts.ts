import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";
import {
  createAccount,
  getAuthSessionId,
  getAuthUserId,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import { getActiveOperatorImpersonation } from "./lib/operatorIdentity";
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
 * session, never args; a stale session needs the current password; only `signIn`
 * exists (no sign-up/reset); the library stores only a scrypt hash; setting links
 * to the existing user (no duplicate user); other sessions are revoked on change;
 * an email change between check and write removes the mismatched account.
 */

type Reason =
  | "anonymous"
  | "service_account"
  | "intake_restricted"
  | "email_unverified"
  | "email_change_pending"
  | "impersonating";

type Context = {
  userId: Id<"users">;
  email: string;
  sessionId: Id<"authSessions"> | null;
  recentSignIn: boolean;
  hasPassword: boolean;
  reason?: Reason;
};

async function derive(ctx: QueryCtx): Promise<Context | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const email = normalizePasswordEmail(user.email);
  const sessionId = await getAuthSessionId(ctx);
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  const now = dayjs().valueOf();
  const recentSignIn = !!session && now - session._creationTime <= RECENT_SIGN_IN_MS;
  const account = email
    ? await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", email),
        )
        .first()
    : null;
  const pending = await ctx.db
    .query("userEmailChangeRequests")
    .withIndex("target_status", (q) =>
      q.eq("targetUserId", userId).eq("status", "pending"),
    )
    .collect();
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
    recentSignIn,
    hasPassword: !!account && account.userId === userId,
    reason,
  };
}

/** The caller's own password state for settings; `null` when signed out. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const context = await derive(ctx);
    if (!context) return null;
    return {
      eligible: context.reason === undefined,
      reason: context.reason,
      hasPassword: context.hasPassword,
      recentSignIn: context.recentSignIn,
    };
  },
});

export const getContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<Context | null> => derive(ctx),
});

/**
 * After the library wrote the credential: drop password accounts keyed to any
 * other email, and undo the write if the email changed in the meantime.
 */
export const finishChange = internalMutation({
  args: { userId: v.id("users"), email: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const user = await ctx.db.get(args.userId);
    const current = normalizePasswordEmail(user?.email);
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.userId).eq("provider", PASSWORD_PROVIDER_ID),
      )
      .collect();
    for (const account of accounts) {
      if (account.providerAccountId !== current) await ctx.db.delete(account._id);
    }
    return { ok: current === args.email };
  },
});

/**
 * Sets or changes the caller's own password. Allowed with a recent sign-in
 * (an email code, which is also the recovery path) or the current password.
 */
export const setPassword = action({
  args: { newPassword: v.string(), currentPassword: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const context: Context | null = await ctx.runQuery(
      internal.passwordAccounts.getContext,
      {},
    );
    if (!context) throwUserFacingError(userFacingErrorCodes.authRequired);
    if (context.reason === "impersonating") {
      throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
    }
    if (context.reason) {
      throw new ConvexError({
        code: "PASSWORD_NOT_AVAILABLE",
        reason: context.reason,
        message: "Passwords are not available for this account.",
      });
    }
    assertNewPassword(args.newPassword, context.email);

    if (!context.recentSignIn) {
      if (!context.hasPassword || args.currentPassword === undefined) {
        throw new ConvexError({
          code: "RECENT_SIGN_IN_REQUIRED",
          message:
            "Sign in again with an email code, or enter your current password, to change your password.",
        });
      }
      try {
        await retrieveAccount(ctx, {
          provider: PASSWORD_PROVIDER_ID,
          account: { id: context.email, secret: args.currentPassword },
        });
      } catch {
        throw new ConvexError({
          code: "CURRENT_PASSWORD_INCORRECT",
          message: "Your current password is incorrect.",
        });
      }
    }

    if (context.hasPassword) {
      await modifyAccountCredentials(ctx, {
        provider: PASSWORD_PROVIDER_ID,
        account: { id: context.email, secret: args.newPassword },
      });
    } else {
      // Link by email to the existing user; never create a second one.
      await createAccount(ctx, {
        provider: PASSWORD_PROVIDER_ID,
        account: { id: context.email, secret: args.newPassword },
        profile: { email: context.email },
        shouldLinkViaEmail: true,
        shouldLinkViaPhone: false,
      });
    }
    const { ok } = await ctx.runMutation(internal.passwordAccounts.finishChange, {
      userId: context.userId,
      email: context.email,
    });
    if (!ok) {
      throw new ConvexError({
        code: "EMAIL_CHANGED",
        message: "Your email changed while saving. Try again.",
      });
    }
    await invalidateSessions(ctx, {
      userId: context.userId,
      ...(context.sessionId ? { except: [context.sessionId] } : {}),
    });
    return { ok: true };
  },
});
