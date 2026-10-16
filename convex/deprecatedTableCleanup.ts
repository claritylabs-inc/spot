import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * One-off cleanup for tables whose features were removed. Once `status`
 * reports every table empty, delete the table definitions from the schema and
 * then delete this file.
 *
 *   npx convex run deprecatedTableCleanup:status
 *   npx convex run deprecatedTableCleanup:purgeAll
 *   npx convex run deprecatedTableCleanup:status
 *
 * Add `--prod` (or `--deployment-name <name>`) to target a cloud deployment.
 */
const DEPRECATED_TABLES = [
  "extractionReviews",
  "policyExtractionQueue",
  "policyExtractionPreviewQueue",
  "operatorGoogleWorkspaceScanConfig",
  "operatorGoogleWorkspaceScanRuns",
  "operatorGoogleWorkspaceScanMailboxes",
  "operatorGoogleWorkspaceScanSources",
  "operatorGoogleWorkspaceScanSourceParts",
  "operatorWorkspaceScanFindingSources",
  "operatorWorkspaceScanInventories",
  "operatorWorkspaceScanContexts",
  "operatorWorkspaceScanImports",
  "operatorWorkspaceScanFindings",
  "operatorWorkspaceScanChanges",
  "operatorWorkspaceScanIdentities",
] as const;

const BATCH_SIZE = 100;

/** Reports whether each deprecated table still has rows. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const result: Record<string, "empty" | "has rows"> = {};
    for (const table of DEPRECATED_TABLES) {
      const row = await ctx.db.query(table).first();
      result[table] = row ? "has rows" : "empty";
    }
    return result;
  },
});

/** Deletes one batch from a table and reschedules itself until it is empty. */
export const purge = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const table = DEPRECATED_TABLES.find((name) => name === args.table);
    if (!table) throw new Error(`${args.table} is not a deprecated table`);
    const rows = await ctx.db.query(table).take(BATCH_SIZE);
    for (const row of rows) {
      if (table === "operatorWorkspaceScanImports") {
        const { file } = row as { file?: { fileId: Parameters<typeof ctx.storage.delete>[0] } };
        if (file?.fileId) await ctx.storage.delete(file.fileId);
      }
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.deprecatedTableCleanup.purge, {
        table,
      });
    }
    return { table, deleted: rows.length, done: rows.length < BATCH_SIZE };
  },
});

/** Starts a purge for every deprecated table. */
export const purgeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of DEPRECATED_TABLES) {
      await ctx.scheduler.runAfter(0, internal.deprecatedTableCleanup.purge, {
        table,
      });
    }
    return { scheduled: DEPRECATED_TABLES.length };
  },
});
