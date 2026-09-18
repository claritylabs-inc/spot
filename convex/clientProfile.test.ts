/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { preflightOperatorToolConfirmation } from "./lib/operatorAgentConfirmationPreflight";

const modules = import.meta.glob("./**/*.ts");

test("identity edits validate names and research requires a client", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      accountKind: "operator",
    });
    const threadId = ctx.db.normalizeId(
      "operatorAgentThreads",
      "10001;operatorAgentThreads",
    )!;
    const orgId = await ctx.db.insert("organizations", {
      name: "Harbor",
      type: "client",
    });
    const brokerId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    const preflight = (
      toolName:
        | "update_organization_profile"
        | "research_client"
        | "research_broker",
      input: Record<string, unknown>,
    ) =>
      preflightOperatorToolConfirmation(ctx, {
        operatorUserId,
        threadId,
        toolName,
        input,
      });
    await expect(
      preflight("update_organization_profile", { orgId, name: " " }),
    ).rejects.toThrow("cannot be blank");
    await expect(
      preflight("update_organization_profile", {
        orgId,
        website: "https://harbor.example",
      }),
    ).resolves.toBeUndefined();
    await expect(preflight("research_broker", { orgId })).rejects.toThrow(
      "Broker organization",
    );
    await expect(
      preflight("research_broker", { orgId: brokerId }),
    ).resolves.toBeUndefined();
    const ownedBrokerId = await ctx.db.insert("organizations", {
      name: "Spot",
      type: "broker",
      website: "https://spot.insure",
    });
    await expect(
      preflight("research_broker", { orgId: ownedBrokerId }),
    ).rejects.toThrow("Spot-owned");
    await expect(
      preflight("research_client", { orgId: brokerId }),
    ).rejects.toThrow("Client organization");
  });
});
