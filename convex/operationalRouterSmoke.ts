import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const OPERATIONAL_ROUTER_SMOKE_PREFIX = "spot-router-operational-smoke:";
export const OPERATIONAL_ROUTER_SMOKE_TTL_MS = 30 * 60 * 1000;

const MARKER_PATTERN =
  /^spot-router-operational-smoke:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fixtureName(marker: string): string {
  return `[Synthetic router acceptance] ${marker}`;
}

function fixtureContext(marker: string): string {
  return `Internal router acceptance fixture ${marker}`;
}

function assertMarker(marker: string): void {
  if (!MARKER_PATTERN.test(marker)) {
    throw new Error("Invalid operational router smoke marker");
  }
}

export const createFixture = internalMutation({
  args: { marker: v.string() },
  handler: async (ctx, args) => {
    assertMarker(args.marker);
    const createdAt = dayjs().valueOf();
    const expiresAt = createdAt + OPERATIONAL_ROUTER_SMOKE_TTL_MS;
    const orgId = await ctx.db.insert("organizations", {
      name: fixtureName(args.marker),
      context: fixtureContext(args.marker),
      type: "client",
    });
    const smokeRunId = await ctx.db.insert("operationalRouterSmokeRuns", {
      marker: args.marker,
      orgId,
      createdAt,
      expiresAt,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.actions.operationalRouterSmoke.cleanupExpired,
      { smokeRunId, attempt: 0 },
    );
    return { smokeRunId, orgId };
  },
});

export const cleanupFixture = internalMutation({
  args: { smokeRunId: v.id("operationalRouterSmokeRuns") },
  handler: async (ctx, args) => {
    const smokeRun = await ctx.db.get(args.smokeRunId);
    if (!smokeRun) {
      return {
        fixtureDeleted: true,
        routingEventCount: 0,
        durableAssetLedgerCount: 0,
      };
    }

    assertMarker(smokeRun.marker);
    const organization = await ctx.db.get(smokeRun.orgId);
    if (
      !organization ||
      organization.name !== fixtureName(smokeRun.marker) ||
      organization.context !== fixtureContext(smokeRun.marker) ||
      organization.type !== "client"
    ) {
      throw new Error("Operational router smoke fixture ownership mismatch");
    }

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (query) => query.eq("orgId", smokeRun.orgId))
      .take(1);
    if (memberships.length > 0) {
      throw new Error("Operational router smoke fixture acquired a membership");
    }

    let routingEventCount = 0;
    for (const suffix of ["tool", "pdf"] as const) {
      const runId = `${smokeRun.marker}:${suffix}`;
      const events = await ctx.db
        .query("modelRoutingEvents")
        .withIndex("run_time", (query) => query.eq("runId", runId))
        .take(20);
      for (const event of events) {
        if (event.orgId !== smokeRun.orgId) {
          throw new Error(
            "Operational router smoke routing-event ownership mismatch",
          );
        }
        await ctx.db.delete(event._id);
        routingEventCount += 1;
      }
    }

    const durableAssetLedgers = await ctx.db
      .query("routerAssets")
      .withIndex("organization", (query) => query.eq("orgId", smokeRun.orgId))
      .take(20);

    await ctx.db.delete(smokeRun.orgId);
    await ctx.db.delete(smokeRun._id);
    return {
      fixtureDeleted: true,
      routingEventCount,
      durableAssetLedgerCount: durableAssetLedgers.length,
    };
  },
});
