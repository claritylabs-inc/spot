import dayjs from "dayjs";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";

type SessionCtx = QueryCtx | MutationCtx | ActionCtx;
/** All ordinary surfaces require an active, unrestricted session. Only the
 * intake and minimal viewer may opt into a pre-verification identity. */
export async function getSessionUserId(
  ctx: SessionCtx,
  allowRestricted = false,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (!("db" in ctx))
    return ctx.runQuery(internal.sessionIdentity.lookup, {
      userId,
      sessionId,
      allowRestricted,
    });
  const user = await ctx.db.get(userId);
  if (!user || (user.intakeRestricted && !allowRestricted)) return null;
  if (sessionId && ctx.db.normalizeId("authSessions", sessionId)) {
    const session = await ctx.db.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.expirationTime <= dayjs().valueOf()
    )
      return null;
  }
  return userId;
}
