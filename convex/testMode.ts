import dayjs from "dayjs";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { normalizeEmailAddress } from "./lib/emailAddress";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";

async function operatorProfile(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", userId))
    .unique();
}

/** True while this user is an operator with test mode on. */
export async function operatorInTestMode(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<boolean> {
  return (await operatorProfile(ctx, userId))?.testModeEnabledAt !== undefined;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const profile = await operatorProfile(ctx, operator.userId);
    return profile?.testModeEnabledAt === undefined
      ? null
      : { recipientEmail: profile.email, enabledAt: profile.testModeEnabledAt };
  },
});

/**
 * Read by the email transport before every operator-caused send. A user who is
 * not an operator has no test mode; an operator in test mode without a usable
 * address throws, so the email is not sent.
 */
export const recipientInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await operatorProfile(ctx, args.userId);
    if (profile?.testModeEnabledAt === undefined) return null;
    const email = normalizeEmailAddress(profile.email);
    if (!email) throw new Error("Test mode operator has no email address");
    return email;
  },
});

/** Turns test mode on or off for the calling operator only. */
export const set = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const profile = await operatorProfile(ctx, operator.userId);
    if (!profile) throw new Error("Operator profile not found");
    if (args.enabled && !normalizeEmailAddress(profile.email))
      throw new Error(
        "Add an email to your profile before turning on test mode",
      );
    if ((profile.testModeEnabledAt !== undefined) === args.enabled) return;
    await ctx.db.patch(profile._id, {
      testModeEnabledAt: args.enabled ? dayjs().valueOf() : undefined,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: args.enabled ? "Turned on test mode" : "Turned off test mode",
      metadata: { testMode: args.enabled },
    });
  },
});
