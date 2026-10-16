import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isBootstrapOperatorEmail } from "./operatorIdentity";

/**
 * The reviewer account is one fixed, password-protected demonstration identity.
 * Its email is on a non-operator domain, so operator alias linking never applies.
 */
export const REVIEW_PROVIDER_ID = "review-password";
export const REVIEW_EMAIL = "chrome-review@review.spot.insure";
export const REVIEW_USER_NAME = "Spot Review";
export const REVIEW_ORG_SLUG = "spot-review-demo";
export const REVIEW_ORG_NAME = "Spot Review Demo (demonstration)";

const MIN_PASSWORD_LENGTH = 24;
const MAX_PASSWORD_LENGTH = 256;
// Every provider that keys accounts by email and is registered in convex/auth.ts.
const EMAIL_PROVIDERS = ["resend-otp", "password", "intake"] as const;

function normalizeReviewerEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isReviewerEmail(value: unknown) {
  return normalizeReviewerEmail(value) === REVIEW_EMAIL;
}

/**
 * Profile hook for the `review-password` provider. The library calls it for
 * every flow before touching the database, so rejecting here closes sign-up,
 * reset and email verification, and limits sign-in to the one identity.
 */
export function reviewerSignInProfile(params: Record<string, unknown>) {
  if (params.flow !== "signIn" || !isReviewerEmail(params.email)) {
    throw new Error("Invalid credentials");
  }
  return { email: REVIEW_EMAIL };
}

/**
 * Only the reviewer provider may create or link an account for the reviewer
 * email, and never by claiming the email is verified or by linking via email or
 * phone to another user.
 */
export function assertReviewerIdentityUse(args: {
  email: unknown;
  providerId: string;
  existingUserId: unknown;
  emailVerified?: unknown;
  shouldLinkViaEmail?: unknown;
  shouldLinkViaPhone?: unknown;
}) {
  if (!isReviewerEmail(args.email)) return;
  if (
    args.providerId !== REVIEW_PROVIDER_ID ||
    args.existingUserId !== null ||
    args.emailVerified === true ||
    args.shouldLinkViaEmail === true ||
    args.shouldLinkViaPhone === true
  ) {
    throw new Error("Use the reviewer sign-in");
  }
}

export function assertReviewerPassword(password: unknown): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Reviewer password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}

export type ReviewerState =
  | { kind: "create" }
  | { kind: "exists"; userId: Id<"users"> };

export function collision(reason: string): never {
  throw new Error(`Reviewer account collision: ${reason}`);
}

/**
 * Reads everything the reviewer account touches and fails closed unless it is
 * absent, or is exactly the provisioned reviewer user and its demo organization.
 */
export async function inspectReviewer(ctx: QueryCtx): Promise<ReviewerState> {
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", REVIEW_EMAIL))
    .take(2);
  if (users.length > 1) collision("several users share the email");
  for (const provider of EMAIL_PROVIDERS) {
    const other = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", provider).eq("providerAccountId", REVIEW_EMAIL),
      )
      .first();
    if (other) collision(`the email has a ${provider} account`);
  }
  const reviewAccount = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", REVIEW_PROVIDER_ID).eq("providerAccountId", REVIEW_EMAIL),
    )
    .unique();
  const orgs = await ctx.db
    .query("organizations")
    .withIndex("slug", (q) => q.eq("slug", REVIEW_ORG_SLUG))
    .take(2);
  if (orgs.length > 1) collision("several organizations share the demo slug");
  const org = orgs[0];

  const user = users[0];
  if (!user) {
    if (reviewAccount || org) collision("an orphan account or organization exists");
    return { kind: "create" };
  }
  const profile = await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", user._id))
    .first();
  if (
    user.accountKind !== "customer" ||
    user.isAnonymous ||
    user.serviceAccountKind ||
    user.intakeRestricted ||
    profile ||
    isBootstrapOperatorEmail(REVIEW_EMAIL) ||
    reviewAccount?.userId !== user._id
  ) {
    collision("the email belongs to a different kind of account");
  }
  // Whatever its provider or id, no other auth account may reach this user.
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
    .take(5);
  if (accounts.some((account) => account.provider !== REVIEW_PROVIDER_ID)) {
    collision("the reviewer user has an auth account from another provider");
  }

  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", user._id))
    .take(3);
  if (memberships.some((membership) => membership.orgId !== org?._id)) {
    collision("the reviewer belongs to an organization other than the demo");
  }
  if (org) {
    if (org.type !== "client") collision("the demo organization is not a client");
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", org._id))
      .take(3);
    if (members.some((member) => member.userId !== user._id)) {
      collision("the demo organization has other members");
    }
  }
  return { kind: "exists", userId: user._id };
}

/**
 * The identity may sign in, or hold a session, only while it is still the
 * ordinary member of the one active demo organization.
 */
export async function assertReviewerMayHaveSession(ctx: QueryCtx) {
  const state = await inspectReviewer(ctx);
  if (state.kind !== "exists") throw new Error("Invalid credentials");
  const org = await ctx.db
    .query("organizations")
    .withIndex("slug", (q) => q.eq("slug", REVIEW_ORG_SLUG))
    .unique();
  const membership = org
    ? await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", org._id).eq("userId", state.userId),
        )
        .first()
    : null;
  if (
    !org ||
    org.deletedAt !== undefined ||
    org.clientAccessStatus !== "active" ||
    membership?.role !== "member"
  ) {
    throw new Error("Invalid credentials");
  }
  return { userId: state.userId };
}

/** Runs before every session, for every provider: the reviewer user is always checked. */
export async function assertReviewerSessionAllowed(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!isReviewerEmail(user?.email)) return;
  const { userId: reviewerId } = await assertReviewerMayHaveSession(ctx);
  if (reviewerId !== userId) throw new Error("Invalid credentials");
}

/** Reviewer membership elsewhere would fail its sign-in; refuse it at the source. */
export async function assertNotReviewerUser(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (isReviewerEmail(user?.email)) {
    throw new Error("This account cannot join other organizations");
  }
}
