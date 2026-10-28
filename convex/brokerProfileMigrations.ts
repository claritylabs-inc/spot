import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

const migrations = new Migrations<DataModel>(components.migrations);

/** New providers that already received an outreach email become inactive relationships. */
export const markContactedProspectsInactive = migrations.define({
  table: "brokerProfiles",
  customRange: (query) =>
    query.withIndex("status", (q) => q.eq("networkStatus", "prospect")),
  migrateOne: async (ctx, profile) => {
    const sent = await ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("broker_sent", (q) =>
        q.eq("brokerOrgId", profile.brokerOrgId).gt("sentAt", 0),
      )
      .first();
    // updatedAt is left alone so in-flight company research still applies.
    if (sent) return { networkStatus: "inactive" as const };
  },
});

export const run = migrations.runner();
