import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";

/**
 * One-off cleanup for the removed certificate workflow jobs feature: the
 * `certificateWorkflowJobs` table and any `markdownDocuments` rows scoped to a
 * job. Once `status` reports both empty, remove the table, the
 * `certificateWorkflowJobId` field and `workflow_kind` index from the schema,
 * and then delete this file.
 *
 *   npx convex run deprecatedTableCleanup:status
 *   npx convex run deprecatedTableCleanup:purge
 *   npx convex run deprecatedTableCleanup:status
 *
 * Add `--prod` (or `--deployment-name <name>`) to target a cloud deployment.
 */
const BATCH_SIZE = 100;

/** The index sorts rows without a job id first, so the last row has one if any do. */
function newestJobDocuments(ctx: QueryCtx, limit: number) {
  return ctx.db
    .query("markdownDocuments")
    .withIndex("workflow_kind")
    .order("desc")
    .take(limit);
}

export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const job = await ctx.db.query("certificateWorkflowJobs").first();
    const [document] = await newestJobDocuments(ctx, 1);
    return {
      certificateWorkflowJobs: job ? "has rows" : "empty",
      markdownDocumentsWithJobId: document?.certificateWorkflowJobId
        ? "has rows"
        : "empty",
    };
  },
});

/** Deletes one batch of each and reschedules itself until both are empty. */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db.query("certificateWorkflowJobs").take(BATCH_SIZE);
    for (const job of jobs) await ctx.db.delete(job._id);

    const documents = (await newestJobDocuments(ctx, BATCH_SIZE)).filter(
      (document) => document.certificateWorkflowJobId,
    );
    for (const document of documents) await ctx.db.delete(document._id);

    const more = jobs.length === BATCH_SIZE || documents.length === BATCH_SIZE;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.deprecatedTableCleanup.purge, {});
    }
    return {
      deletedJobs: jobs.length,
      deletedDocuments: documents.length,
      done: !more,
    };
  },
});
