/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { clientClassificationPatch, clientIdentity, clientIdentityMatches, mergeInsuranceProfilePatch } from "./lib/clientProfile";
import { preflightOperatorToolConfirmation } from "./lib/operatorAgentConfirmationPreflight";

const modules = import.meta.glob("./**/*.ts");

test("DBA normalization combines duplicate legal metadata and excludes affiliates from identity matching", () => {
  const identity = clientIdentity(" Harbor Robotics LLC d/b/a Harbor ", [
    { legalName: "Harbor Robotics LLC", relationship: "current", jurisdiction: "Delaware" },
    { legalName: "harbor robotics llc", relationship: "other", taxId: "12-3456789" },
    { legalName: "Partner LLC", relationship: "affiliate" },
  ]);
  expect(identity).toEqual({ name: "Harbor", relatedLegalEntities: [
    { legalName: "Harbor Robotics LLC", relationship: "current", jurisdiction: "Delaware", taxId: "12-3456789" },
    { legalName: "Partner LLC", relationship: "affiliate" },
  ] });
  expect(clientIdentityMatches(identity, "Harbor Robotics LLC")).toBe(true);
  expect(clientIdentityMatches(identity, "Partner LLC")).toBe(false);
  expect(clientIdentity("Alpha dba Beta dba Gamma").name).toBe("Alpha dba Beta dba Gamma");
});

test("partial classification and insurance updates preserve omitted fields and explicit clears", () => {
  const current = { industry: "agriculture", industryVertical: "crop_farming" };
  expect(clientClassificationPatch(current, {})).toEqual({});
  expect(clientClassificationPatch(current, { industry: "construction" })).toEqual({ industry: "construction", industryVertical: undefined });
  expect(clientClassificationPatch(current, { industry: null })).toEqual({ industry: undefined, industryVertical: undefined });
  expect(() => clientClassificationPatch(current, { industryVertical: "roofing" })).toThrow("belonging");
  const address = { street1: "10 Main St", city: "Boston", state: "MA" };
  expect(mergeInsuranceProfilePatch({ fein: "12-3456789" }, address, { mailingAddress: { city: "Cambridge" }, entityType: "" })).toEqual({
    fein: "12-3456789", entityType: "", mailingAddress: { ...address, city: "Cambridge" },
  });
  expect(mergeInsuranceProfilePatch({ fein: "12-3456789" }, address, { mailingAddress: {}, fein: "" })).toEqual({ mailingAddress: {}, fein: "" });
});

test("confirmation preflight validates the effective classification and research requires a client", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", { accountKind: "operator" });
    const threadId = ctx.db.normalizeId("operatorAgentThreads", "10001;operatorAgentThreads")!;
    const orgId = await ctx.db.insert("organizations", { name: "Harbor", type: "client", industry: "agriculture", industryVertical: "crop_farming" });
    const brokerId = await ctx.db.insert("organizations", { name: "Broker", type: "broker" });
    const preflight = (toolName: "update_organization_profile" | "research_client", input: Record<string, unknown>) =>
      preflightOperatorToolConfirmation(ctx, { operatorUserId, threadId, toolName, input });
    await expect(preflight("update_organization_profile", { orgId, industry: "construction" })).resolves.toBeUndefined();
    await expect(preflight("update_organization_profile", { orgId, industryVertical: "roofing" })).rejects.toThrow("belonging");
    await ctx.db.patch(orgId, { industry: "legacy_custom" });
    await expect(preflight("update_organization_profile", { orgId, website: "https://harbor.example" })).resolves.toBeUndefined();
    await expect(preflight("research_client", { orgId: brokerId })).rejects.toThrow("Client organization");
  });
});
