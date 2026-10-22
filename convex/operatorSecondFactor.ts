import dayjs from "dayjs";
import { getAuthSessionId } from "@convex-dev/auth/server";
import { MINUTE, HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  normalizeOperatorEmail,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  checkSessionUser,
  getSessionUserIdBeforeSecondFactor,
} from "./lib/sessionIdentity";
import { hashRecoveryCode } from "./lib/operatorSecondFactor";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

/**
 * Operator TOTP second factor. Email codes and passwords only prove the first
 * factor; `checkSessionUser` withholds operator identity from every ordinary
 * function until the current auth session has a row here.
 *
 * Failure modes: identity comes from the session, never args; a session can
 * only verify itself; an active authenticator cannot be replaced from a
 * session that has not passed it; each TOTP step and recovery code works once;
 * attempts are rate limited per operator, and failed attempts still consume
 * the limit; disabling or resetting removes every verified session.
 */

const rateLimiter = new RateLimiter(components.rateLimiter, {
  secondFactorPerMinute: {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
  },
  secondFactorPerHour: { kind: "token bucket", rate: 30, period: HOUR },
});

const sessionArgs = {
  userId: v.id("users"),
  sessionId: v.id("authSessions"),
};

async function consumeAttempt(ctx: MutationCtx, userId: Id<"users">) {
  const statuses = [
    await rateLimiter.limit(ctx, "secondFactorPerMinute", { key: userId }),
    await rateLimiter.limit(ctx, "secondFactorPerHour", { key: userId }),
  ];
  return {
    ok: statuses.every((status) => status.ok),
    retryAfter: Math.max(0, ...statuses.map((s) => s.retryAfter ?? 0)),
  };
}

async function credentialFor(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("operatorTotpCredentials")
    .withIndex("user", (q) => q.eq("userId", userId))
    .unique();
}

async function sessionVerification(
  ctx: QueryCtx,
  sessionId: Id<"authSessions">,
) {
  return await ctx.db
    .query("operatorSecondFactorSessions")
    .withIndex("session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

/** Re-derives an operator session that has passed only the first factor. */
async function requirePendingSession(
  ctx: QueryCtx,
  userId: Id<"users">,
  sessionId: Id<"authSessions">,
) {
  const user = await checkSessionUser(ctx, userId, sessionId, {
    allowPendingSecondFactor: true,
  });
  if (!user) throwUserFacingError(userFacingErrorCodes.authRequired);
  return await requireOperatorForUser(ctx, userId);
}

async function currentPendingSession(ctx: QueryCtx) {
  const [userId, sessionId] = await Promise.all([
    getSessionUserIdBeforeSecondFactor(ctx),
    getAuthSessionId(ctx),
  ]);
  if (!userId || !sessionId)
    throwUserFacingError(userFacingErrorCodes.authRequired);
  const operator = await requireOperatorForUser(ctx, userId);
  return { ...operator, sessionId };
}

async function markSessionVerified(
  ctx: MutationCtx,
  userId: Id<"users">,
  sessionId: Id<"authSessions">,
  method: "totp" | "recovery_code",
) {
  const existing = await sessionVerification(ctx, sessionId);
  if (existing) await ctx.db.delete(existing._id);
  await ctx.db.insert("operatorSecondFactorSessions", {
    sessionId,
    userId,
    method,
    verifiedAt: dayjs().valueOf(),
  });
}

async function clearVerifiedSessions(ctx: MutationCtx, userId: Id<"users">) {
  for (;;) {
    const rows = await ctx.db
      .query("operatorSecondFactorSessions")
      .withIndex("user", (q) => q.eq("userId", userId))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length < 100) return;
  }
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const [userId, sessionId] = await Promise.all([
      getSessionUserIdBeforeSecondFactor(ctx),
      getAuthSessionId(ctx),
    ]);
    if (!userId || !sessionId) return null;
    const user = await ctx.db.get(userId);
    if (user?.accountKind !== "operator") return null;
    const [credential, verification] = await Promise.all([
      credentialFor(ctx, userId),
      sessionVerification(ctx, sessionId),
    ]);
    const enrolled = credential?.status === "active";
    return {
      enrolled,
      verified: enrolled && verification?.userId === userId,
      enabledAt: enrolled ? credential.activatedAt : undefined,
      recoveryCodesRemaining: enrolled
        ? credential.recoveryCodeHashes.length
        : 0,
    };
  },
});

export const verifyRecoveryCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const operator = await currentPendingSession(ctx);
    // Return failures instead of throwing so the consumed attempt is kept.
    const limit = await consumeAttempt(ctx, operator.userId);
    if (!limit.ok)
      return { ok: false as const, reason: "rate_limited" as const, retryAfter: limit.retryAfter };
    const credential = await credentialFor(ctx, operator.userId);
    if (credential?.status !== "active")
      return { ok: false as const, reason: "not_enrolled" as const };
    const hash = hashRecoveryCode(args.code);
    if (!credential.recoveryCodeHashes.includes(hash))
      return { ok: false as const, reason: "invalid_code" as const };
    const remaining = credential.recoveryCodeHashes.filter((h) => h !== hash);
    await ctx.db.patch(credential._id, { recoveryCodeHashes: remaining });
    await markSessionVerified(
      ctx,
      operator.userId,
      operator.sessionId,
      "recovery_code",
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "second_factor_recovery_used",
      summary: `Recovery code used by ${operator.profile.email}`,
      metadata: { remaining: remaining.length },
    });
    return { ok: true as const, remaining: remaining.length };
  },
});

// ── Internal functions (called by actions/operatorSecondFactor) ──

export const consumeAttemptInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => consumeAttempt(ctx, args.userId),
});

export const credentialForSessionInternal = internalQuery({
  args: sessionArgs,
  handler: async (ctx, args) => {
    const operator = await requirePendingSession(ctx, args.userId, args.sessionId);
    const credential = await credentialFor(ctx, args.userId);
    return {
      email: normalizeOperatorEmail(operator.profile.email),
      credential: credential && {
        credentialId: credential._id,
        status: credential.status,
        encryptedSecret: credential.encryptedSecret,
      },
    };
  },
});

export const storePendingEnrollmentInternal = internalMutation({
  args: { ...sessionArgs, encryptedSecret: v.string() },
  handler: async (ctx, args) => {
    await requirePendingSession(ctx, args.userId, args.sessionId);
    const existing = await credentialFor(ctx, args.userId);
    if (existing?.status === "active")
      throw new ConvexError("An authenticator is already enrolled.");
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("operatorTotpCredentials", {
      userId: args.userId,
      encryptedSecret: args.encryptedSecret,
      status: "pending",
      recoveryCodeHashes: [],
      createdAt: dayjs().valueOf(),
    });
    return null;
  },
});

export const activateEnrollmentInternal = internalMutation({
  args: {
    ...sessionArgs,
    credentialId: v.id("operatorTotpCredentials"),
    counter: v.number(),
    recoveryCodeHashes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requirePendingSession(ctx, args.userId, args.sessionId);
    const credential = await ctx.db.get(args.credentialId);
    // A newer enrollment started in another tab replaces this one.
    if (credential?.userId !== args.userId || credential.status !== "pending")
      throw new ConvexError("This enrollment has expired. Start again.");
    await ctx.db.patch(credential._id, {
      status: "active",
      lastUsedCounter: args.counter,
      recoveryCodeHashes: args.recoveryCodeHashes,
      activatedAt: dayjs().valueOf(),
    });
    await markSessionVerified(ctx, args.userId, args.sessionId, "totp");
    await writeOperatorAudit(ctx, {
      operatorUserId: args.userId,
      type: "second_factor_enrolled",
      summary: `Authenticator enrolled by ${operator.profile.email}`,
    });
    return null;
  },
});

export const recordTotpVerificationInternal = internalMutation({
  args: {
    ...sessionArgs,
    credentialId: v.id("operatorTotpCredentials"),
    counter: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePendingSession(ctx, args.userId, args.sessionId);
    const credential = await ctx.db.get(args.credentialId);
    if (credential?.userId !== args.userId || credential.status !== "active")
      return false;
    if (args.counter <= (credential.lastUsedCounter ?? -1)) return false;
    await ctx.db.patch(credential._id, { lastUsedCounter: args.counter });
    await markSessionVerified(ctx, args.userId, args.sessionId, "totp");
    return true;
  },
});

export const replaceRecoveryCodesInternal = internalMutation({
  args: { ...sessionArgs, recoveryCodeHashes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await checkSessionUser(ctx, args.userId, args.sessionId, {});
    if (!user) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOperatorForUser(ctx, args.userId);
    const credential = await credentialFor(ctx, args.userId);
    if (credential?.status !== "active")
      throw new ConvexError("No authenticator is enrolled.");
    await ctx.db.patch(credential._id, {
      recoveryCodeHashes: args.recoveryCodeHashes,
    });
    return null;
  },
});

/**
 * Break-glass reset for an operator who lost both their authenticator and
 * recovery codes. Deployment admins run it with `npx convex run`; the operator
 * re-enrolls on next sign-in and every verified session is signed out of the
 * operator console.
 */
export const resetForOperatorEmail = internalMutation({
  args: { email: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeOperatorEmail(args.email);
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!profile) throw new ConvexError(`No operator profile for ${email}`);
    const credential = await credentialFor(ctx, profile.userId);
    if (credential) await ctx.db.delete(credential._id);
    await clearVerifiedSessions(ctx, profile.userId);
    await writeOperatorAudit(ctx, {
      operatorUserId: profile.userId,
      type: "second_factor_reset",
      summary: `Second factor reset for ${email}`,
      metadata: { actor: "deployment_admin", reason: args.reason },
    });
    return null;
  },
});
