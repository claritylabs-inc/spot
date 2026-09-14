import { v } from "convex/values";
import type { Doc, TableNames } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";
import { pendingEmailCanonicalPatch } from "./lib/emailPayloadFields";
import { slackAttachments } from "./lib/slackAttachments";

export function retiredOrganizationSettings(org: Doc<"organizations">) {
  const fields = ["coiHandling", "autoGenerateCoi", "autoSendEmails", "policyChangeRequestsEnabled", "certificateChangeRequestsEnabled"] as const;
  if (!fields.some((field) => org[field] !== undefined)) return null;
  return {
    coiHandling: undefined,
    autoGenerateCoi: undefined,
    autoSendEmails: undefined,
    policyChangeRequestsEnabled: undefined,
    certificateChangeRequestsEnabled: undefined,
  };
}

export function retiredPolicyChangeReference(row: { policyChangeCaseId?: unknown }) {
  return row.policyChangeCaseId === undefined ? null : { policyChangeCaseId: undefined };
}

export function retiredNotificationExpiry(row: Doc<"notifications">) {
  return row.expiresAt === undefined ? null : { expiresAt: undefined };
}

export function retiredModelRoute(row: Doc<"globalModelSettings">) {
  if (!row.routes?.extraction_visual_table_repair) return null;
  const routes = { ...row.routes };
  delete routes.extraction_visual_table_repair;
  return { routes };
}

export function canonicalSlackAttachments(row: Doc<"slackInboundEvents">) {
  if (row.attachment === undefined && row.spectrumMessageId === undefined && row.mentionsGlass === undefined && row.mentionsSpot !== undefined) return null;
  return {
    ...(row.attachment === undefined ? {} : { attachments: slackAttachments(row) }),
    attachment: undefined,
    spectrumMessageId: undefined,
    mentionsSpot: row.mentionsSpot ?? row.mentionsGlass ?? false,
    mentionsGlass: undefined,
  };
}

export function canonicalSlackActor(row: Doc<"slackActors">) {
  if (row.classification !== "glass_operator" && row.glassUserId === undefined) return null;
  return {
    classification: row.classification === "glass_operator" ? "spot_operator" as const : row.classification,
    spotUserId: row.spotUserId ?? row.glassUserId,
    glassUserId: undefined,
  };
}

export async function canonicalPendingEmail(row: Doc<"pendingEmails">) {
  const patch = pendingEmailCanonicalPatch(row);
  if (patch && await pendingEmailDraftFingerprint(row) !== await pendingEmailDraftFingerprint({ ...row, ...patch })) {
    throw new Error("Draft confirmation content would change during migration.");
  }
  const reference = retiredPolicyChangeReference(row);
  return patch || reference ? { ...patch, ...reference } : null;
}

type Inspection = { cursor: string | null };

async function inspectPage<Table extends TableNames>(
  ctx: QueryCtx,
  args: Inspection,
  table: Table,
  patch: (row: Doc<Table>) => object | null | Promise<object | null>,
) {
  const page = await ctx.db.query(table).paginate({ cursor: args.cursor, numItems: 50, maximumBytesRead: 2 * 1024 * 1024 });
  let changes = 0;
  let blockers = 0;
  for (const row of page.page) {
    try {
      if (await patch(row)) changes++;
    } catch {
      blockers++;
    }
  }
  return { table, spotEnv: process.env.SPOT_ENV, scanned: page.page.length, changes, blockers, isDone: page.isDone, cursor: page.continueCursor };
}

// Fixed tables only. The release runner receives counts, never stored content.
export const audit = internalQuery({
  args: {
    table: v.union(
      v.literal("organizations"), v.literal("pendingEmails"),
      v.literal("slackInboundEvents"), v.literal("slackActors"), v.literal("notifications"),
      v.literal("threadMessages"), v.literal("certificateRequestHolds"),
      v.literal("appCardAccessLinks"), v.literal("globalModelSettings"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    switch (args.table) {
      case "organizations": return inspectPage(ctx, args, args.table, retiredOrganizationSettings);
      case "pendingEmails": return inspectPage(ctx, args, args.table, canonicalPendingEmail);
      case "slackInboundEvents": return inspectPage(ctx, args, args.table, canonicalSlackAttachments);
      case "slackActors": return inspectPage(ctx, args, args.table, canonicalSlackActor);
      case "notifications": return inspectPage(ctx, args, args.table, retiredNotificationExpiry);
      case "threadMessages": return inspectPage(ctx, args, args.table, retiredPolicyChangeReference);
      case "certificateRequestHolds": return inspectPage(ctx, args, args.table, retiredPolicyChangeReference);
      case "appCardAccessLinks": return inspectPage(ctx, args, args.table, retiredPolicyChangeReference);
      case "globalModelSettings": return inspectPage(ctx, args, args.table, retiredModelRoute);
    }
  },
});
