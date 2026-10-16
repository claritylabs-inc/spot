/// <reference types="vite/client" />
// Seeding safety only: the reviewer is an ordinary account with no runtime gates.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { REVIEW_EMAIL, REVIEW_ORG_SLUG } from "./lib/reviewerAuth";

const modules = import.meta.glob("./**/*.ts");

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
      provider: "password",
      providerAccountId: REVIEW_EMAIL,
      secret: "hash",
    });
    return userId;
  });
}

test("seeding never takes over an account or organization that is not the reviewer's", async () => {
  const clean = convexTest(schema, modules);
  expect(await clean.query(internal.reviewerAccounts.prepare, {})).toEqual({ kind: "create" });

  const existingUser = convexTest(schema, modules);
  await existingUser.run((ctx) => ctx.db.insert("users", { email: REVIEW_EMAIL }));
  await expect(existingUser.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const foreignAccount = convexTest(schema, modules);
  await foreignAccount.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "someone@example.com" });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "resend-otp",
      providerAccountId: REVIEW_EMAIL,
    });
  });
  await expect(foreignAccount.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const orphanOrg = convexTest(schema, modules);
  await orphanOrg.run((ctx) =>
    ctx.db.insert("organizations", { name: "Squatter", type: "client", slug: REVIEW_ORG_SLUG }),
  );
  await expect(orphanOrg.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();

  const operatorKind = convexTest(schema, modules);
  const operatorId = await insertReviewerUser(operatorKind);
  await operatorKind.run((ctx) => ctx.db.patch(operatorId, { accountKind: "operator" }));
  await expect(operatorKind.query(internal.reviewerAccounts.prepare, {})).rejects.toThrow();
});

test("the workspace is one active client org with a member and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const userId = await insertReviewerUser(t);
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
    const memberships = await ctx.db.query("orgMemberships").collect();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ orgId: first.orgId, userId, role: "member" });
    const policies = await ctx.db.query("policies").collect();
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.orgId).toBe(first.orgId);
      expect(policy.isDemo).toBe(true);
    }
  });
});

test("seeding refuses a demo organization that belongs to other users", async () => {
  const t = convexTest(schema, modules);
  const userId = await insertReviewerUser(t);
  const { orgId } = await t.mutation(internal.reviewerAccounts.ensureWorkspace, { userId });
  await t.run(async (ctx) => {
    const memberships = await ctx.db.query("orgMemberships").collect();
    for (const membership of memberships) await ctx.db.delete(membership._id);
    const other = await ctx.db.insert("users", { email: "real@example.com" });
    await ctx.db.insert("orgMemberships", { orgId, userId: other, role: "member" });
  });
  await expect(t.mutation(internal.reviewerAccounts.ensureWorkspace, { userId })).rejects.toThrow();
});
