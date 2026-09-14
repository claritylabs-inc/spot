/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const audit = makeFunctionReference<"query">(
  "backendSchemaLegacy:ownershipAuditPage",
);
const clear = makeFunctionReference<"mutation">(
  "backendSchemaLegacy:clearLegacyOwnershipPage",
);

const policyFields = {
  carrier: "Insurer",
  policyNumber: "P-1",
  linesOfBusiness: ["CGL"],
  policyYear: 2026,
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  isRenewal: false,
  coverages: [],
  insuredName: "Client LLC",
};

test("retires unused broker links without rewriting client ownership or upload provenance", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const broker = await ctx.db.insert("organizations", {
      name: "Supplier",
      type: "broker",
    });
    const client = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
      brokerOrgId: broker,
    });
    const user = await ctx.db.insert("users", { name: "Original uploader" });
    const policy = await ctx.db.insert("policies", {
      ...policyFields,
      orgId: client,
      uploadedBySide: "broker",
      uploadedByUserId: user,
      uploadedByBrokerOrgId: broker,
    });
    return { broker, client, user, policy };
  });
  for (const table of ["organizations", "policies"]) {
    expect(await t.query(audit, { table, cursor: null })).toMatchObject({
      blockers: 0,
      legacyReferences: 1,
    });
    expect(await t.mutation(clear, { table, cursor: null })).toMatchObject({
      changed: 1,
    });
    expect(await t.query(audit, { table, cursor: null })).toMatchObject({
      legacyReferences: 1,
    });
    await t.mutation(clear, { table, cursor: null, dryRun: false });
    expect(await t.query(audit, { table, cursor: null })).toMatchObject({
      blockers: 0,
      legacyReferences: 0,
    });
    expect(
      await t.mutation(clear, { table, cursor: null, dryRun: false }),
    ).toMatchObject({ changed: 0 });
  }
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.policy)).toMatchObject({
      orgId: ids.client,
      uploadedBySide: "broker",
      uploadedByUserId: ids.user,
    });
    expect(await ctx.db.get(ids.policy)).not.toHaveProperty(
      "uploadedByBrokerOrgId",
    );
    expect(await ctx.db.get(ids.client)).not.toHaveProperty("brokerOrgId");
    const events = await ctx.db.query("operatorAuditEvents").collect();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.metadata.previous)).toEqual([
      { brokerOrgId: ids.broker },
      { uploadedByBrokerOrgId: ids.broker },
    ]);
  });
});

test("blocks actual broker-owned or unowned policy reassignment", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const broker = await ctx.db.insert("organizations", {
      name: "Supplier",
      type: "broker",
    });
    const owned = await ctx.db.insert("policies", {
      ...policyFields,
      orgId: broker,
      uploadedByBrokerOrgId: broker,
    });
    const unowned = await ctx.db.insert("policies", {
      ...policyFields,
      uploadedByBrokerOrgId: broker,
    });
    return { broker, owned, unowned };
  });
  expect(
    await t.query(audit, { table: "policies", cursor: null }),
  ).toMatchObject({ blockers: 2, legacyReferences: 2 });
  await expect(
    t.mutation(clear, { table: "policies", cursor: null, dryRun: false }),
  ).rejects.toThrow(/actual client owner/);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.owned)).toHaveProperty("orgId", ids.broker);
    expect(await ctx.db.get(ids.unowned)).not.toHaveProperty("orgId");
    expect(await ctx.db.query("operatorAuditEvents").collect()).toHaveLength(0);
  });
});
