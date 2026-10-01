/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const getContext = makeFunctionReference<"query">(
  "chatgptWorkspace:getContext",
);

const baseArgs = {
  canWrite: false,
  websiteUrl: "https://spot.insure",
};

async function fixture() {
  const t = convexTest(schema, modules);
  return {
    t,
    ...(await t.run(async (ctx) => {
      const clientUserId = await ctx.db.insert("users", {
        email: "client@example.com",
        accountKind: "customer",
      });
      const brokerUserId = await ctx.db.insert("users", {
        email: "broker@example.com",
        accountKind: "customer",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "operator@claritylabs.inc",
        accountKind: "operator",
      });
      const clientOrgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
        website: "https://cove.example",
      });
      const secondClientOrgId = await ctx.db.insert("organizations", {
        name: "Harbor",
        type: "client",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      });
      const deletedClientOrgId = await ctx.db.insert("organizations", {
        name: "Deleted Client",
        type: "client",
        deletedAt: 1,
      });
      const clientMembershipId = await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "admin",
      });
      const brokerMembershipId = await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: brokerUserId,
        role: "member",
      });
      const operatorProfileId = await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@claritylabs.inc",
        role: "owner",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("brokerProfiles", {
        brokerOrgId,
        networkStatus: "active",
        writingStates: ["NY"],
        lineOfBusinessCodes: ["CGL"],
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        clientUserId,
        brokerUserId,
        operatorUserId,
        clientOrgId,
        secondClientOrgId,
        brokerOrgId,
        deletedClientOrgId,
        clientMembershipId,
        brokerMembershipId,
        operatorProfileId,
      };
    })),
  };
}

test("returns a live client context and preserves the read-only token scope", async () => {
  const { t, clientUserId, clientOrgId } = await fixture();

  await expect(
    t.query(getContext, {
      ...baseArgs,
      userId: clientUserId,
      principalKind: "organization",
      orgId: clientOrgId,
    }),
  ).resolves.toEqual({
    version: 1,
    principal: { kind: "client", role: "admin", canWrite: false },
    organizations: [{ id: clientOrgId, name: "Cove", type: "client" }],
    activeOrganizationId: clientOrgId,
    views: [
      "policies",
      "certificates",
      "compliance",
      "requests",
      "files",
      "company",
      "mailbox",
      "activity",
      "settings",
    ],
    websiteUrl: "https://spot.insure",
  });
});

test("an organization principal cannot switch its bound tenant or forge operator access", async () => {
  const { t, clientUserId, clientOrgId, secondClientOrgId, operatorUserId } =
    await fixture();

  await expect(
    t.query(getContext, {
      ...baseArgs,
      userId: clientUserId,
      principalKind: "organization",
      orgId: clientOrgId,
      organizationId: secondClientOrgId,
    }),
  ).rejects.toThrow();

  await expect(
    t.query(getContext, {
      ...baseArgs,
      userId: operatorUserId,
      principalKind: "organization",
      orgId: clientOrgId,
    }),
  ).rejects.toThrow();
});

test("rechecks membership and organization liveness on every organization request", async () => {
  const { t, clientUserId, clientOrgId, clientMembershipId } = await fixture();
  const args = {
    ...baseArgs,
    userId: clientUserId,
    principalKind: "organization" as const,
    orgId: clientOrgId,
  };

  await expect(t.query(getContext, args)).resolves.toMatchObject({
    activeOrganizationId: clientOrgId,
  });
  await t.run(async (ctx) => ctx.db.delete(clientMembershipId));
  await expect(t.query(getContext, args)).rejects.toThrow();

  const restored = await t.run(async (ctx) =>
    ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "admin",
    }),
  );
  await expect(t.query(getContext, args)).resolves.toMatchObject({
    activeOrganizationId: clientOrgId,
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(restored);
    await ctx.db.patch(clientOrgId, { deletedAt: 2 });
  });
  await expect(t.query(getContext, args)).rejects.toThrow();
});

test("broker context is limited to profile, team, and settings", async () => {
  const { t, brokerUserId, brokerOrgId } = await fixture();

  const result = await t.query(getContext, {
    ...baseArgs,
    canWrite: true,
    userId: brokerUserId,
    principalKind: "organization",
    orgId: brokerOrgId,
  });

  expect(result).toMatchObject({
    principal: { kind: "broker", role: "member", canWrite: true },
    activeOrganizationId: brokerOrgId,
    views: ["profile", "team", "settings"],
    brokerProfile: {
      networkStatus: "active",
      writingStates: ["NY"],
      lineOfBusinessCodes: ["CGL"],
    },
  });
  expect(result).not.toHaveProperty("policies");
  expect(result).not.toHaveProperty("clientOrganizations");
});

test("operator role and status are rechecked, and operator organizations are bounded to live clients", async () => {
  const { t, operatorUserId, operatorProfileId, secondClientOrgId, brokerOrgId } =
    await fixture();

  const result = await t.query(getContext, {
    ...baseArgs,
    canWrite: true,
    userId: operatorUserId,
    principalKind: "operator",
    operatorRole: "owner",
    organizationId: secondClientOrgId,
  });
  expect(result).toMatchObject({
    principal: { kind: "operator", role: "owner", canWrite: true },
    activeOrganizationId: secondClientOrgId,
    views: [
      "policies",
      "certificates",
      "compliance",
      "requests",
      "files",
      "company",
      "mailbox",
      "activity",
      "settings",
      "proposals",
    ],
  });
  expect(result.organizations).toEqual(
    expect.arrayContaining([
      { id: secondClientOrgId, name: "Harbor", type: "client" },
    ]),
  );
  expect(result.organizations).not.toEqual(
    expect.arrayContaining([
      { id: brokerOrgId, name: "Montgomery Risk", type: "broker" },
    ]),
  );

  await t.run(async (ctx) => ctx.db.patch(operatorProfileId, { status: "disabled" }));
  await expect(
    t.query(getContext, {
      ...baseArgs,
      userId: operatorUserId,
      principalKind: "operator",
      operatorRole: "owner",
    }),
  ).rejects.toThrow();
});

test("operator role metadata cannot override the live profile", async () => {
  const { t, operatorUserId } = await fixture();

  await expect(
    t.query(getContext, {
      ...baseArgs,
      userId: operatorUserId,
      principalKind: "operator",
      operatorRole: "operator",
    }),
  ).rejects.toThrow();
});

test("operator organization discovery is bounded and continues from its opaque cursor", async () => {
  const { t, operatorUserId } = await fixture();
  await t.run(async (ctx) => {
    for (let index = 0; index < 55; index += 1) {
      await ctx.db.insert("organizations", {
        name: `Paged Client ${index.toString().padStart(2, "0")}`,
        type: "client",
      });
    }
  });

  const first = await t.query(getContext, {
    ...baseArgs,
    userId: operatorUserId,
    principalKind: "operator",
  });
  expect(first.organizations).toHaveLength(50);
  expect(first.organizationCursor).toEqual(expect.any(String));

  const second = await t.query(getContext, {
    ...baseArgs,
    userId: operatorUserId,
    principalKind: "operator",
    cursor: first.organizationCursor,
  });
  expect(second.organizations.length).toBeGreaterThan(0);
  expect(second).not.toHaveProperty("organizationCursor");
});

