import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 500;

const memoryTableValidator = v.literal("markdownDocuments");

export const clearTableBatch = internalMutation({
  args: { table: memoryTableValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("markdownDocuments")
      .withIndex("kind", (q) => q.eq("kind", "company_wiki"))
      .take(BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.memoryMaintenance.clearTableBatch,
        {
          table: args.table,
        },
      );
    }
    return {
      table: args.table,
      deleted: rows.length,
      requeued: rows.length === BATCH_SIZE,
    };
  },
});
