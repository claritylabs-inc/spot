/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import schema from "./schema";
import { createStandaloneClientOrganizationByOperator } from "./operator";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

test("standalone client creation queues public research without creating access grants", async () => {
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
      companyResearch: { status: "pending" },
    });
    expect(await ctx.db.query("users").collect()).toHaveLength(1);
    expect(await ctx.db.query("orgMemberships").collect()).toHaveLength(0);
    expect(await ctx.db.query("orgInvitations").collect()).toHaveLength(0);
    expect(await ctx.db.query("clientInvitations").collect()).toHaveLength(0);
    expect(
      await ctx.db.system.query("_scheduled_functions").collect(),
    ).toMatchObject([
      {
        name: "actions/companyResearch:run",
        args: [{ orgId }],
        state: { kind: "pending" },
      },
    ]);
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
      companyResearch: {
        status: "pending",
        unresolvedFields: ["website", "industry", "industryVertical"],
      },
    });
    expect(await ctx.db.query("orgMemberships").collect()).toMatchObject([
      { orgId: clientOrgId, userId, role: "admin" },
    ]);
  });
});

test("self-service creation researches missing websites and preserves explicit legal identity", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "admin@harbor.example",
      accountKind: "customer",
    }),
  );
  const orgId = await t
    .withIdentity({ subject: `${userId}|session` })
    .mutation(api.orgs.createClientOrg, {
      name: "Harbor Robotics LLC d/b/a Harbor",
    });
  expect(await t.run((ctx) => ctx.db.get(orgId))).toMatchObject({
    name: "Harbor",
    relatedLegalEntities: [
      { legalName: "Harbor Robotics LLC", relationship: "current" },
    ],
    companyResearch: {
      status: "pending",
      unresolvedFields: ["website", "industry", "industryVertical"],
    },
  });
});

test("canonical standalone constructor rejects an existing client's current legal identity", async () => {
  const { t, operatorUserId } = await fixture();
  await t.run((ctx) =>
    createStandaloneClientOrganizationByOperator(ctx, {
      operatorUserId,
      name: "Harbor Robotics LLC dba Harbor",
    }),
  );
  await expect(
    t.run((ctx) =>
      createStandaloneClientOrganizationByOperator(ctx, {
        operatorUserId,
        name: "Harbor Robotics LLC",
      }),
    ),
  ).rejects.toThrow("already exists");
  expect(
    await t.run((ctx) => ctx.db.query("organizations").collect()),
  ).toHaveLength(1);
});

test("portal client edits preserve omitted website and clear an incompatible vertical", async () => {
  const { t, operatorUserId } = await fixture();
  const clientOrgId = await t.run(async (ctx) => {
    return await ctx.db.insert("organizations", {
      name: "Harbor",
      type: "client",
      website: "https://harbor.example",
      industry: "agriculture",
      industryVertical: "crop_farming",
      relatedLegalEntities: [
        { legalName: "Harbor LLC", relationship: "current" },
      ],
    });
  });
  await t
    .withIdentity({ subject: `${operatorUserId}|session` })
    .mutation(api.operator.updateClientSettings, {
      clientOrgId,
      name: "Harbor",
      industry: "construction",
    });
  const org = await t.run((ctx) => ctx.db.get(clientOrgId));
  expect(org).toMatchObject({
    website: "https://harbor.example",
    industry: "construction",
    relatedLegalEntities: [
      { legalName: "Harbor LLC", relationship: "current" },
    ],
    companyResearch: { status: "pending" },
  });
  expect(org?.industryVertical).toBeUndefined();
});

test("insurance profile form persists explicit empty entity type and source identifiers", async () => {
  const t = convexTest(schema, modules);
  const { userId, orgId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "admin@harbor.example",
      accountKind: "customer",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Harbor",
      type: "client",
      profileOverrides: { entityType: "corporation", fein: "12-3456789" },
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    return { userId, orgId };
  });
  const profile = {
    mailingAddress: {},
    entityType: "" as const,
    fein: "",
    businessNumber: "",
    operationsDescription: "",
  };
  const result = await t
    .withIdentity({ subject: `${userId}|session` })
    .mutation(api.orgs.updateOrganizationProfile, { profile });
  expect(result).toEqual(profile);
  expect((await t.run((ctx) => ctx.db.get(orgId)))?.profileOverrides).toEqual(
    profile,
  );
});

test("accepting a vendor invitation researches the newly created client", async () => {
  const t = convexTest(schema, modules);
  const token = "new-vendor-client";
  const tokenHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "owner@vendor.example",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Inviting client",
      type: "client",
    });
    await ctx.db.insert("connectedOrgInvitations", {
      clientOrgId,
      vendorEmail: "owner@vendor.example",
      requestedByUserId: userId,
      inviteTokenHash: tokenHash,
      status: "pending",
      expiresAt: Number.MAX_SAFE_INTEGER,
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  await t
    .withIdentity({ subject: `${userId}|session` })
    .mutation(api.connectedOrgs.acceptInvitation, { token });
  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .unique();
    expect(membership?.role).toBe("admin");
    expect(await ctx.db.get(membership!.orgId)).toMatchObject({
      type: "client",
      companyResearch: { status: "pending" },
    });
  });
});
