/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
import schema from "./schema";
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

test("operator logo updates preserve client identity and research, and reject impersonation", async () => {
  const { t, operatorUserId } = await fixture();
  const { clientOrgId, logoStorageId, customerUserId } = await t.run(
    async (ctx) => ({
      clientOrgId: await ctx.db.insert("organizations", {
        name: "Harbor Robotics",
        type: "client",
        website: "https://harbor.example",
        clientAccessStatus: "limited",
      }),
      logoStorageId: await ctx.storage.store(
        new Blob(["logo"], { type: "image/png" }),
      ),
      customerUserId: await ctx.db.insert("users", {
        email: "customer@example.test",
        accountKind: "customer",
      }),
    }),
  );
  await t.run(async (ctx) => {
    // convex-test stores blob bytes but omits upload contentType metadata.
    // @ts-expect-error The test database permits patching system storage metadata.
    await ctx.db.patch(logoStorageId, { contentType: "image/png" });
  });
  const operator = t.withIdentity({ subject: operatorUserId });
  await operator.mutation(api.operator.updateClientSettings, {
    clientOrgId,
    iconStorageId: logoStorageId,
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(clientOrgId)).toMatchObject({
      name: "Harbor Robotics",
      website: "https://harbor.example",
      iconStorageId: logoStorageId,
    });
    expect(
      await ctx.db.system.query("_scheduled_functions").collect(),
    ).toHaveLength(0);
  });
  await expect(
    t
      .withIdentity({ subject: customerUserId })
      .mutation(api.operator.updateClientSettings, {
        clientOrgId,
        iconStorageId: logoStorageId,
      }),
  ).rejects.toThrow();
  await operator.mutation(api.operator.startImpersonation, {
    targetOrgId: clientOrgId,
    targetRole: "admin",
  });
  await expect(
    operator.mutation(api.operator.generateClientLogoUploadUrl, {
      clientOrgId,
    }),
  ).rejects.toThrow();
  await expect(
    operator.mutation(api.operator.updateClientSettings, {
      clientOrgId,
      name: "Changed",
    }),
  ).rejects.toThrow();
  await expect(
    operator.mutation(api.operator.setSoloClientStatus, {
      clientOrgId,
      status: "active",
    }),
  ).rejects.toThrow();
});

test("client access survives team activation and can be set explicitly", async () => {
  const { t, operatorUserId } = await fixture();
  const { clientOrgId, userId, membershipId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "admin@harbor.example",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Harbor Robotics",
      type: "client",
      clientAccessStatus: "limited",
      inviteStatus: "invited",
    });
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId,
      role: "admin",
    });
    return { clientOrgId, userId, membershipId };
  });
  const operator = t.withIdentity({ subject: operatorUserId });
  const activate = () =>
    t.mutation(internal.operator.markSoloClientLaunchedInternal, {
      clientOrgId,
      operatorUserId,
      adminUserId: userId,
      recipientEmail: "admin@harbor.example",
    });
  await activate();
  expect(
    (await t.run((ctx) => ctx.db.get(clientOrgId)))?.clientAccessStatus,
  ).toBe("active");
  await operator.mutation(api.operator.setSoloClientStatus, {
    clientOrgId,
    status: "limited",
  });
  await activate();
  const clients = await operator.query(api.operator.listClients, {});
  expect(
    clients.find((client) => client._id === clientOrgId)?.clientAccessStatus,
  ).toBe("active");
  expect(await t.run((ctx) => ctx.db.get(membershipId))).toMatchObject({
    orgId: clientOrgId,
    userId,
    role: "admin",
  });
});

test("operator tools set client access and reject brokers", async () => {
  const { t, operatorUserId } = await fixture();
  const { clientOrgId, brokerOrgId } = await t.run(async (ctx) => ({
    clientOrgId: await ctx.db.insert("organizations", {
      name: "Harbor",
      type: "client",
    }),
    brokerOrgId: await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    }),
  }));
  await t
    .withIdentity({ subject: operatorUserId })
    .mutation(api.operator.setApproveAll, { approveAll: true });
  for (const status of ["active", "limited"] as const) {
    const result = await t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId,
        channel: "mcp",
        conversationKey: "client-lifecycle",
        toolName: "set_client_access_status",
        input: { orgId: clientOrgId, status },
        idempotencyKey: status,
      },
    );
    expect(result.outcome.status).toBe("succeeded");
    expect(
      (await t.run((ctx) => ctx.db.get(clientOrgId)))?.clientAccessStatus,
    ).toBe(status);
  }
  await expect(
    t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      operatorUserId,
      channel: "mcp",
      conversationKey: "client-lifecycle",
      toolName: "set_client_access_status",
      input: { orgId: brokerOrgId, status: "active" },
      idempotencyKey: "broker-active",
    }),
  ).resolves.toMatchObject({
    outcome: {
      status: "failed",
      failure: { phase: "preflight", writeState: "not_started" },
    },
  });
  expect(
    (await t.run((ctx) => ctx.db.get(brokerOrgId)))?.clientAccessStatus,
  ).toBeUndefined();
});
