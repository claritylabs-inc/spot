import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const retiredTable = v.union(
  v.literal("procurementPacketUpdateRuns"),
  v.literal("orgMemory"),
  v.literal("procurementMemory"),
  v.literal("brokerClientAssignments"),
  v.literal("policyDeliverySettings"),
  v.literal("policyDeliveryRules"),
  v.literal("policyDeliveryJobs"),
  v.literal("policyDeliveryAttempts"),
);
const auditTable = v.union(
  v.literal("organizations"),
  v.literal("policies"),
  v.literal("procurementBrokerOutreaches"),
);

export const ownershipAuditPage = internalQuery({
  args: { table: auditTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    const blockers = page.page.filter((row) => {
      if (args.table === "organizations")
        return "type" in row && row.type === "client" && "brokerOrgId" in row;
      if (args.table === "policies")
        return (
          ("uploadedBySide" in row && row.uploadedBySide === "broker") ||
          "uploadedByBrokerOrgId" in row
        );
      return !("brokerOrgId" in row);
    }).length;
    return {
      checked: page.page.length,
      blockers,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const audit = internalQuery({
  args: { table: retiredTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      count: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** Fixed retired domains only. Run after the complete ownership audit and backup. */
export const purgeBatch = internalMutation({
  args: { table: retiredTable },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: null,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    for (const row of page.page) await ctx.db.delete(row._id);
    return { deleted: page.page.length, complete: page.isDone };
  },
});

export const clearCompatibilityPage = internalMutation({
  args: {
    table: v.union(
      v.literal("brokerModelSettings"),
      v.literal("companyInformationExtractions"),
      v.literal("connectedEmailAutomationItems"),
      v.literal("pendingEmails"),
      v.literal("globalModelSettings"),
    ),
    cursor: v.union(v.string(), v.null()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    let changed = 0;
    for (const row of page.page) {
      const patch: Record<string, unknown> = {};
      for (const field of [
        "providerKeys",
        "procurementFacts",
        "memoryIds",
        "allowMultipleCoiAttachments",
      ]) {
        if (field in row) patch[field] = undefined;
      }
      if (
        "organizationFacts" in row &&
        row.organizationFacts?.some((fact) => !fact.section)
      ) {
        patch.organizationFacts = row.organizationFacts.map((fact) => ({
          ...fact,
          section: fact.section ?? "profile",
        }));
      }
      if (
        args.table === "globalModelSettings" &&
        "routes" in row &&
        row.routes &&
        "extraction_visual_table_repair" in row.routes
      ) {
        const { extraction_visual_table_repair: retired, ...routes } =
          row.routes;
        void retired;
        patch.routes = routes;
      }
      if (
        args.table === "globalModelSettings" &&
        "explicitRouteOverrides" in row &&
        row.explicitRouteOverrides?.includes("extraction_visual_table_repair")
      ) {
        patch.explicitRouteOverrides = row.explicitRouteOverrides.filter(
          (task) => task !== "extraction_visual_table_repair",
        );
      }
      if (!Object.keys(patch).length) continue;
      changed++;
      if (args.dryRun === false) await ctx.db.patch(row._id, patch);
    }
    return {
      checked: page.page.length,
      changed,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const inventoryPolicyHistoryPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("policyUpdateRuns").paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      count: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});
