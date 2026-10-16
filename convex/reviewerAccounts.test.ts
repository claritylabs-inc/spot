/// <reference types="vite/client" />
// Failure modes are recorded before implementation in docs/architecture/reviewer-account.md.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  REVIEW_EMAIL,
  REVIEW_ORG_SLUG,
  REVIEW_PROVIDER_ID,
  reviewerSignInProfile,
} from "./lib/reviewerAuth";

const modules = import.meta.glob("./**/*.ts");
const password = "correct horse battery staple 1234";

test("only the exact reviewer identity may use the signIn flow", () => {
  expect(reviewerSignInProfile({ flow: "signIn", email: REVIEW_EMAIL, password })).toEqual({
    email: REVIEW_EMAIL,
  });
  expect(
    reviewerSignInProfile({ flow: "signIn", email: ` ${REVIEW_EMAIL.toUpperCase()} `, password }),
  ).toEqual({ email: REVIEW_EMAIL });
  for (const flow of ["signUp", "reset", "reset-verification", "email-verification", undefined, ""]) {
    expect(() => reviewerSignInProfile({ flow, email: REVIEW_EMAIL, password })).toThrow();
  }
  for (const email of [
    undefined,
    "",
    "terry@claritylabs.inc",
    "operator@spot.insure",
    "chrome-review@spot.insure",
    "chrome-review@claritylabs.inc",
    "chrome-review@review.spot.insure.evil.example",
    "other@review.spot.insure",
    `x${REVIEW_EMAIL}`,
  ]) {
    expect(() => reviewerSignInProfile({ flow: "signIn", email, password })).toThrow();
  }
});

async function insertReviewerUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: REVIEW_EMAIL,
      name: "Review",
      accountKind: "customer",
      onboardingComplete: true,
    });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: REVIEW_PROVIDER_ID,
      providerAccountId: REVIEW_EMAIL,
      secret: "hash",
    });
    return userId;
  });
}

test("provisioning is allowed only on a clean deployment and fails closed on identity collisions", async () => {
  const clean = convexTest(schema, modules);
  expect(await clean.query(internal.reviewerAccounts.prepare, {})).toEqual({ kind: "create" });

  const existingUser = convexTest(schema, modules);
  await existingUser.run((ctx) => ctx.db.insert("users", { email: REVIEW_EMAIL }));
  await expect(existingUser.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const otherProvider = convexTest(schema, modules);
  await otherProvider.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "someone@example.com" });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "resend-otp",
      providerAccountId: REVIEW_EMAIL,
    });
  });
  await expect(otherProvider.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const orphanOrg = convexTest(schema, modules);
  await orphanOrg.run((ctx) =>
    ctx.db.insert("organizations", { name: "Squatter", type: "client", slug: REVIEW_ORG_SLUG }),
  );
  await expect(orphanOrg.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const operatorKind = convexTest(schema, modules);
  const operatorId = await insertReviewerUser(operatorKind);
  await operatorKind.run((ctx) => ctx.db.patch(operatorId, { accountKind: "operator" }));
  await expect(operatorKind.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const operatorProfile = convexTest(schema, modules);
  const profileUser = await insertReviewerUser(operatorProfile);
  await operatorProfile.run((ctx) =>
    ctx.db.insert("operatorProfiles", {
      userId: profileUser,
      email: REVIEW_EMAIL,
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await expect(operatorProfile.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();
});

test("the workspace is one active client org with an ordinary member and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const userId = await insertReviewerUser(t);
  expect(await t.query(internal.reviewerAccounts.prepare, {})).toEqual({ kind: "exists", userId });

  const first = await t.mutation(internal.reviewerAccounts.ensureWorkspace, { userId });
  const second = await t.mutation(internal.reviewerAccounts.ensureWorkspace, { userId });
  expect(second.orgId).toBe(first.orgId);

  await t.run(async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      type: "client",
      slug: REVIEW_ORG_SLUG,
      clientAccessStatus: "active",
    });
    expect(orgs[0].brokerOrgId).toBeUndefined();
    const memberships = await ctx.db.query("orgMemberships").collect();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ orgId: first.orgId, userId, role: "member" });
    const policies = await ctx.db.query("policies").collect();
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.orgId).toBe(first.orgId);
      expect(policy.isDemo).toBe(true);
    }
    expect(await ctx.db.query("operatorProfiles").collect()).toHaveLength(0);
    const user = await ctx.db.get(userId);
    expect(user).toMatchObject({ accountKind: "customer", onboardingComplete: true });
  });
});

test("the workspace is never adopted when others hold or share it, or the reviewer belongs elsewhere", async () => {
  const shared = convexTest(schema, modules);
  const userId = await insertReviewerUser(shared);
  const { orgId } = await shared.mutation(internal.reviewerAccounts.ensureWorkspace, { userId });
  await shared.run(async (ctx) => {
    const other = await ctx.db.insert("users", { email: "real@example.com" });
    await ctx.db.insert("orgMemberships", { orgId, userId: other, role: "member" });
  });
  await expect(shared.mutation(internal.reviewerAccounts.ensureWorkspace, { userId })).rejects.toThrow();
  await expect(shared.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const elsewhere = convexTest(schema, modules);
  const reviewer = await insertReviewerUser(elsewhere);
  await elsewhere.mutation(internal.reviewerAccounts.ensureWorkspace, { userId: reviewer });
  await elsewhere.run(async (ctx) => {
    const real = await ctx.db.insert("organizations", { name: "Real Co", type: "client" });
    await ctx.db.insert("orgMemberships", { orgId: real, userId: reviewer, role: "member" });
  });
  await expect(
    elsewhere.mutation(internal.reviewerAccounts.ensureWorkspace, { userId: reviewer }),
  ).rejects.toThrow();
  await expect(elsewhere.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();
});

test("sign-in is allowed only while the identity is still the ordinary demo member", async () => {
  async function provisioned() {
    const t = convexTest(schema, modules);
    const userId = await insertReviewerUser(t);
    await expect(t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();
    const { orgId } = await t.mutation(internal.reviewerAccounts.ensureWorkspace, { userId });
    return { t, userId, orgId };
  }

  const ok = await provisioned();
  expect(await ok.t.query(internal.reviewerAccounts.assertSignIn, {})).toEqual({
    userId: ok.userId,
  });

  const promoted = await provisioned();
  await promoted.t.run((ctx) => ctx.db.patch(promoted.userId, { accountKind: "operator" }));
  await expect(promoted.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();

  const withProfile = await provisioned();
  await withProfile.t.run((ctx) =>
    ctx.db.insert("operatorProfiles", {
      userId: withProfile.userId,
      email: REVIEW_EMAIL,
      role: "operator",
      status: "disabled",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await expect(withProfile.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();

  const service = await provisioned();
  await service.t.run((ctx) => ctx.db.patch(service.userId, { serviceAccountKind: "slack" }));
  await expect(service.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();

  const elsewhere = await provisioned();
  await elsewhere.t.run(async (ctx) => {
    const real = await ctx.db.insert("organizations", { name: "Real Co", type: "client" });
    await ctx.db.insert("orgMemberships", { orgId: real, userId: elsewhere.userId, role: "member" });
  });
  await expect(elsewhere.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();

  const limited = await provisioned();
  await limited.t.run((ctx) => ctx.db.patch(limited.orgId, { clientAccessStatus: "limited" }));
  await expect(limited.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();

  const removed = await provisioned();
  await removed.t.run(async (ctx) => {
    const membership = await ctx.db.query("orgMemberships").first();
    await ctx.db.delete(membership!._id);
  });
  await expect(removed.t.query(internal.reviewerAccounts.assertSignIn, {})).rejects.toThrow();
});
