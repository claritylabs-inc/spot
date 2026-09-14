/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { createStandaloneClientOrganizationByOperator } from "./operator";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "operator@example.test",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.test",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  return { t, operatorUserId };
}

test("standalone client creation creates no users, access grants, invitations or scheduled work", async () => {
  const { t, operatorUserId } = await fixture();
  const orgId = await t.run((ctx) =>
    createStandaloneClientOrganizationByOperator(ctx, {
      operatorUserId,
      name: "Harbor Robotics",
      website: "https://harbor.example",
      operatorStatus: "live",
    }),
  );
  await t.run(async (ctx) => {
    expect(await ctx.db.get(orgId)).toMatchObject({
      type: "client",
      allowedEmails: [],
      emailVerification: "strict",
      operatorStatus: "live",
    });
    expect(await ctx.db.query("users").collect()).toHaveLength(1);
    expect(await ctx.db.query("orgMemberships").collect()).toHaveLength(0);
    expect(await ctx.db.query("orgInvitations").collect()).toHaveLength(0);
    expect(await ctx.db.query("clientInvitations").collect()).toHaveLength(0);
    expect(
      await ctx.db.system.query("_scheduled_functions").collect(),
    ).toHaveLength(0);
  });
});

test("interactive creation retains explicit team membership and onboarding defaults", async () => {
  const { t, operatorUserId } = await fixture();
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      accountKind: "customer",
      email: "admin@harbor.example",
    }),
  );
  const { clientOrgId } = await t.mutation(
    internal.operator.createSoloClientInternal,
    {
      operatorUserId,
      client: { name: "Harbor Robotics" },
      users: [{ userId, email: "admin@harbor.example", role: "admin" }],
    },
  );
  await t.run(async (ctx) => {
    expect(await ctx.db.get(clientOrgId)).toMatchObject({
      operatorStatus: "onboarding",
      allowedEmails: ["admin@harbor.example"],
      primaryInsuranceContactId: userId,
    });
    expect(await ctx.db.query("orgMemberships").collect()).toMatchObject([
      { orgId: clientOrgId, userId, role: "admin" },
    ]);
  });
});
