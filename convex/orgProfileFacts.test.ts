/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
  effectiveOrganizationProfileFacts,
  resolveEffectiveOrganizationProfile,
  syncOrgProfileFromDeclarationFacts,
} from "./lib/orgProfileFacts";

const modules = import.meta.glob("./**/*.ts");
const companyProfile = {
  namedInsured: { value: "Acme Holdings LLC", confidence: 1, evidence: "Legal entity: Acme Holdings LLC" },
  dba: { value: "Acme", confidence: 1, evidence: "Doing business as Acme" },
  mailingAddress: null,
  entityType: null,
  fein: null,
  businessNumber: null,
  operationsDescription: null,
  additionalNamedInsureds: [
    { value: "Acme Tenant LLC", confidence: 1, evidence: "Additional named insured: Acme Tenant LLC" },
  ],
};

describe("organization profile source ownership", () => {
  test("retracts derived company identities with their source while preserving manual adoption", async () => {
    const t = convexTest(schema, modules);
    const { orgId, extractionId } = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", { name: "Operator" });
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme Holdings LLC", type: "client",
        relatedLegalEntities: [{ legalName: "Trusted Partner", relationship: "affiliate" }],
      });
      const extractionId = await ctx.db.insert("companyInformationExtractions", {
        orgId, actorUserId, sourceKind: "client_file", sourceRef: "client_file:fixture",
        sourceFingerprint: "fingerprint", appliedFingerprint: "fingerprint", extractionVersion: "fixture",
        status: "completed", attempts: 1, profile: companyProfile, observedAt: 1, createdAt: 1, updatedAt: 1,
      });
      await syncOrgProfileFromDeclarationFacts(ctx, orgId);
      return { orgId, extractionId };
    });
    const imported = await t.run((ctx) => ctx.db.get(orgId));
    expect(imported).toMatchObject({ name: "Acme" });
    expect(imported?.relatedLegalEntities).toEqual([
      { legalName: "Trusted Partner", relationship: "affiliate" },
      { legalName: "Acme Holdings LLC", relationship: "current", source: "extraction" },
      { legalName: "Acme Tenant LLC", relationship: "other", source: "extraction" },
    ]);
    expect(await t.run((ctx) => syncOrgProfileFromDeclarationFacts(ctx, orgId))).toEqual({ updated: false, reason: "unchanged" });
    await t.run(async (ctx) => {
      const org = await ctx.db.get(orgId);
      await ctx.db.patch(orgId, {
        relatedLegalEntities: org?.relatedLegalEntities?.map((entity) =>
          entity.legalName === "Acme Holdings LLC"
            ? { ...entity, source: undefined }
            : entity,
        ),
      });
      await ctx.db.delete(extractionId);
      await syncOrgProfileFromDeclarationFacts(ctx, orgId);
    });
    const retracted = await t.run((ctx) => ctx.db.get(orgId));
    expect(retracted?.profileFacts).toBeUndefined();
    expect(retracted?.relatedLegalEntities).toEqual([
      { legalName: "Trusted Partner", relationship: "affiliate" },
      { legalName: "Acme Holdings LLC", relationship: "current" },
    ]);
  });

  test("preserves an unrelated chosen display name and replaces stale derived identities", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", { name: "Operator" });
      const orgId = await ctx.db.insert("organizations", { name: "Chosen portfolio name", type: "client" });
      const extractionId = await ctx.db.insert("companyInformationExtractions", {
        orgId, actorUserId, sourceKind: "client_file", sourceRef: "client_file:fixture",
        sourceFingerprint: "one", appliedFingerprint: "one", extractionVersion: "fixture",
        status: "completed", attempts: 1, profile: companyProfile, observedAt: 1, createdAt: 1, updatedAt: 1,
      });
      await syncOrgProfileFromDeclarationFacts(ctx, orgId);
      await ctx.db.patch(extractionId, {
        profile: { ...companyProfile, namedInsured: { value: "Acme New LLC", confidence: 1, evidence: "Legal name updated" }, additionalNamedInsureds: [] },
        sourceFingerprint: "two", appliedFingerprint: "two", observedAt: 2,
      });
      await syncOrgProfileFromDeclarationFacts(ctx, orgId);
      return orgId;
    });
    const org = await t.run((ctx) => ctx.db.get(orgId));
    expect(org?.name).toBe("Chosen portfolio name");
    expect(org?.relatedLegalEntities).toEqual([
      { legalName: "Acme New LLC", relationship: "current", source: "extraction" },
      { legalName: "Acme", relationship: "dba", source: "extraction" },
    ]);
  });
});

describe("effective organization profile", () => {
  test("explicit empty overrides remain cleared in editable and certificate/agent projections", () => {
    const org = {
      mailingAddress: { street1: "Legacy address" },
      profileFacts: {
        namedInsured: { value: "Acme LLC" },
        mailingAddress: { value: { street1: "Source address" } },
        fein: { value: "12-3456789" },
        taxId: { value: "12-3456789" },
        businessNumber: { value: "123456789" },
        entityType: { value: "corporation" },
        operationsDescription: { value: "Old operations" },
      },
      profileOverrides: { mailingAddress: {}, fein: "", businessNumber: "", entityType: "", operationsDescription: "" },
    };
    expect(resolveEffectiveOrganizationProfile(org)).toEqual({
      mailingAddress: {}, fein: "", businessNumber: "", entityType: "", operationsDescription: "",
    });
    expect(effectiveOrganizationProfileFacts(org)).toEqual({ namedInsured: { value: "Acme LLC" } });
    expect(resolveEffectiveOrganizationProfile({ ...org, profileOverrides: undefined })).toMatchObject({
      mailingAddress: { street1: "Source address" }, fein: "12-3456789", businessNumber: "123456789",
    });
  });
});
