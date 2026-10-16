import dayjs from "dayjs";
import { v } from "convex/values";
import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
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
import { isBootstrapOperatorEmail } from "./lib/operatorIdentity";
import {
  REVIEW_EMAIL,
  REVIEW_ORG_NAME,
  REVIEW_ORG_SLUG,
  REVIEW_PROVIDER_ID,
  REVIEW_USER_NAME,
  assertReviewerPassword,
} from "./lib/reviewerAuth";

type PrepareResult =
  | { kind: "create" }
  | { kind: "exists"; userId: Id<"users"> };

// Providers whose accounts are keyed by email. Any of them holding the reviewer
// email would be a second way into, or a squatter on, the identity.
const OTHER_EMAIL_PROVIDERS = ["resend-otp", "password", "intake"] as const;

function collision(reason: string): never {
  throw new Error(`Reviewer account collision: ${reason}`);
}

/**
 * Reads everything the reviewer account touches and fails closed unless it is
 * absent, or is exactly the provisioned reviewer user and its demo organization.
 */
async function inspect(ctx: QueryCtx): Promise<PrepareResult> {
  const users = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", REVIEW_EMAIL))
    .take(2);
  if (users.length > 1) collision("several users share the email");
  for (const provider of OTHER_EMAIL_PROVIDERS) {
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

export const prepare = internalQuery({
  args: {},
  handler: async (ctx): Promise<PrepareResult> => inspect(ctx),
});

/**
 * Checked on every reviewer sign-in: the identity must still be the ordinary
 * member of the one active demo organization, whatever else has changed since
 * provisioning. Any drift (operator, service flag, outside membership) denies.
 */
export const assertSignIn = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ userId: Id<"users"> }> => {
    const state = await inspect(ctx);
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
    return {
      provisioned: true as const,
      email: REVIEW_EMAIL,
      userId: state.userId,
      orgId: org?._id ?? null,
      sessions: sessions.length,
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
    const state: PrepareResult = await ctx.runQuery(
      internal.reviewerAccounts.prepare,
      {},
    );
    let userId: Id<"users">;
    if (state.kind === "create") {
      const created = await createAccount(ctx, {
        provider: REVIEW_PROVIDER_ID,
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
    const state: PrepareResult = await ctx.runQuery(
      internal.reviewerAccounts.prepare,
      {},
    );
    if (state.kind !== "exists") {
      throw new Error("The reviewer account is not provisioned");
    }
    await modifyAccountCredentials(ctx, {
      provider: REVIEW_PROVIDER_ID,
      account: { id: REVIEW_EMAIL, secret: args.password },
    });
    await invalidateSessions(ctx, { userId: state.userId });
    return { status: "rotated" as const, email: REVIEW_EMAIL, userId: state.userId };
  },
});
