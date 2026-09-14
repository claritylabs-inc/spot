import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeOperatorEmail } from "./operatorIdentity";

// Existing email indexes are case-sensitive. Never infer absence from a partial
// scan; a normalized-index migration must precede raising this directory limit.
export const EMPLOYEE_DIRECTORY_LIMIT = 2000;
export const EMPLOYEE_OTP_PROVIDER = "resend-otp";

export type EmployeeIdentity =
  | { status: "absent"; reason: "missing_identity" }
  | { status: "blocked"; reason: string }
  | {
      status: "member";
      reason: "active_operator";
      user: Doc<"users">;
      profile: Doc<"operatorProfiles">;
    };

export async function inspectEmployeeIdentity(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<EmployeeIdentity> {
  const [users, profiles, accounts] = await Promise.all([
    ctx.db.query("users").take(EMPLOYEE_DIRECTORY_LIMIT + 1),
    ctx.db.query("operatorProfiles").take(EMPLOYEE_DIRECTORY_LIMIT + 1),
    ctx.db.query("authAccounts").take(EMPLOYEE_DIRECTORY_LIMIT + 1),
  ]);
  const block = (reason: string): EmployeeIdentity => ({
    status: "blocked",
    reason,
  });
  if (
    [users, profiles, accounts].some(
      (rows) => rows.length > EMPLOYEE_DIRECTORY_LIMIT,
    )
  ) {
    return block("directory_limit");
  }
  const matches = users.filter(
    (user) => normalizeOperatorEmail(user.email) === email,
  );
  const emailProfiles = profiles.filter(
    (profile) => normalizeOperatorEmail(profile.email) === email,
  );
  const emailAccounts = accounts.filter(
    (account) =>
      normalizeOperatorEmail(account.providerAccountId) === email ||
      normalizeOperatorEmail(account.emailVerified) === email,
  );
  if (matches.length > 1) return block("duplicate_identity");
  const user = matches[0];
  if (!user) {
    return emailProfiles.length || emailAccounts.length
      ? block("orphaned_identity")
      : { status: "absent", reason: "missing_identity" };
  }
  if (
    user.email !== user.email?.trim() ||
    user.isAnonymous ||
    user.serviceAccountKind
  ) {
    return block("invalid_identity");
  }
  if (
    await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", user._id))
      .first()
  ) {
    return block("customer_membership");
  }
  if (user.accountKind !== "operator") return block("account_kind_conflict");
  const userProfiles = profiles.filter(
    (profile) => profile.userId === user._id,
  );
  if (userProfiles.length !== 1 || emailProfiles.length !== 1)
    return block("ambiguous_profile");
  const profile = userProfiles[0];
  if (
    profile._id !== emailProfiles[0]._id ||
    profile.email !== profile.email.trim()
  )
    return block("profile_identity_conflict");
  if (profile.status !== "active") return block("inactive_profile");
  const userAccounts = accounts.filter(
    (account) => account.userId === user._id,
  );
  if (
    emailAccounts.some((account) => account.userId !== user._id) ||
    userAccounts.some(
      (account) =>
        account.provider !== EMPLOYEE_OTP_PROVIDER ||
        account.providerAccountId !== email ||
        account.secret !== undefined ||
        (account.emailVerified !== undefined &&
          normalizeOperatorEmail(account.emailVerified) !== email),
    ) ||
    userAccounts.length > 1
  )
    return block("auth_identity_conflict");
  // An existing operator can be observed before an OTP account is created only
  // when normal Convex Auth verified-email linking can preserve its identity.
  if (
    !userAccounts.length &&
    (user.email !== email || user.emailVerificationTime === undefined)
  ) {
    return block("missing_auth_identity");
  }
  return { status: "member", reason: "active_operator", user, profile };
}
