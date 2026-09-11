/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { defaultModelRouteForId } from "./lib/modelCatalog";
import { isExplicitGlobalRouteOverride } from "./modelSettings";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("global model route overrides", () => {
  it.each([
    { route: defaultModelRouteForId("chat"), explicit: [], expected: false },
    {
      route: defaultModelRouteForId("chat"),
      explicit: ["chat"],
      expected: true,
    },
    {
      route: { provider: "openai" as const, model: "gpt-5.5" },
      explicit: [],
      expected: true,
    },
  ])(
    "returns $expected for route $route.model",
    ({ route, explicit, expected }) => {
      expect(isExplicitGlobalRouteOverride("chat", route, explicit)).toBe(
        expected,
      );
    },
  );

  it("resolves statically valid routes without consumer provider keys", async () => {
    const t = convexTest(schema, modules);
    const now = dayjs().valueOf();
    const { operatorUserId, orgId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "routing-operator@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "routing-operator@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        routes: {
          operator_agent: defaultModelRouteForId("operator_agent"),
        },
        explicitRouteOverrides: [],
        updatedBy: userId,
        updatedAt: now,
      });
      const organizationId = await ctx.db.insert("organizations", {
        name: "Routing Test Client",
        type: "client",
      });
      return {
        operatorUserId: userId,
        orgId: organizationId,
      };
    });

    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).rejects.toThrow("Operator agent model is not configured");
    const manuallyChosenRoute = {
      provider: "openai" as const,
      model: "gpt-5.5",
    };
    const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
    await operator.mutation(api.modelSettings.updateGlobalRoutes, {
      routes: { operator_agent: manuallyChosenRoute },
    });
    await expect(
      t.query(internal.modelSettings.resolveOperatorAgentRoute, {}),
    ).resolves.toEqual(manuallyChosenRoute);
    const [orgSnapshot, publicSnapshot] = await Promise.all([
      t.query(internal.modelSettings.resolveForOrg, { orgId }),
      t.query(internal.modelSettings.resolvePublicDefaults, {}),
    ]);
    expect(orgSnapshot?.routes).not.toHaveProperty("operator_agent");
    expect(orgSnapshot?.routeSources).not.toHaveProperty("operator_agent");
    expect(orgSnapshot).not.toHaveProperty("providerKeys");
    expect(publicSnapshot.routes).not.toHaveProperty("operator_agent");
    expect(publicSnapshot.routeSources).not.toHaveProperty("operator_agent");
    expect(publicSnapshot).not.toHaveProperty("providerKeys");

    const operatorSettings = await operator.query(api.modelSettings.getGlobal);
    expect(operatorSettings.providers[0]).not.toHaveProperty("configured");
    expect(operatorSettings.providers[0]).not.toHaveProperty("transport");
    await expect(
      operator.mutation(api.modelSettings.updateGlobalRoutes, {
        routes: { operator_agent: null },
      }),
    ).rejects.toThrow("selection is required");
  });
});
