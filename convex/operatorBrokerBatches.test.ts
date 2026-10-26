/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "worker@spot.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "worker@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  return { t, operatorUserId };
}

test("invalid final batch item leaves no provider or audit writes", async () => {
  const { t, operatorUserId } = await fixture();
  await expect(
    t.mutation(internal.operatorBrokerBatches.execute, {
      operatorUserId,
      toolName: "ensure_broker_network_profiles",
      input: {
        items: [
          { name: "First" },
          { name: "Last", lineOfBusinessCodes: ["CAUT"] },
        ],
      },
    }),
  ).rejects.toThrow(/ACORD/);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("organizations").collect()).toEqual([]);
    expect(await ctx.db.query("operatorAuditEvents").collect()).toEqual([]);
  });
});

test("Spot-owned batch identity fails closed before any writes", async () => {
  const { t, operatorUserId } = await fixture();
  await expect(
    t.mutation(internal.operatorBrokerBatches.execute, {
      operatorUserId,
      toolName: "ensure_broker_network_profiles",
      input: { items: [{ name: "First" }, { domain: "team.spot.insure" }] },
    }),
  ).rejects.toThrow(/Spot-owned/);
  expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toEqual(
    [],
  );
});

test("repeated normalized domain ensure reuses the provider", async () => {
  const { t, operatorUserId } = await fixture();
  const args = {
    operatorUserId,
    toolName: "ensure_broker_network_profiles" as const,
    input: {
      items: [
        { name: "Example", domain: "www.example.com" },
        { name: "Alias", website: "https://example.com/about" },
      ],
    },
  };
  const first = await t.mutation(internal.operatorBrokerBatches.execute, args);
  const second = await t.mutation(internal.operatorBrokerBatches.execute, args);
  expect(first.results[0].orgId).toBe(first.results[1].orgId);
  expect(second.results.map((row) => row.outcome)).toEqual([
    "matched",
    "matched",
  ]);
  expect(
    await t.run((ctx) => ctx.db.query("organizations").collect()),
  ).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("operatorAuditEvents").collect()),
  ).toHaveLength(1);
});
