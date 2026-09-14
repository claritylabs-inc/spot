/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./lib/markdownDocument";

const modules = import.meta.glob("./**/*.ts");

test("Markdown front matter round-trips ordinary YAML and rejects executable or ambiguous metadata", () => {
  const body =
    "# Company\n\n| Location | Team |\n| --- | --- |\n| Boston | 12 |\n\n```yaml\n---\n```\n";
  const frontmatter = {
    title: "Cove: company",
    reviewed: false,
    sources: ["https://example.com"],
    nested: { date: "2026-09-14" },
  };
  expect(
    parseMarkdownDocument(stringifyMarkdownDocument(frontmatter, body)),
  ).toEqual({ frontmatter, body });
  for (const metadata of [
    "title: One\ntitle: Two",
    "value: !!js/function 'function() {}'",
    "a: &ref [1]\nb: *ref",
    "__proto__: { polluted: true }",
    "- array",
  ]) {
    expect(() =>
      parseMarkdownDocument(`---\n${metadata}\n---\nBody`),
    ).toThrow();
  }
});

test("Markdown saves reject stale revisions and cross-organization document lookups", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const otherOrgId = await ctx.db.insert("organizations", {
      name: "Other",
      type: "client",
    });
    const doc = await saveMarkdownDocument(ctx, {
      orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      markdown: "Original",
      expectedRevision: 0,
    });
    return { orgId, otherOrgId, doc };
  });
  await t.run(async (ctx) => {
    await saveMarkdownDocument(ctx, {
      orgId: ids.orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      markdown: "First editor",
      expectedRevision: 1,
    });
  });
  await expect(
    t.run((ctx) =>
      saveMarkdownDocument(ctx, {
        orgId: ids.orgId,
        kind: "company_wiki",
        filename: "company-wiki.md",
        markdown: "Stale editor",
        expectedRevision: 1,
      }),
    ),
  ).rejects.toThrow(/changed/);
  expect(
    await t.run((ctx) =>
      getMarkdownDocument(ctx, { orgId: ids.orgId, kind: "company_wiki" }),
    ),
  ).toMatchObject({
    markdown: "---\nvisibility: shared\n---\nFirst editor",
    revision: 2,
  });
  expect(
    await t.run((ctx) =>
      getMarkdownDocument(ctx, { orgId: ids.otherOrgId, kind: "company_wiki" }),
    ),
  ).toBeNull();
  await expect(
    t.run((ctx) =>
      getMarkdownDocument(ctx, { orgId: ids.orgId, kind: "packet" }),
    ),
  ).rejects.toThrow(/scope/);
});
