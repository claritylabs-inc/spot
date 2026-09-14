import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertGoogleWorkspaceScanSourceLease } from "./lib/googleWorkspaceScanState";
import {
  scanOperationSchema,
  sourceEffectiveAt,
  assertUnchangedSnapshot,
  ScanAttention,
} from "./lib/googleWorkspaceReconciliation";
import { resolveScanTarget, writeScanDomain } from "./lib/workspaceScanDomain";
import {
  writeOperatorAudit,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  commitValidatedOperatorPolicyImport,
  type OperatorPolicySource,
} from "./operatorPolicyImports";
import { normalizeClientFileSha256 } from "./lib/clientFiles";

const leaseArgs = {
  sourceId: v.id("operatorGoogleWorkspaceScanSources"),
  leaseToken: v.string(),
};
async function sourceBody(
  ctx: QueryCtx | MutationCtx,
  source: Doc<"operatorGoogleWorkspaceScanSources">,
) {
  const parts = await ctx.db
    .query("operatorGoogleWorkspaceScanSourceParts")
    .withIndex("source_ordinal", (q) => q.eq("sourceId", source._id))
    .take(33);
  if (
    !source.evidence?.bodyComplete ||
    parts.length !== source.evidence.bodyPartCount ||
    parts.length > 32
  )
    throw new ScanAttention(
      "Complete source body is not available for reconciliation",
    );
  const body = parts.map((p) => p.text).join("");
  if (body.length > 160_000)
    throw new ScanAttention(
      "Source exceeds the bounded analysis size; review the full thread",
    );
  return body;
}
export async function scanOperationKey(operationJson: string) {
  const {
    excerpt: _excerpt,
    explanation: _explanation,
    ...operation
  } = scanOperationSchema.parse(JSON.parse(operationJson));
  return actionConfirmationFingerprint({
    toolName: "workspace_scan_operation",
    toolVersion: 1,
    input: operation,
  });
}
async function selectionFor(ctx: QueryCtx | MutationCtx, operationKey: string) {
  const finding = await ctx.db
    .query("operatorWorkspaceScanFindings")
    .withIndex("operation", (q) => q.eq("operationKey", operationKey))
    .first();
  if (finding?.selectedByUserId)
    await requireOperatorForUser(ctx, finding.selectedByUserId);
  return {
    finding,
    selection: {
      selectedOrgId: finding?.selectedOrgId,
      selectedRequestId: finding?.selectedRequestId,
    },
  };
}
export const prepareInternal = internalQuery({
  args: { ...leaseArgs, operationJson: v.string() },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    const key = await scanOperationKey(args.operationJson);
    const { selection } = await selectionFor(ctx, key);
    const target = await resolveScanTarget(ctx, operation, selection);
    const body = await sourceBody(ctx, source);
    sourceEffectiveAt(operation, source.evidence!, body);
    return {
      snapshot: JSON.stringify(target),
      targetOrgId: target.org?._id ?? null,
    };
  },
});
export const getEvidenceInternal = internalQuery({
  args: leaseArgs,
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    return { source, body: await sourceBody(ctx, source) };
  },
});
export const recordFindingInternal = internalMutation({
  args: {
    ...leaseArgs,
    operationJson: v.optional(v.string()),
    status: v.union(v.literal("needs_attention"), v.literal("failed")),
    explanation: v.string(),
    excerpt: v.string(),
  },
  handler: async (ctx, args) => {
    const { source, operatorUserId } =
      await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const key = args.operationJson
      ? await scanOperationKey(args.operationJson)
      : `${source._id}:${args.status}:${args.explanation.slice(0, 150)}`;
    const previous = await ctx.db
      .query("operatorWorkspaceScanFindings")
      .withIndex("operation", (q) => q.eq("operationKey", key))
      .first();
    if (previous?.status === "updated") return previous._id;
    const values = {
      sourceId: source._id,
      status: args.status,
      title: args.operationJson
        ? scanOperationSchema
            .parse(JSON.parse(args.operationJson))
            .kind.replaceAll("_", " ")
        : "Mail review",
      explanation: args.explanation.slice(0, 2000),
      excerpt: args.excerpt.slice(0, 4000),
      operationJson: args.operationJson,
      operationKey: key,
      createdAt: dayjs().valueOf(),
      recordLinks: [],
      authorizingOperatorId: operatorUserId,
    };
    if (previous) {
      await ctx.db.patch(previous._id, values);
      return previous._id;
    }
    return ctx.db.insert("operatorWorkspaceScanFindings", values);
  },
});
export const applyInternal = internalMutation({
  args: {
    ...leaseArgs,
    operationJson: v.string(),
    snapshot: v.string(),
    importId: v.optional(v.id("operatorWorkspaceScanImports")),
  },
  handler: async (ctx, args) => {
    const { source, operatorUserId } =
      await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const operation = scanOperationSchema.parse(JSON.parse(args.operationJson));
    const key = await scanOperationKey(args.operationJson);
    const { finding, selection } = await selectionFor(ctx, key);
    if (finding?.status === "updated")
      return { status: "duplicate" as const, findingId: finding._id };
    const body = await sourceBody(ctx, source);
    const effectiveAt = sourceEffectiveAt(operation, source.evidence!, body);
    const target = await resolveScanTarget(ctx, operation, selection);
    assertUnchangedSnapshot(target, args.snapshot);
    let result;
    if (operation.kind === "import_policy") {
      const staged = args.importId ? await ctx.db.get(args.importId) : null;
      if (
        !staged ||
        staged.sourceId !== source._id ||
        staged.attachmentId !== operation.attachmentId ||
        !staged.boundPolicy ||
        !target.org ||
        staged.clientOrgId !== target.org._id
      )
        throw new ScanAttention(
          "Validated bound-policy attachment does not match the source and client",
        );
      const imported = await commitValidatedOperatorPolicyImport(ctx, {
        operatorUserId,
        orgId: target.org._id,
        mode: "separate",
        files: [staged.file],
      });
      result = {
        table: "policies" as const,
        id: imported[0].policyId,
        created: imported[0].status === "queued",
        noChange: imported[0].status === "duplicate",
      };
      await ctx.db.patch(staged._id, { policyId: result.id });
    } else
      result = await writeScanDomain(ctx, {
        operation,
        target,
        operatorUserId,
        effectiveAt,
      });
    const record = await ctx.db.get(result.id);
    if (!record)
      throw new Error("Reconciliation write did not produce a record");
    const orgId =
      target.org?._id ?? (result.table === "organizations" ? result.id : null);
    const href =
      result.table === "procurementRequests"
        ? `/operator/clients/${orgId}/procurement/${result.id}`
        : result.table === "policies"
          ? `/operator/clients/${orgId}/policies/${result.id}`
          : target.request
            ? `/operator/clients/${orgId}/procurement/${target.request._id}`
            : operation.identity.kind === "broker"
              ? `/operator/brokers?brokerId=${encodeURIComponent(String(orgId))}`
              : `/operator/clients/${orgId}`;
    const values = {
      sourceId: source._id,
      operationKey: key,
      status: "updated" as const,
      title: operation.kind.replaceAll("_", " "),
      explanation: result.noChange
        ? "Existing record reused; no duplicate created."
        : operation.explanation,
      excerpt: operation.excerpt,
      operationJson: args.operationJson,
      entityId: String(orgId ?? result.id),
      recordId: String(result.id),
      requestId:
        result.table === "procurementRequests"
          ? (ctx.db.normalizeId("procurementRequests", result.id) ?? undefined)
          : target.request?._id,
      recordLinks: [{ label: operation.identity.name, href }],
      createdAt: dayjs().valueOf(),
      authorizingOperatorId: operatorUserId,
      resolvedAt: undefined,
      resolution: undefined,
    };
    const findingId = finding
      ? finding._id
      : await ctx.db.insert("operatorWorkspaceScanFindings", values);
    if (finding) await ctx.db.patch(findingId, values);
    if (!result.noChange) {
      const before = result.created ? null : target.record;
      const beforeValue: Record<string, unknown> = before ?? {};
      const fields = Object.entries(record)
        .filter(
          ([field, value]) =>
            !field.startsWith("_") &&
            ![
              "createdAt",
              "updatedAt",
              "updatedByUserId",
              "sourceRefs",
              "manuallyEditedAt",
            ].includes(field) &&
            JSON.stringify(beforeValue[field]) !== JSON.stringify(value),
        )
        .map(([field]) => field);
      await ctx.db.insert("operatorWorkspaceScanChanges", {
        findingId,
        entityId: result.id,
        table: result.table,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(record),
        fields,
        created: result.created,
        effectiveAt,
        appliedAt: dayjs().valueOf(),
      });
      await writeOperatorAudit(ctx, {
        operatorUserId,
        type: "setup_write",
        targetOrgId:
          target.org?._id ??
          (result.table === "organizations"
            ? (result.id as Id<"organizations">)
            : undefined),
        summary: `Workspace scan: ${operation.kind.replaceAll("_", " ")}`,
        metadata: {
          source: "workspace_scan",
          sourceId: source._id,
          findingId,
          entityId: result.id,
        },
      });
    }
    return { status: "updated" as const, findingId };
  },
});

export const getStagedImportInternal = internalQuery({
  args: { ...leaseArgs, attachmentId: v.string() },
  handler: async (ctx, args) => {
    await assertGoogleWorkspaceScanSourceLease(ctx, args);
    return ctx.db
      .query("operatorWorkspaceScanImports")
      .withIndex("attachment", (q) =>
        q.eq("sourceId", args.sourceId).eq("attachmentId", args.attachmentId),
      )
      .unique();
  },
});
export const stageImportInternal = internalMutation({
  args: {
    ...leaseArgs,
    attachmentId: v.string(),
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    boundPolicy: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const attachment = source.evidence?.attachments.find(
      (a) => a.attachmentId === args.attachmentId,
    );
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (
      !attachment ||
      !metadata ||
      !attachment.filename.toLowerCase().endsWith(".pdf") ||
      metadata.size !== attachment.size ||
      metadata.size > 15 * 1024 * 1024
    )
      throw new ScanAttention(
        "Original policy attachment is unavailable or changed",
      );
    const existing = await ctx.db
      .query("operatorWorkspaceScanImports")
      .withIndex("attachment", (q) =>
        q.eq("sourceId", args.sourceId).eq("attachmentId", args.attachmentId),
      )
      .unique();
    if (existing) return existing._id;
    const file: OperatorPolicySource = {
      fileId: args.fileId,
      fileName: attachment.filename,
      fileSha256: normalizeClientFileSha256(metadata.sha256),
      size: metadata.size,
    };
    return ctx.db.insert("operatorWorkspaceScanImports", {
      sourceId: source._id,
      attachmentId: args.attachmentId,
      clientOrgId: args.clientOrgId,
      file,
      boundPolicy: args.boundPolicy,
      createdAt: dayjs().valueOf(),
    });
  },
});
