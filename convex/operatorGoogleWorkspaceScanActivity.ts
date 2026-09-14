import dayjs from "dayjs";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  query,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOperator, writeOperatorAudit } from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { scanActivityStatus } from "./lib/scanReconciliationSchema";
import { retryGoogleWorkspaceScanSource } from "./lib/googleWorkspaceScanState";
import { scanOperationSchema } from "./lib/googleWorkspaceReconciliation";
import type {
  GoogleWorkspaceScanActivity,
  GoogleWorkspaceScanActivityActionResult,
} from "./lib/googleWorkspaceScan";

type Ctx = QueryCtx | MutationCtx;
async function requireFinding(ctx: Ctx, activityId: string) {
  const id = ctx.db.normalizeId("operatorWorkspaceScanFindings", activityId);
  const finding = id ? await ctx.db.get(id) : null;
  if (!finding) throw new Error("Scan activity not found");
  return finding;
}
async function activityDto(
  ctx: Ctx,
  finding: Doc<"operatorWorkspaceScanFindings">,
  detail = false,
): Promise<GoogleWorkspaceScanActivity> {
  const source = await ctx.db.get(finding.sourceId);
  const evidence = source?.evidence;
  const changes = await ctx.db
    .query("operatorWorkspaceScanChanges")
    .withIndex("finding", (q) => q.eq("findingId", finding._id))
    .take(30);
  let importState: GoogleWorkspaceScanActivity["importState"];
  const imported = changes.find((change) => change.table === "policies");
  if (imported) {
    const id = ctx.db.normalizeId("policies", imported.entityId);
    const policy = id ? await ctx.db.get(id) : null;
    importState =
      policy?.pipelineStatus === "complete"
        ? "complete"
        : policy?.pipelineStatus === "error"
          ? "error"
          : policy?.pipelineStatus === "idle"
            ? "queued"
            : "extracting";
  }
  const availableActions: GoogleWorkspaceScanActivity["availableActions"] =
    finding.resolvedAt
      ? []
      : finding.status === "updated"
        ? changes.length && changes.every((c) => !c.created && !c.correctedAt)
          ? ["correct"]
          : []
        : ["resolve", "dismiss", "retry"];
  const dto: GoogleWorkspaceScanActivity = {
    id: finding._id,
    status: finding.status,
    title: finding.title,
    explanation: finding.explanation,
    createdAt: finding.createdAt,
    resolvedAt: finding.resolvedAt ?? null,
    records: finding.recordLinks,
    changes: changes.flatMap((change) => {
      const before = JSON.parse(change.beforeJson) ?? {};
      const after = JSON.parse(change.afterJson) ?? {};
      return change.fields.map((field) => ({
        field,
        before:
          before[field] === undefined ? null : JSON.stringify(before[field]),
        after: after[field] === undefined ? null : JSON.stringify(after[field]),
      }));
    }),
    sources: evidence
      ? [
          {
            sourceId: finding.sourceId,
            mailbox: evidence.mailbox,
            messageId: evidence.messageId,
            threadId: evidence.threadId,
            subject: evidence.subject,
            sentAt: evidence.sentAt,
            excerpt: finding.excerpt,
            href: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(evidence.mailbox)}#all/${encodeURIComponent(evidence.threadId)}`,
          },
        ]
      : [],
    availableActions,
    importState,
  };
  if (detail && finding.operationJson && finding.status !== "updated") {
    const operation = scanOperationSchema.parse(
      JSON.parse(finding.operationJson),
    );
    const orgs = await ctx.db
      .query("organizations")
      .withIndex("type", (q) => q.eq("type", operation.identity.kind))
      .take(100);
    const orgId =
      finding.selectedOrgId ?? (orgs.length === 1 ? orgs[0]._id : undefined);
    const requests = orgId
      ? await ctx.db
          .query("procurementRequests")
          .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
          .take(100)
      : [];
    dto.candidates = {
      organizations: orgs.map((org) => ({ id: org._id, label: org.name })),
      requests: requests.map((request) => ({
        id: request._id,
        label: request.title,
      })),
    };
  }
  return dto;
}
export const listActivity = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(scanActivityStatus),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const base = ctx.db.query("operatorWorkspaceScanFindings");
    const rows = args.entityId
      ? base
          .withIndex("entity", (q) => q.eq("entityId", args.entityId))
          .order("desc")
      : args.status
        ? base
            .withIndex("status", (q) => q.eq("status", args.status!))
            .order("desc")
        : base.withIndex("recent").order("desc");
    const page = await rows.paginate({
      ...args.paginationOpts,
      numItems: Math.min(50, args.paginationOpts.numItems),
    });
    return {
      ...page,
      page: await Promise.all(
        page.page
          .filter((f) => !args.status || f.status === args.status)
          .map((f) => activityDto(ctx, f)),
      ),
    };
  },
});
export const getActivity = query({
  args: { activityId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return activityDto(ctx, await requireFinding(ctx, args.activityId), true);
  },
});
const resolutionArgs = { activityId: v.string(), note: v.optional(v.string()) };
async function writeAccess(ctx: MutationCtx, activityId: string) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const finding = await requireFinding(ctx, activityId);
  return { operator, finding };
}
async function auditResolution(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  findingId: Id<"operatorWorkspaceScanFindings">,
  resolution: string,
) {
  await writeOperatorAudit(ctx, {
    operatorUserId,
    type: "setup_write",
    summary: `Workspace scan activity ${resolution}`,
    metadata: { source: "workspace_scan_review", findingId, resolution },
  });
}
export const resolveActivity = mutation({
  args: {
    ...resolutionArgs,
    selectedOrgId: v.optional(v.id("organizations")),
    selectedRequestId: v.optional(v.id("procurementRequests")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<GoogleWorkspaceScanActivityActionResult> => {
    const { operator, finding } = await writeAccess(ctx, args.activityId);
    if (finding.status === "updated" || finding.resolvedAt)
      return {
        status: "conflict",
        message: "This activity is already applied or resolved.",
      };
    if (args.selectedOrgId || args.selectedRequestId) {
      if (!finding.operationJson)
        throw new Error(
          "This finding has no proposed domain operation to resolve",
        );
      const op = scanOperationSchema.parse(JSON.parse(finding.operationJson));
      const orgId = args.selectedOrgId ?? finding.selectedOrgId;
      const org = orgId ? await ctx.db.get(orgId) : null;
      if (!org || org.type !== op.identity.kind)
        throw new Error("Select an existing organization of the correct type");
      const request = args.selectedRequestId
        ? await ctx.db.get(args.selectedRequestId)
        : null;
      if (
        args.selectedRequestId &&
        (!request || request.clientOrgId !== org._id)
      )
        throw new Error("Selected request must belong to the selected client");
      await retryGoogleWorkspaceScanSource(ctx, { sourceId: finding.sourceId });
      await ctx.db.patch(finding._id, {
        selectedOrgId: org._id,
        selectedRequestId: args.selectedRequestId,
        selectedByUserId: operator.userId,
        resolution: args.note?.slice(0, 2000),
      });
      await auditResolution(
        ctx,
        operator.userId,
        finding._id,
        "identity selected",
      );
      return {
        status: "retrying",
        message:
          "Selected identity saved. Evidence and current values will be re-evaluated.",
      };
    }
    if (!args.note?.trim())
      throw new Error(
        "Explain how this finding was resolved, or select an exact target",
      );
    await ctx.db.patch(finding._id, {
      resolvedAt: dayjs().valueOf(),
      resolution: args.note.slice(0, 2000),
    });
    await auditResolution(ctx, operator.userId, finding._id, "resolved");
    return {
      status: "resolved",
      message: "Review recorded. No business records were changed.",
    };
  },
});
export const dismissActivity = mutation({
  args: resolutionArgs,
  handler: async (
    ctx,
    args,
  ): Promise<GoogleWorkspaceScanActivityActionResult> => {
    const { operator, finding } = await writeAccess(ctx, args.activityId);
    if (finding.status === "updated")
      return {
        status: "conflict",
        message: "Applied changes must be corrected or managed on the record.",
      };
    await ctx.db.patch(finding._id, {
      resolvedAt: dayjs().valueOf(),
      resolution: args.note?.slice(0, 2000) ?? "Dismissed",
    });
    await auditResolution(ctx, operator.userId, finding._id, "dismissed");
    return { status: "dismissed", message: "Finding dismissed." };
  },
});
export const retryActivity = mutation({
  args: resolutionArgs,
  handler: async (
    ctx,
    args,
  ): Promise<GoogleWorkspaceScanActivityActionResult> => {
    const { operator, finding } = await writeAccess(ctx, args.activityId);
    if (finding.status === "updated")
      return {
        status: "conflict",
        message: "This operation has already been applied.",
      };
    await retryGoogleWorkspaceScanSource(ctx, { sourceId: finding.sourceId });
    await ctx.db.patch(finding._id, {
      resolvedAt: undefined,
      resolution: args.note?.slice(0, 2000),
    });
    await auditResolution(ctx, operator.userId, finding._id, "retrying");
    return { status: "retrying", message: "Source queued for re-evaluation." };
  },
});
export const correctActivity = mutation({
  args: resolutionArgs,
  handler: async (
    ctx,
    args,
  ): Promise<GoogleWorkspaceScanActivityActionResult> => {
    const { operator, finding } = await writeAccess(ctx, args.activityId);
    const changes = await ctx.db
      .query("operatorWorkspaceScanChanges")
      .withIndex("finding", (q) => q.eq("findingId", finding._id))
      .take(31);
    if (
      !changes.length ||
      changes.length > 30 ||
      changes.some((c) => c.created || c.correctedAt)
    )
      return {
        status: "conflict",
        message:
          "Created or already corrected records use their normal lifecycle controls.",
      };
    const targets = [];
    for (const change of changes) {
      const id = ctx.db.normalizeId(change.table, change.entityId);
      const record = id ? await ctx.db.get(id) : null;
      if (!id || !record || JSON.stringify(record) !== change.afterJson)
        return {
          status: "conflict",
          message:
            "A later change superseded this update. Review the current record.",
        };
      targets.push({ id, change });
    }
    for (const { id, change } of targets) {
      const before: Record<string, unknown> = JSON.parse(change.beforeJson);
      const patch = Object.fromEntries(
        change.fields.map((field) => [field, before[field]]),
      );
      await ctx.db.patch(id, patch);
      await ctx.db.patch(change._id, { correctedAt: dayjs().valueOf() });
    }
    await ctx.db.patch(finding._id, {
      resolvedAt: dayjs().valueOf(),
      resolution: args.note?.slice(0, 2000) ?? "Prior values restored",
    });
    await auditResolution(ctx, operator.userId, finding._id, "corrected");
    return { status: "corrected", message: "Prior values restored." };
  },
});
