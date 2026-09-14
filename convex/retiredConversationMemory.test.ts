/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("audits and resumes a bounded retired-memory purge without deleting company knowledge", async () => {
  const t = convexTest(schema, modules);
  const wikiId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    for (let i = 0; i < 101; i += 1) {
      await ctx.db.insert("conversationTurns", {
        orgId,
        conversationId: `old-${i}`,
        role: "user",
        content: "Retired conversation embedding",
        embedding: Array.from({ length: 1536 }, () => 0),
        createdAt: 1,
      });
    }
    return ctx.db.insert("orgWikiSections", {
      orgId,
      key: "profile",
      heading: "Company",
      body: "Current company knowledge",
      order: 0,
      source: "manual",
      createdAt: 1,
      updatedAt: 1,
    });
  });

  const first = await t.query(internal.retiredConversationMemory.audit, {});
  expect(first).toMatchObject({ count: 100, complete: false });
  expect(first.nextCursor).toBeTypeOf("string");
  expect(
    await t.query(internal.retiredConversationMemory.audit, {
      cursor: first.nextCursor!,
    }),
  ).toMatchObject({ count: 1, complete: true, nextCursor: null });
  expect(
    await t.mutation(internal.retiredConversationMemory.purgeBatch, {}),
  ).toEqual({ deleted: 100, complete: false });
  expect(await t.query(internal.retiredConversationMemory.verify, {})).toEqual({
    complete: false,
  });
  expect(
    await t.mutation(internal.retiredConversationMemory.purgeBatch, {}),
  ).toEqual({ deleted: 1, complete: true });
  expect(await t.query(internal.retiredConversationMemory.verify, {})).toEqual({
    complete: true,
  });
  expect(
    await t.mutation(internal.retiredConversationMemory.purgeBatch, {}),
  ).toEqual({ deleted: 0, complete: true });
  expect(await t.run((ctx) => ctx.db.get(wikiId))).toMatchObject({
    body: "Current company knowledge",
  });
});
