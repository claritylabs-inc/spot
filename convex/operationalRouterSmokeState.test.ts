/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const marker =
  "spot-router-operational-smoke:12345678-1234-4123-8123-123456789abc";

describe("operational router smoke fixture ownership", () => {
  test("creates no identity or channel state and cleans only its marker-owned fixture", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.mutation(
      internal.operationalRouterSmoke.createFixture,
      { marker },
    );

    const created = await t.run(async (ctx) => ({
      organization: await ctx.db.get(fixture.orgId),
      smokeRun: await ctx.db.get(fixture.smokeRunId),
      memberships: await ctx.db.query("orgMemberships").collect(),
      users: await ctx.db.query("users").collect(),
      channels: await ctx.db.query("agentChannelSettings").collect(),
    }));
    expect(created.organization).toMatchObject({
      type: "client",
      name: expect.stringContaining(marker),
      context: expect.stringContaining(marker),
    });
    expect(created.smokeRun).toMatchObject({ marker, orgId: fixture.orgId });
    expect(created.memberships).toEqual([]);
    expect(created.users).toEqual([]);
    expect(created.channels).toEqual([]);

    const cleanup = await t.mutation(
      internal.operationalRouterSmoke.cleanupFixture,
      { smokeRunId: fixture.smokeRunId },
    );
    expect(cleanup).toEqual({
      fixtureDeleted: true,
      routingEventCount: 0,
      durableAssetLedgerCount: 0,
    });
    expect(await t.run(async (ctx) => ctx.db.get(fixture.orgId))).toBeNull();
    await expect(
      t.mutation(internal.operationalRouterSmoke.cleanupFixture, {
        smokeRunId: fixture.smokeRunId,
      }),
    ).resolves.toEqual({
      fixtureDeleted: true,
      routingEventCount: 0,
      durableAssetLedgerCount: 0,
    });
  });

  test("refuses cleanup when the owned organization was changed or acquired a membership", async () => {
    const t = convexTest(schema, modules);
    const changed = await t.mutation(
      internal.operationalRouterSmoke.createFixture,
      { marker },
    );
    await t.run(async (ctx) =>
      ctx.db.patch(changed.orgId, { name: "Not a smoke fixture" }),
    );
    await expect(
      t.mutation(internal.operationalRouterSmoke.cleanupFixture, {
        smokeRunId: changed.smokeRunId,
      }),
    ).rejects.toThrow(/ownership mismatch/i);
    expect(
      await t.run(async (ctx) => ctx.db.get(changed.orgId)),
    ).not.toBeNull();

    const secondMarker =
      "spot-router-operational-smoke:abcdefab-cdef-4abc-8def-abcdefabcdef";
    const withMember = await t.mutation(
      internal.operationalRouterSmoke.createFixture,
      { marker: secondMarker },
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Unexpected member" }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", {
        orgId: withMember.orgId,
        userId,
        role: "member",
      }),
    );
    await expect(
      t.mutation(internal.operationalRouterSmoke.cleanupFixture, {
        smokeRunId: withMember.smokeRunId,
      }),
    ).rejects.toThrow(/acquired a membership/i);
    expect(
      await t.run(async (ctx) => ctx.db.get(withMember.orgId)),
    ).not.toBeNull();
  });
});
