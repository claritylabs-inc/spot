/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { archive, get, getSummary, listForOperator, restore } from "./policies";

const modules = import.meta.glob("./**/*.ts");
const archiveFn = archive as any;
const getFn = get as any;
const getSummaryFn = getSummary as any;
const restoreFn = restore as any;
const listForOperatorFn = listForOperator as any;

async function seedBrokerClientPolicy(options: {
  uploadedBySide: "broker" | "client";
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
      brokerOrgId,
    });
    const brokerUserId = await ctx.db.insert("users", {
      name: "Broker Admin",
      email: "broker@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "admin",
    });
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const policyId = await ctx.db.insert("policies", {
      orgId: clientOrgId,
      carrier: "Carrier",
      policyNumber: "POL-1",
      linesOfBusiness: ["CGL"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Client",
      uploadedBySide: options.uploadedBySide,
      uploadedByUserId: brokerUserId,
    });
    await ctx.db.insert("policyDeclarationFacts", {
      orgId: clientOrgId,
      policyId,
      fieldPath: "coverages.0.limit",
      fieldGroup: "coverage_limit:general_liability",
      displayValue: "General Liability: $1,000,000",
      normalizedValue: "general liability 1000000",
      valueKind: "money",
      observedAt: 1,
      active: true,
      recordHash: "policy-fact-1",
    });
    await ctx.db.insert("policyDeclarationFacts", {
      orgId: clientOrgId,
      policyId,
      fieldPath: "coverages.0.limit",
      fieldGroup: "coverage_limit:general_liability",
      displayValue: "General Liability: $500,000",
      normalizedValue: "general liability 500000",
      valueKind: "money",
      observedAt: 0,
      active: false,
      recordHash: "policy-fact-stale",
    });

    return { brokerUserId, operatorUserId, clientOrgId, policyId };
  });

  return { t, ...ids };
}

describe("policy archive and restore", () => {
  test("blocks a broker member from archiving a client-uploaded policy", async () => {
    const { t, brokerUserId, policyId } = await seedBrokerClientPolicy({
      uploadedBySide: "client",
    });

    await expect(
      t
        .withIdentity({ subject: `${brokerUserId}|session` })
        .mutation(archiveFn, { id: policyId }),
    ).rejects.toThrow("You don’t have access to this organization");

    const policy = await t.run(async (ctx) => ctx.db.get(policyId));
    expect(policy?.deletedAt).toBeUndefined();
  });

  test("does not expose client policy details to broker members", async () => {
    const { t, brokerUserId, policyId } = await seedBrokerClientPolicy({
      uploadedBySide: "client",
    });
    const broker = t.withIdentity({ subject: `${brokerUserId}|session` });

    await expect(broker.query(getFn, { id: policyId })).resolves.toBeNull();
    await expect(
      broker.query(getSummaryFn, { id: policyId }),
    ).resolves.toBeNull();
  });
});
