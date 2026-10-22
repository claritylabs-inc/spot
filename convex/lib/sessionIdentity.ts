import dayjs from "dayjs";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";

type SessionCtx = QueryCtx | MutationCtx | ActionCtx;
type SessionOptions = {
  allowRestricted?: boolean;
  allowPendingSecondFactor?: boolean;
};

/** All ordinary surfaces require an active, unrestricted session. Only the
 * intake and minimal viewer may opt into a pre-verification identity. Operator
 * sessions additionally require a verified second factor. */
export async function getSessionUserId(
  ctx: SessionCtx,
  allowRestricted = false,
): Promise<Id<"users"> | null> {
  return resolveSessionUserId(ctx, { allowRestricted });
}

/** Operator session before its second factor; only the sign-in flow may use it. */
export async function getSessionUserIdBeforeSecondFactor(
  ctx: SessionCtx,
  allowRestricted = false,
): Promise<Id<"users"> | null> {
  return resolveSessionUserId(ctx, {
    allowRestricted,
    allowPendingSecondFactor: true,
  });
}

async function resolveSessionUserId(
  ctx: SessionCtx,
  options: SessionOptions,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (!("db" in ctx))
    return ctx.runQuery(internal.sessionIdentity.lookup, {
      userId,
      sessionId,
      allowRestricted: options.allowRestricted ?? false,
      allowPendingSecondFactor: options.allowPendingSecondFactor,
    });
  return (await checkSessionUser(ctx, userId, sessionId, options))
    ? userId
    : null;
}

export async function checkSessionUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  rawSessionId: string | null,
  { allowRestricted = false, allowPendingSecondFactor = false }: SessionOptions,
): Promise<Doc<"users"> | null> {
  const user = await ctx.db.get(userId);
  if (!user || (user.intakeRestricted && !allowRestricted)) return null;
  const sessionId = rawSessionId
    ? ctx.db.normalizeId("authSessions", rawSessionId)
    : null;
  if (sessionId) {
    const session = await ctx.db.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.expirationTime <= dayjs().valueOf()
    )
      return null;
  }
  if (user.accountKind === "operator" && !allowPendingSecondFactor) {
    if (!sessionId) return null;
    const verification = await ctx.db
      .query("operatorSecondFactorSessions")
      .withIndex("session", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!verification || verification.userId !== userId) return null;
  }
  return user;
}
