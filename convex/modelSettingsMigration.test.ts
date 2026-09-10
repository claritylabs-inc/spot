/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { unsetLegacyBrokerModelProviderKeys } from "./migrations";
import { auditLegacyProviderKeys } from "./modelSettingsMigration";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const cleanupFn = unsetLegacyBrokerModelProviderKeys as any;
const auditFn = auditLegacyProviderKeys as any;

describe("legacy broker model provider key cleanup", () => {
  test("audits key presence without exposing values and removes the optional field", async () => {
    const t = convexTest(schema, modules);
    const { settingsId, routeOnlySettingsId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "legacy-broker@example.com",
        accountKind: "customer",
      });
      const brokerOrgId = await ctx.db.insert("organizations", {
        name: "Legacy Broker",
        type: "broker",
      });
      const settingsId = await ctx.db.insert("brokerModelSettings", {
        brokerOrgId,
        providerKeys: {
          openai: "legacy-openai-secret",
          fireworks: "legacy-fireworks-secret",
        },
        routes: {
          chat: { provider: "google", model: "gemini-2.5-pro" },
          analysis: { provider: "xai", model: "grok-4" },
        },
        updatedBy: userId,
        updatedAt: 1,
      });
      const routeOnlyOrgId = await ctx.db.insert("organizations", {
        name: "Route-only Broker",
        type: "broker",
      });
      const routeOnlySettingsId = await ctx.db.insert("brokerModelSettings", {
        brokerOrgId: routeOnlyOrgId,
        routes: {
          summary: { provider: "anthropic", model: "claude-sonnet-4-6" },
        },
        updatedBy: userId,
        updatedAt: 1,
      });
      return { settingsId, routeOnlySettingsId };
    });

    const audit = await t.query(auditFn, {
      paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(audit).toMatchObject({
      scanned: 2,
      legacyFieldRows: 1,
      configuredKeyRows: 1,
      configuredKeyProviders: ["fireworks", "openai"],
      configuredRouteProviders: ["anthropic", "google", "xai"],
      isDone: true,
      rows: [
        {
          settingsId,
          configuredKeyCount: 2,
          configuredKeyProviders: ["fireworks", "openai"],
          configuredRouteProviders: ["google", "xai"],
        },
      ],
    });
    expect(audit.routeRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settingsId,
          configuredKeyProviders: ["fireworks", "openai"],
          configuredRouteProviders: ["google", "xai"],
        }),
        expect.objectContaining({
          settingsId: routeOnlySettingsId,
          configuredKeyProviders: [],
          configuredRouteProviders: ["anthropic"],
        }),
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain("legacy-openai-secret");
    expect(JSON.stringify(audit)).not.toContain("legacy-fireworks-secret");

    await t.mutation(cleanupFn, {
      cursor: null,
      batchSize: 100,
      dryRun: false,
      oneBatchOnly: true,
    });
    await expect(
      t.run(async (ctx) => ctx.db.get(settingsId)),
    ).resolves.not.toHaveProperty("providerKeys");

    const verified = await t.query(auditFn, {
      paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(verified).toMatchObject({
      scanned: 2,
      legacyFieldRows: 0,
      configuredKeyRows: 0,
      configuredKeyProviders: [],
      configuredRouteProviders: ["anthropic", "google", "xai"],
      isDone: true,
      rows: [],
    });
  });
});
