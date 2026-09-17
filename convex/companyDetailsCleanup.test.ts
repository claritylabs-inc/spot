/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import migrationsTest from "@convex-dev/migrations/test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";

const modules = import.meta.glob("./**/*.ts");

test("company cleanup removes structured details without changing Markdown or source provenance", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { orgId, extractionId, document } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
      website: "https://cove.example",
      industry: "software",
      relatedLegalEntities: [{ legalName: "Cove Inc." }],
      profileOverrides: {
        fein: "12-3456789",
        operationsDescription: "Software",
      },
      mailingAddress: { street1: "1 Main St" },
    });
    const actorUserId = await ctx.db.insert("users", { name: "Operator" });
    const extractionId = await ctx.db.insert("companyInformationExtractions", {
      orgId,
      actorUserId,
      sourceKind: "client_file",
      sourceRef: "client_file:source-evidence",
      sourceFingerprint: "source-version",
      appliedFingerprint: "source-version",
      extractionVersion: "company-information-v1",
      status: "completed",
      attempts: 1,
      observedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        namedInsured: null,
        mailingAddress: null,
        dba: null,
        entityType: null,
        fein: {
          value: "12-3456789",
          confidence: 1,
          evidence: "Tax ID: 12-3456789",
        },
        businessNumber: null,
        operationsDescription: null,
        additionalNamedInsureds: [],
      },
      organizationFacts: [
        {
          section: "operations",
          content: "Cove develops software.",
          confidence: 1,
        },
      ],
    });
    const document = await saveMarkdownDocument(ctx, {
      orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      markdown: "## Operations\n\nManual company narrative.",
      expectedRevision: 0,
    });
    return { orgId, extractionId, document };
  });
  await t.mutation(internal.migrations.removeCompanyDetails, { cursor: null });
  await t.mutation(internal.migrations.removeCompanyExtractionProfiles, {
    cursor: null,
  });
  await t.run(async (ctx) => {
    const org = (await ctx.db.get(orgId))!;
    expect(org.name).toBe("Cove");
    expect(org.website).toBe("https://cove.example");
    for (const key of [
      "industry",
      "relatedLegalEntities",
      "profileOverrides",
      "mailingAddress",
    ] as const)
      expect(org[key]).toBeUndefined();
    expect(
      await getMarkdownDocument(ctx, { orgId, kind: "company_wiki" }),
    ).toEqual(document);
    const extraction = (await ctx.db.get(extractionId))!;
    expect(extraction.profile).toBeUndefined();
    expect(extraction.sourceRef).toBe("client_file:source-evidence");
    expect(extraction.sourceFingerprint).toBe("source-version");
    expect(extraction.organizationFacts).toEqual([
      {
        section: "operations",
        content: "Cove develops software.",
        confidence: 1,
      },
    ]);
  });
});
