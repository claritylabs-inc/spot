/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSettings(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    await ctx.db.insert("globalModelSettings", {
      key: "default",
      routes: {
        operator_agent: { provider: "openai", model: "gpt-5.5" },
        extraction: { provider: "anthropic", model: "claude-sonnet-5" },
      },
      explicitRouteOverrides: ["operator_agent", "extraction"],
      webRetrieval: { primary: "openai" },
      updatedBy: userId,
      updatedAt: 1,
    } as never);
  });
}

test("clearing overrides keeps the operator agent route the runtime still needs", async () => {
  const t = convexTest(schema, modules);
  await seedSettings(t);
  await t.mutation(internal.modelSettings.clearOperatorModelOverridesInternal, {});
  const row = await t.run(async (ctx) =>
    ctx.db.query("globalModelSettings").first(),
  );
  expect(row?.routes).toEqual({
    operator_agent: { provider: "openai", model: "gpt-5.5" },
  });
  expect(row?.explicitRouteOverrides).toEqual(["operator_agent"]);
  expect(row?.webRetrieval).toBeUndefined();
  await expect(
    t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
  ).resolves.toEqual({ provider: "openai", model: "gpt-5.5" });
});

test("the operator agent route can be set without the removed settings UI", async () => {
  const t = convexTest(schema, modules);
  await seedSettings(t);
  await t.mutation(internal.modelSettings.setOperatorAgentRouteInternal, {
    provider: "anthropic",
    model: "claude-opus-5-5",
  });
  await expect(
    t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
  ).resolves.toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
});
