import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { getMarkdownDocument } from "./markdownDocuments";
import { parseMarkdownDocument } from "./lib/markdownDocument";
import { saveHolderNotes, saveRequirementNotes, saveWorkflowNotes } from "./certificateNotes";

const targetValidator = v.union(
  v.literal("requirementSourceDocuments"),
  v.literal("certificateHolders"),
  v.literal("certificateWorkflowJobs"),
);
type Target = "requirementSourceDocuments" | "certificateHolders" | "certificateWorkflowJobs";
const pageArgs = { target: targetValidator, cursor: v.optional(v.union(v.string(), v.null())) };

async function preserveLegacyNote(
  ctx: MutationCtx,
  scope: Parameters<typeof getMarkdownDocument>[1],
  legacy: string,
) {
  const existing = await getMarkdownDocument(ctx, scope);
  if (!existing) return legacy;
  const body = parseMarkdownDocument(existing.markdown).body;
  if (!legacy.trim() || body.trim() === legacy.trim()) return body;
  return `${body.trimEnd()}\n\n## Imported legacy notes\n\n${legacy.trim()}`;
}

async function migrateSource(ctx: MutationCtx, source: Doc<"requirementSourceDocuments">) {
  if (source.internalNotes !== undefined) {
    const notes = await preserveLegacyNote(ctx, {
      orgId: source.orgId, kind: "requirement_notes", requirementSourceDocumentId: source._id,
    }, source.internalNotes);
    await saveRequirementNotes(ctx, source, notes, { migration: true });
    const holderIds = new Set([source.certificateHolderId, ...(source.certificateHolderIds ?? [])]);
    for (const holderId of holderIds) {
      if (!holderId) continue;
      const holder = await ctx.db.get(holderId);
      if (
        holder?.orgId === source.orgId && holder.notes?.trim() === source.internalNotes.trim() &&
        (holder.sourceRef === String(source._id) || holder.sourceRef === source.title)
      ) {
        await ctx.db.patch(holder._id, { notes: undefined });
      }
    }
  }
  if (source.certificateHolderId !== undefined) {
    const holderIds = Array.from(new Set([source.certificateHolderId, ...(source.certificateHolderIds ?? [])]));
    await ctx.db.patch(source._id, { certificateHolderIds: holderIds, certificateHolderId: undefined });
  }
}

async function migrateHolder(ctx: MutationCtx, holder: Doc<"certificateHolders">) {
  if (holder.notes === undefined) return;
  const notes = await preserveLegacyNote(ctx, {
    orgId: holder.orgId, kind: "holder_notes", certificateHolderId: holder._id,
  }, holder.notes);
  await saveHolderNotes(ctx, holder, notes, { migration: true });
}

async function migrateWorkflow(ctx: MutationCtx, job: Doc<"certificateWorkflowJobs">) {
  await saveWorkflowNotes(ctx, job, {
    reviewNotes: job.reviewNotes === undefined ? undefined : await preserveLegacyNote(ctx, {
      orgId: job.orgId, kind: "certificate_review_notes", certificateWorkflowJobId: job._id,
    }, job.reviewNotes),
    sendNotes: job.sendNotes === undefined ? undefined : await preserveLegacyNote(ctx, {
      orgId: job.orgId, kind: "certificate_delivery_notes", certificateWorkflowJobId: job._id,
    }, job.sendNotes),
  }, { migration: true });
}

function needsMigration(target: Target, row: Doc<Target>) {
  return target === "requirementSourceDocuments"
    ? "internalNotes" in row || "certificateHolderId" in row
    : target === "certificateHolders"
      ? "notes" in row
      : "reviewNotes" in row || "sendNotes" in row;
}

const migrations = new Migrations<DataModel>(components.migrations);
export const migrateRequirementSources = migrations.define({ table: "requirementSourceDocuments", batchSize: 1, migrateOne: migrateSource });
export const migrateHolders = migrations.define({ table: "certificateHolders", batchSize: 10, migrateOne: migrateHolder });
export const migrateWorkflowJobs = migrations.define({ table: "certificateWorkflowJobs", batchSize: 10, migrateOne: migrateWorkflow });

export const migratePage = internalMutation({
  args: { ...pageArgs, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.target).paginate({ cursor: args.cursor ?? null, numItems: args.target === "requirementSourceDocuments" ? 1 : 10 });
    let changed = 0;
    for (const row of result.page) {
      if (!needsMigration(args.target, row)) continue;
      changed += 1;
      if (args.dryRun !== false) continue;
      if (args.target === "requirementSourceDocuments") await migrateSource(ctx, row as Doc<"requirementSourceDocuments">);
      else if (args.target === "certificateHolders") await migrateHolder(ctx, row as Doc<"certificateHolders">);
      else await migrateWorkflow(ctx, row as Doc<"certificateWorkflowJobs">);
    }
    return { target: args.target, dryRun: args.dryRun !== false, scanned: result.page.length, changed, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const verifyPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.target).paginate({ cursor: args.cursor ?? null, numItems: 10 });
    return {
      target: args.target, scanned: result.page.length,
      remaining: result.page.filter((row) => needsMigration(args.target, row)).length,
      isDone: result.isDone, continueCursor: result.continueCursor,
    };
  },
});
