/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("clearing company memory preserves packet documents", async () => {
  const t = convexTest(schema, modules);
  const packetId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const shared = {
      orgId,
      markdown: "---\nvisibility: private\n---\nPreserved content",
      revision: 1,
      updatedAt: 1,
    };
    await ctx.db.insert("markdownDocuments", {
      ...shared,
      kind: "company_wiki",
      filename: "company-wiki.md",
    });
    return ctx.db.insert("markdownDocuments", {
      ...shared,
      kind: "packet",
      filename: "private.md",
    });
  });
  expect(
    await t.mutation(internal.memoryMaintenance.clearTableBatch, {
      table: "markdownDocuments",
    }),
  ).toMatchObject({ deleted: 1, requeued: false });
  expect(await t.run((ctx) => ctx.db.get(packetId))).not.toBeNull();
});
