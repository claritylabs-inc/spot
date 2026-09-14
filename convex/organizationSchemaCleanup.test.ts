/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { readOrgWiki } from "./orgWiki";

const modules = import.meta.glob("./**/*.ts");

test("organization cleanup preserves entity notes as Markdown without restoring them during DBA normalization", async () => {
  const t = convexTest(schema, modules);
  const orgId = await t.run((ctx) =>
    ctx.db.insert("organizations", {
      name: "Cove Holdings LLC DBA Cove",
      type: "client",
      context: "Cove builds commercial software.",
      relatedLegalEntities: [
        {
          legalName: "Cove Holdings LLC",
          relationship: "current",
          notes:
            "Owned by the founders.\n\n| Share class | Voting |\n| --- | --- |\n| Common | Yes |",
        },
      ],
    }),
  );
  expect(
    await t.query(internal.organizationSchemaCleanup.auditPage, {
      cursor: null,
    }),
  ).toMatchObject({ narrativeRows: 1, entityNoteRows: 1 });
  await t.mutation(internal.organizationSchemaCleanup.migratePage, {
    cursor: null,
  });
  const org = await t.run((ctx) => ctx.db.get(orgId));
  expect(org?.name).toBe("Cove");
  expect(org?.context).toBeUndefined();
  expect(org?.relatedLegalEntities).toEqual([
    { legalName: "Cove Holdings LLC", relationship: "current" },
  ]);
  const wiki = await t.run((ctx) => readOrgWiki(ctx, orgId));
  expect(wiki.body).toContain("Cove builds commercial software.");
  expect(wiki.body).toContain(
    "### Cove Holdings LLC (current)\n\nOwned by the founders.",
  );
  expect(wiki.body).toContain("| Common | Yes |");
  await t.mutation(internal.organizationSchemaCleanup.migratePage, {
    cursor: null,
  });
  expect((await t.run((ctx) => readOrgWiki(ctx, orgId))).markdown).toBe(
    wiki.markdown,
  );
  expect(
    await t.query(internal.organizationSchemaCleanup.auditPage, {
      cursor: null,
    }),
  ).toMatchObject({
    narrativeRows: 0,
    entityNoteRows: 0,
    unnormalizedNames: 0,
  });
});

test("legacy untyped clients normalize and queue research while acceptance fixtures stay untouched", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    client: await ctx.db.insert("organizations", {
      name: "Legacy LLC DBA Legacy",
    }),
    fixture: await ctx.db.insert("organizations", {
      name: "[Synthetic router acceptance] fixture",
    }),
  }));
  expect(
    await t.query(internal.organizationSchemaCleanup.auditPage, {
      cursor: null,
    }),
  ).toMatchObject({ missingType: 1, missingResearch: 1, researchPending: 0 });
  await t.mutation(internal.organizationSchemaCleanup.migratePage, {
    cursor: null,
  });
  const client = await t.run((ctx) => ctx.db.get(ids.client));
  expect(client).toMatchObject({
    name: "Legacy",
    type: "client",
    companyResearch: { status: "pending" },
  });
  expect((await t.run((ctx) => ctx.db.get(ids.fixture)))?.type).toBeUndefined();
  expect(
    await t.query(internal.organizationSchemaCleanup.auditPage, {
      cursor: null,
    }),
  ).toMatchObject({ missingType: 0, missingResearch: 0, researchPending: 1 });
});
