/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const current = { policyImports: true, requirementImports: false };
async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", { email: "owner@example.com" });
    const otherId = await ctx.db.insert("users", {
      email: "other@example.com",
    });
    for (const id of [userId, otherId])
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId: id,
        role: "member",
      });
    const accountId = await ctx.db.insert("connectedEmailAccounts", {
      orgId,
      userId,
      scope: "user",
      emailAddress: "owner@example.com",
      host: "imap.example.com",
      port: 993,
      secure: true,
      username: "owner@example.com",
      encryptedPassword: "unused",
      status: "active",
      automation: { ...current, companyMemory: true },
      createdAt: 1,
      updatedAt: 1,
    });
    return { orgId, userId, otherId, accountId };
  });
  return {
    t,
    owner: t.withIdentity({ subject: `${ids.userId}|session` }),
    ...ids,
  };
}

test("public settings strip legacy memory and accept current two-toggle writes", async () => {
  const { t, owner, orgId, accountId } = await seed();
  expect(
    (await owner.query(api.connectedEmail.list, { orgId }))[0].automation,
  ).toEqual(current);
  expect(
    await t.query(internal.connectedEmail.getAutomationEligibleInternal, {
      accountId,
    }),
  ).toMatchObject({ automation: current });
  const automation = { policyImports: false, requirementImports: true };
  expect(
    await owner.mutation(api.connectedEmail.updateSettings, {
      accountId,
      scope: "user",
      automation,
    }),
  ).toMatchObject({ automation });
  expect((await t.run((ctx) => ctx.db.get(accountId)))?.automation).toEqual(
    automation,
  );
  await expect(
    owner.mutation(api.connectedEmail.updateSettings, {
      accountId,
      scope: "user",
      automation: { ...current, companyMemory: true } as typeof current,
    }),
  ).rejects.toThrow();
});

test("new connection storage accepts current settings; personal mailbox authorization is unchanged", async () => {
  const { t, owner, orgId, userId, otherId, accountId } = await seed();
  const id = await t.mutation(internal.connectedEmail.upsertInternal, {
    orgId,
    userId,
    scope: "user",
    emailAddress: "new@example.com",
    host: "imap.example.com",
    port: 993,
    secure: true,
    username: "new@example.com",
    encryptedPassword: "unused",
    automation: current,
  });
  expect((await t.run((ctx) => ctx.db.get(id)))?.automation).toEqual(current);
  expect(
    (await owner.query(api.connectedEmail.list, { orgId })).map(
      (account) => account.automation,
    ),
  ).toEqual([current, current]);
  const other = t.withIdentity({ subject: `${otherId}|session` });
  expect(await other.query(api.connectedEmail.list, { orgId })).toEqual([]);
  await expect(
    other.mutation(api.connectedEmail.updateSettings, {
      accountId,
      scope: "user",
      automation: current,
    }),
  ).rejects.toThrow();
});
