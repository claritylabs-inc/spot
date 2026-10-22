"use node";

import { randomBytes } from "node:crypto";
import { getAuthSessionId } from "@convex-dev/auth/server";
import { createTOTPKeyURI } from "@oslojs/otp";
import {
  decodeBase32IgnorePadding,
  encodeBase32LowerCaseNoPadding,
  encodeBase32UpperCaseNoPadding,
} from "@oslojs/encoding";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, type ActionCtx } from "../_generated/server";
import { decryptPassword, encryptPassword } from "../lib/imapMailbox";
import {
  RECOVERY_CODE_COUNT,
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  hashRecoveryCode,
  matchTotpCounter,
} from "../lib/operatorSecondFactor";
import {
  getSessionUserId,
  getSessionUserIdBeforeSecondFactor,
} from "../lib/sessionIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

// TOTP secrets are encrypted with the shared credential key, which is only
// available in the Node runtime; mutations own every state transition.

type CodeResult =
  | { ok: true }
  | { ok: false; reason: "invalid_code" }
  | { ok: false; reason: "rate_limited"; retryAfter: number };

async function sessionFor(ctx: ActionCtx, verified: boolean) {
  const [userId, sessionId] = await Promise.all([
    verified
      ? getSessionUserId(ctx)
      : getSessionUserIdBeforeSecondFactor(ctx),
    getAuthSessionId(ctx),
  ]);
  if (!userId || !sessionId)
    throwUserFacingError(userFacingErrorCodes.authRequired);
  return { userId, sessionId };
}

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = encodeBase32LowerCaseNoPadding(randomBytes(7)).slice(0, 10);
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

async function checkCode(
  ctx: ActionCtx,
  status: "pending" | "active",
  code: string,
) {
  const session = await sessionFor(ctx, false);
  const limit = await ctx.runMutation(
    internal.operatorSecondFactor.consumeAttemptInternal,
    { userId: session.userId },
  );
  if (!limit.ok)
    return {
      ...session,
      failure: {
        ok: false,
        reason: "rate_limited",
        retryAfter: limit.retryAfter,
      } as const,
    };
  const { credential } = await ctx.runQuery(
    internal.operatorSecondFactor.credentialForSessionInternal,
    session,
  );
  if (credential?.status !== status)
    throw new ConvexError(
      status === "pending"
        ? "Start authenticator setup again."
        : "No authenticator is enrolled.",
    );
  const key = decodeBase32IgnorePadding(
    decryptPassword(credential.encryptedSecret),
  );
  const counter = matchTotpCounter(key, code);
  return counter === null
    ? { ...session, failure: { ok: false, reason: "invalid_code" } as const }
    : { ...session, credentialId: credential.credentialId, counter };
}

export const beginEnrollment = action({
  args: {},
  handler: async (ctx): Promise<{ keyUri: string; secret: string }> => {
    const session = await sessionFor(ctx, false);
    const { email } = await ctx.runQuery(
      internal.operatorSecondFactor.credentialForSessionInternal,
      session,
    );
    const key = new Uint8Array(randomBytes(20));
    const secret = encodeBase32UpperCaseNoPadding(key);
    await ctx.runMutation(
      internal.operatorSecondFactor.storePendingEnrollmentInternal,
      { ...session, encryptedSecret: encryptPassword(secret) },
    );
    return {
      keyUri: createTOTPKeyURI(
        TOTP_ISSUER,
        email,
        key,
        TOTP_PERIOD_SECONDS,
        TOTP_DIGITS,
      ),
      secret,
    };
  },
});

export const confirmEnrollment = action({
  args: { code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    Exclude<CodeResult, { ok: true }> | { ok: true; recoveryCodes: string[] }
  > => {
    const result = await checkCode(ctx, "pending", args.code);
    if ("failure" in result) return result.failure;
    const recoveryCodes = newRecoveryCodes();
    await ctx.runMutation(
      internal.operatorSecondFactor.activateEnrollmentInternal,
      {
        userId: result.userId,
        sessionId: result.sessionId,
        credentialId: result.credentialId,
        counter: result.counter,
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      },
    );
    return { ok: true, recoveryCodes };
  },
});

export const verify = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<CodeResult> => {
    const result = await checkCode(ctx, "active", args.code);
    if ("failure" in result) return result.failure;
    const accepted = await ctx.runMutation(
      internal.operatorSecondFactor.recordTotpVerificationInternal,
      {
        userId: result.userId,
        sessionId: result.sessionId,
        credentialId: result.credentialId,
        counter: result.counter,
      },
    );
    // A replayed or already-used step is reported like any wrong code.
    return accepted ? { ok: true } : { ok: false, reason: "invalid_code" };
  },
});

export const regenerateRecoveryCodes = action({
  args: {},
  handler: async (ctx): Promise<{ recoveryCodes: string[] }> => {
    const session = await sessionFor(ctx, true);
    const recoveryCodes = newRecoveryCodes();
    await ctx.runMutation(
      internal.operatorSecondFactor.replaceRecoveryCodesInternal,
      { ...session, recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) },
    );
    return { recoveryCodes };
  },
});
