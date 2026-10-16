import dayjs from "dayjs";
import { v } from "convex/values";
import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { PASSWORD_PROVIDER_ID } from "./lib/passwordAuth";
import {
  LEGACY_REVIEW_PROVIDER_ID,
  REVIEW_EMAIL,
  REVIEW_ORG_NAME,
  REVIEW_ORG_SLUG,
  REVIEW_USER_NAME,
  assertReviewerPassword,
} from "./lib/reviewerAuth";

type PrepareResult = { kind: "create" } | { kind: "exists"; userId: Id<"users"> };

function collision(reason: string): never {
  throw new Error(`Reviewer account collision: ${reason}`);
}

/**
 * Seeding safety only, not a runtime gate: never seed into, or create over, an
 * account or organization that is not the reviewer's own.
 */
async function inspect(ctx: QueryCtx): Promise<PrepareResult> {
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", REVIEW_EMAIL))
    .take(2);
  if (users.length > 1) collision("several users share the email");
  const user = users[0];
  const org = await ctx.db
    .query("organizations")
    .withIndex("slug", (q) => q.eq("slug", REVIEW_ORG_SLUG))
    .first();
  const accounts = [];
  for (const provider of [PASSWORD_PROVIDER_ID, LEGACY_REVIEW_PROVIDER_ID, "resend-otp", "intake"]) {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", provider).eq("providerAccountId", REVIEW_EMAIL),
      )
      .first();
    if (account) accounts.push(account);
  }
  if (!user) {
    if (accounts.length || org) collision("an orphan account or organization exists");
    return { kind: "create" };
  }
  const profile = await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", user._id))
    .first();
  const credential = accounts.find(
    (account) =>
      account.provider === PASSWORD_PROVIDER_ID ||
      account.provider === LEGACY_REVIEW_PROVIDER_ID,
  );
  if (
    user.accountKind !== "customer" ||
    profile ||
    credential?.userId !== user._id ||
    accounts.some((account) => account.userId !== user._id)
  ) {
    collision("the email belongs to an account that is not the reviewer's");
  }
  if (org) {
    const members = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", org._id))
      .take(50);
    if (members.length > 0 && !members.some((member) => member.userId === user._id)) {
      collision("the demo organization belongs to other users");
    }
  }
  return { kind: "exists", userId: user._id };
}

export const prepare = internalQuery({
  args: {},
  handler: async (ctx): Promise<PrepareResult> => inspect(ctx),
});

/**
 * One-time move of the reviewer credential from `review-password` to the
 * standard `password` provider. The scrypt hash is kept; idempotent.
 */
export const migrateToPasswordProvider = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ status: "migrated" | "already" | "none" }> => {
    const find = (provider: string) =>
      ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", provider).eq("providerAccountId", REVIEW_EMAIL),
        )
        .first();
    const [legacy, current] = [await find(LEGACY_REVIEW_PROVIDER_ID), await find(PASSWORD_PROVIDER_ID)];
    if (!legacy) return { status: current ? "already" : "none" };
    if (current) collision("both a legacy and a password credential exist");
    await ctx.db.patch(legacy._id, { provider: PASSWORD_PROVIDER_ID });
    return { status: "migrated" };
  },
});

const DEMO_ADDRESS = {
  street1: "1 Example Plaza",
  city: "Sampletown",
  state: "CA",
  zip: "00000",
  country: "US",
};

const DEMO_POLICIES = [
  {
    policyNumber: "DEMO-GL-0001",
    lineOfBusiness: "CGL",
    summary:
      "Demonstration commercial general liability policy for reviewer testing. Fabricated data; not real coverage.",
    premiumAmount: 4800,
    coverages: [
      { name: "Each Occurrence", limit: "$1,000,000" },
      { name: "General Aggregate", limit: "$2,000,000" },
      { name: "Products-Completed Operations Aggregate", limit: "$2,000,000" },
    ],
  },
  {
    policyNumber: "DEMO-CY-0002",
    lineOfBusiness: "CYBER",
    summary:
      "Demonstration cyber liability policy for reviewer testing. Fabricated data; not real coverage.",
    premiumAmount: 3200,
    coverages: [
      { name: "Network Security & Privacy Liability", limit: "$1,000,000" },
      { name: "Breach Response Costs", limit: "$250,000" },
    ],
  },
] as const;

/** Creates or repairs the demonstration workspace for an inspected reviewer user. */
export const ensureWorkspace = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx: MutationCtx, args) => {
    const state = await inspect(ctx);
    if (state.kind !== "exists" || state.userId !== args.userId) {
      collision("the user is not the provisioned reviewer");
    }
    const now = dayjs().valueOf();
    // The account is an ordinary verified customer; an admin provisioned it.
    const reviewer = await ctx.db.get(args.userId);
    if (reviewer && !reviewer.emailVerificationTime) {
      await ctx.db.patch(args.userId, { emailVerificationTime: now });
    }
    let org = await ctx.db
      .query("organizations")
      .withIndex("slug", (q) => q.eq("slug", REVIEW_ORG_SLUG))
      .unique();
    const orgId =
      org?._id ??
      (await ctx.db.insert("organizations", {
        name: REVIEW_ORG_NAME,
        type: "client",
        slug: REVIEW_ORG_SLUG,
        clientAccessStatus: "active",
        onboardingComplete: true,
        emailVerification: "strict",
        allowedDomains: [],
        primaryContactName: REVIEW_USER_NAME,
      }));
    org = await ctx.db.get(orgId);
    if (org?.clientAccessStatus !== "active") {
      await ctx.db.patch(orgId, { clientAccessStatus: "active" });
    }
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: args.userId,
        role: "member",
      });
    }
    const existing = await ctx.db
      .query("policies")
      .withIndex("organization", (q) => q.eq("orgId", orgId))
      .collect();
    const effective = dayjs().startOf("month").subtract(2, "month");
    for (const spec of DEMO_POLICIES) {
      if (existing.some((policy) => policy.policyNumber === spec.policyNumber)) {
        continue;
      }
      const policyId = await ctx.db.insert("policies", {
        orgId,
        userId: args.userId,
        uploadedBySide: "client",
        uploadedByUserId: args.userId,
        pipelineStatus: "complete",
        extractionDataStage: "final",
        extractionDataStageUpdatedAt: now,
        carrier: "Demonstration Mutual (fictional)",
        security: "Demonstration Mutual (fictional)",
        policyNumber: spec.policyNumber,
        linesOfBusiness: [spec.lineOfBusiness],
        documentType: "policy",
        policyYear: effective.year(),
        effectiveDate: effective.format("MM/DD/YYYY"),
        expirationDate: effective.add(12, "month").format("MM/DD/YYYY"),
        isRenewal: false,
        coverages: spec.coverages.map((coverage) => ({
          ...coverage,
          lineOfBusiness: spec.lineOfBusiness,
        })),
        insuredName: REVIEW_ORG_NAME,
        insuredAddress: DEMO_ADDRESS,
        premium: `$${spec.premiumAmount.toLocaleString("en-US")}`,
        premiumAmount: spec.premiumAmount,
        summary: spec.summary,
        isDemo: true,
      });
      await replacePolicyDeclarationFacts(ctx, policyId, now);
    }
    return { orgId };
  },
});

/** Non-secret summary for operators: `npx convex run reviewerAccounts:status`. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const state = await inspect(ctx);
    if (state.kind === "create") return { provisioned: false as const };
    const org = await ctx.db
      .query("organizations")
      .withIndex("slug", (q) => q.eq("slug", REVIEW_ORG_SLUG))
      .unique();
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", state.userId))
      .take(100);
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", PASSWORD_PROVIDER_ID).eq("providerAccountId", REVIEW_EMAIL),
      )
      .unique();
    const limit = account
      ? await ctx.db
          .query("authRateLimits")
          .withIndex("identifier", (q) => q.eq("identifier", account._id))
          .unique()
      : null;
    // Mirrors the library's default hourly failed-attempt allowance (read only).
    const attemptsLeft = limit
      ? Math.min(
          10,
          limit.attemptsLeft +
            ((dayjs().valueOf() - limit.lastAttemptTime) * 10) / (60 * 60 * 1000),
        )
      : 10;
    return {
      provisioned: true as const,
      email: REVIEW_EMAIL,
      userId: state.userId,
      orgId: org?._id ?? null,
      sessions: sessions.length,
      signInRateLimited: attemptsLeft < 1,
    };
  },
});

/**
 * Creates the reviewer account when it does not exist and repairs its demo
 * workspace when it does. An existing account keeps its password and sessions.
 * Run: `npx convex run reviewerAccounts:provision '{"password":"<generated>"}'`.
 */
export const provision = internalAction({
  args: { password: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "created" | "exists";
    email: string;
    userId: Id<"users">;
    orgId: Id<"organizations">;
  }> => {
    assertReviewerPassword(args.password);
    await ctx.runMutation(internal.reviewerAccounts.migrateToPasswordProvider, {});
    const state: PrepareResult = await ctx.runQuery(
      internal.reviewerAccounts.prepare,
      {},
    );
    let userId: Id<"users">;
    if (state.kind === "create") {
      const created = await createAccount(ctx, {
        provider: PASSWORD_PROVIDER_ID,
        account: { id: REVIEW_EMAIL, secret: args.password },
        profile: {
          email: REVIEW_EMAIL,
          name: REVIEW_USER_NAME,
          accountKind: "customer" as const,
          onboardingComplete: true,
        },
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });
      userId = created.user._id;
    } else {
      userId = state.userId;
    }
    const { orgId }: { orgId: Id<"organizations"> } = await ctx.runMutation(
      internal.reviewerAccounts.ensureWorkspace,
      { userId },
    );
    return {
      status: state.kind === "create" ? ("created" as const) : ("exists" as const),
      email: REVIEW_EMAIL,
      userId,
      orgId,
    };
  },
});

/**
 * Replaces the reviewer password and revokes every existing session.
 * Run: `npx convex run reviewerAccounts:rotatePassword '{"password":"<generated>"}'`.
 */
export const rotatePassword = internalAction({
  args: { password: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "rotated"; email: string; userId: Id<"users"> }> => {
    assertReviewerPassword(args.password);
    await ctx.runMutation(internal.reviewerAccounts.migrateToPasswordProvider, {});
    // Revocation must remain available whatever the account has become.
    const { account } = await retrieveAccount(ctx, {
      provider: PASSWORD_PROVIDER_ID,
      account: { id: REVIEW_EMAIL },
    });
    await modifyAccountCredentials(ctx, {
      provider: PASSWORD_PROVIDER_ID,
      account: { id: REVIEW_EMAIL, secret: args.password },
    });
    await invalidateSessions(ctx, { userId: account.userId });
    return { status: "rotated" as const, email: REVIEW_EMAIL, userId: account.userId };
  },
});
