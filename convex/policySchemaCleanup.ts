import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const targetValidator = v.union(
  v.literal("certificateWorkflowSettings"),
  v.literal("policies"),
  v.literal("policyFiles"),
  v.literal("sourceChunks"),
);

const pageArgs = {
  target: targetValidator,
  cursor: v.optional(v.union(v.string(), v.null())),
  limit: v.optional(v.number()),
};

type CleanupTarget =
  | "certificateWorkflowSettings"
  | "policies"
  | "policyFiles"
  | "sourceChunks";

const retiredFields = {
  certificateWorkflowSettings: [
    "brokerOrgId",
    "populateHoldersFromEndorsements",
    "renewalReissueMode",
    "renewalReviewLeadDays",
    "policyChangeRequestsForHeldCertificatesEnabled",
    "channels",
    "copyInstructions",
  ],
  policies: ["reconciliationStatus", "reconciliationLog", "analysis"],
  policyFiles: ["extractedData"],
  sourceChunks: [],
} as const;

function pageSize(limit: number | undefined) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 10)) {
    throw new Error("Cleanup page size must be an integer from 1 to 10.");
  }
  return limit ?? 10;
}

function cleanupChange(target: CleanupTarget, row: Doc<CleanupTarget>) {
  if (
    target === "sourceChunks" ||
    (target === "certificateWorkflowSettings" && !("clientOrgId" in row))
  ) {
    return { remove: true, fields: [] };
  }
  return {
    remove: false,
    fields: retiredFields[target].filter((field) => field in row),
  };
}

async function applyCleanup(ctx: MutationCtx, target: CleanupTarget, row: Doc<CleanupTarget>) {
  const change = cleanupChange(target, row);
  if (change.remove) {
    await ctx.db.delete(row._id);
  } else if (change.fields.length > 0) {
    await ctx.db.patch(
      row._id,
      Object.fromEntries(change.fields.map((field) => [field, undefined])),
    );
  }
}

const migrations = new Migrations<DataModel>(components.migrations);

export const cleanupCertificateSettings = migrations.define({
  table: "certificateWorkflowSettings",
  batchSize: 10,
  migrateOne: (ctx, row) => applyCleanup(ctx, "certificateWorkflowSettings", row),
});

export const cleanupPolicies = migrations.define({
  table: "policies",
  batchSize: 10,
  migrateOne: (ctx, row) => applyCleanup(ctx, "policies", row),
});

export const cleanupPolicyFiles = migrations.define({
  table: "policyFiles",
  batchSize: 10,
  migrateOne: (ctx, row) => applyCleanup(ctx, "policyFiles", row),
});

export const purgeSourceChunks = migrations.define({
  table: "sourceChunks",
  batchSize: 10,
  migrateOne: (ctx, row) => applyCleanup(ctx, "sourceChunks", row),
});

export const cleanupPage = internalMutation({
  args: { ...pageArgs, dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false;
    const result = await ctx.db.query(args.target).paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    let changed = 0;
    let removed = 0;
    for (const row of result.page) {
      const change = cleanupChange(args.target, row);
      if (!change.remove && change.fields.length === 0) continue;
      changed += 1;
      if (change.remove) {
        removed += 1;
      }
      if (!dryRun) await applyCleanup(ctx, args.target, row);
    }
    return {
      target: args.target,
      dryRun,
      scanned: result.page.length,
      changed,
      removed,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const verifyPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) => {
    const result = await ctx.db.query(args.target).paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize(args.limit),
    });
    const remainingIds = result.page
      .filter((row) => {
        const change = cleanupChange(args.target, row);
        return change.remove || change.fields.length > 0;
      })
      .map((row) => row._id);
    return {
      target: args.target,
      scanned: result.page.length,
      remaining: remainingIds.length,
      remainingIds,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
