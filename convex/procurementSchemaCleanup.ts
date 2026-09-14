import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const cleanupTable = v.union(
  v.literal("procurementBrokerOutreaches"),
  v.literal("procurementRequests"),
  v.literal("procurementProposalReviews"),
);

const legacyTable = v.union(
  v.literal("procurementRequirementDrafts"),
  v.literal("procurementRequestRequirements"),
  v.literal("procurementSpecifications"),
  v.literal("procurementRequestActivities"),
  v.literal("procurementRequestDocuments"),
  v.literal("clientInvitations"),
  v.literal("brokerActivity"),
);

const pageArgs = {
  table: cleanupTable,
  cursor: v.union(v.string(), v.null()),
};

function retiredFields(row: object): Record<string, undefined> {
  const patch: Record<string, undefined> = {};
  for (const field of [
    "contactSnapshot",
    "packetSnapshot",
    "requirementRevision",
    "specificationRevision",
  ]) {
    if (field in row) patch[field] = undefined;
  }
  return patch;
}

// Deploy-key-only, bounded pages. The caller must accumulate every page;
// an empty final page alone does not establish that a table is clean.
export const auditPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    const changes = page.page.flatMap((row) => {
      const fields = Object.keys(retiredFields(row));
      return fields.length ? [{ id: row._id, fields }] : [];
    });
    const unboundReviews =
      args.table === "procurementProposalReviews"
        ? page.page.filter((row) => !("packetRevision" in row)).length
        : 0;
    return {
      scanned: page.page.length,
      changed: changes.length,
      changes,
      unboundReviews,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const migratePage = internalMutation({
  args: pageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    let changed = 0;
    for (const row of page.page) {
      if (
        args.table === "procurementProposalReviews" &&
        !("packetRevision" in row)
      ) {
        await ctx.db.delete(row._id);
        changed += 1;
        continue;
      }
      const patch = retiredFields(row);
      if (!Object.keys(patch).length) continue;
      await ctx.db.patch(row._id, patch);
      changed += 1;
    }
    return {
      scanned: page.page.length,
      changed,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

// These stores can contain business evidence. Inventory them without purging
// or silently promoting draft requirements into confirmed obligations.
export const inventoryLegacyPage = internalQuery({
  args: { table: legacyTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      count: page.page.length,
      ids: page.page.map((row) => row._id),
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});
