import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 500;
const internalApi = internal as any;

export const memoryTableValidator = v.union(
  v.literal("orgWikiSections"),
  v.literal("markdownDocuments"),
  v.literal("conversationTurns"),
);

export const clearTableBatch = internalMutation({
  args: { table: memoryTableValidator },
  handler: async (ctx, args) => {
    // Previously scheduled memory clears may still refer to the retired store.
    if (args.table === "conversationTurns") {
      return { table: args.table, deleted: 0, requeued: false };
    }
    const rows = args.table === "markdownDocuments"
      ? await ctx.db.query("markdownDocuments").withIndex("kind", (q) => q.eq("kind", "company_wiki")).take(BATCH_SIZE)
      : await ctx.db.query(args.table).take(BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internalApi.memoryMaintenance.clearTableBatch, {
        table: args.table,
      });
    }
    return {
      table: args.table,
      deleted: rows.length,
      requeued: rows.length === BATCH_SIZE,
    };
  },
});
