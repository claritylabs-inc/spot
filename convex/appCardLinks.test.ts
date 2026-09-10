/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { getByToken } from "./appCardLinks";
import { hashMagicLinkToken } from "./lib/magicLinkTokens";

const modules = import.meta.glob("./**/*.ts");
const getAppCardByToken = getByToken as any;

describe("app card legacy compatibility", () => {
  test("keeps retired policy-change links unavailable", async () => {
    const t = convexTest(schema, modules);
    const token = "retired-policy-change-link";
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Legacy app card",
        type: "client",
      });
      await ctx.db.insert("appCardAccessLinks", {
        orgId,
        tokenHash: await hashMagicLinkToken(token),
        kind: "policy_change",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(t.query(getAppCardByToken, { token })).resolves.toBeNull();
  });
});
