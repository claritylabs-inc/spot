import dayjs from "dayjs";
import type { ConvexAuthConfig } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  bootstrapOperatorUser,
  isOperatorDomainEmail,
  isReservedOperatorEmail,
  normalizeOperatorEmail,
  operatorEmailAliases,
  operatorEmailIdentityUsers,
} from "./operatorIdentity";

type AuthUserArgs = Parameters<
  NonNullable<NonNullable<ConvexAuthConfig["callbacks"]>["createOrUpdateUser"]>
>[1];

export async function createOrUpdateEmailUser(
  ctx: MutationCtx,
  args: AuthUserArgs,
) {
  const { emailVerified, phoneVerified, ...profile } = args.profile;
  const email = normalizeOperatorEmail(profile.email);
  const now = dayjs().valueOf();
  let userId = args.existingUserId;

  if (isOperatorDomainEmail(email)) {
    if (isReservedOperatorEmail(email) || profile.accountKind === "customer") {
      throw new Error("This email is reserved for Spot operator use.");
    }
    const candidates = await operatorEmailIdentityUsers(ctx, email);
    if (userId && !candidates.includes(userId)) candidates.push(userId);
    if (candidates.length > 1) {
      throw new Error(
        "Operator email identities conflict. Contact an operator owner to resolve the existing accounts.",
      );
    }
    userId = candidates[0] ?? null;
    if (userId) {
      const user = await ctx.db.get(userId);
      const [membership, profiles] = await Promise.all([
        ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", userId!))
          .first(),
        ctx.db
          .query("operatorProfiles")
          .withIndex("user", (q) => q.eq("userId", userId!))
          .take(2),
      ]);
      if (
        !user ||
        user.accountKind === "customer" ||
        user.isAnonymous ||
        user.serviceAccountKind ||
        membership ||
        !operatorEmailAliases(email).includes(
          normalizeOperatorEmail(user.email),
        ) ||
        profiles.length > 1 ||
        profiles.some((p) => p.status !== "active") ||
        (user.accountKind === "operator" && profiles.length !== 1)
      ) {
        throw new Error(
          "This account is not authorized for Spot operator access.",
        );
      }
      // Auth binds each mailbox to the same user but still verifies the exact
      // mailbox's code before creating a session. Keep the primary email stable.
      if (emailVerified === true) {
        await ctx.db.patch(userId, { emailVerificationTime: now });
        await bootstrapOperatorUser(ctx, userId);
      }
      return userId;
    }
  } else if (
    userId === null &&
    email &&
    (args.provider.type === "email" ||
      emailVerified === true ||
      ("shouldLinkViaEmail" in args && args.shouldLinkViaEmail === true))
  ) {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .filter((q) => q.neq(q.field("emailVerificationTime"), undefined))
      .take(2);
    if (users.length > 1)
      throw new Error("This email belongs to multiple accounts.");
    userId = users[0]?._id ?? null;
  }

  const userData = {
    ...profile,
    ...(email ? { email } : {}),
    ...(emailVerified === true ? { emailVerificationTime: now } : {}),
    ...(phoneVerified === true ? { phoneVerificationTime: now } : {}),
  } as Omit<Doc<"users">, "_id" | "_creationTime">;
  if (userId !== null) {
    const existing = await ctx.db.get(userId);
    if (!existing) throw new Error("User not found");
    // A legacy operator may use an explicitly provisioned external mailbox.
    if (existing.accountKind === "operator") delete userData.email;
    await ctx.db.patch(userId, userData);
    return userId;
  }
  const createdUserId = await ctx.db.insert("users", userData);
  if (isOperatorDomainEmail(email) && emailVerified === true) {
    await bootstrapOperatorUser(ctx, createdUserId);
  }
  return createdUserId;
}
