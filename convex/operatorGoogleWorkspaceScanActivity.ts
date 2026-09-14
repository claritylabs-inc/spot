import { manualWikiDocument } from "./lib/orgWikiDocument";
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
import { readPolicyPipelineState } from "./policies";
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
): Promise<GoogleWorkspaceScanActivity> {
  const source = await ctx.db.get(finding.sourceId);
  const sourceLinks = await ctx.db
    .query("operatorWorkspaceScanFindingSources")
    .withIndex("finding", (q) => q.eq("findingId", finding._id))
    .take(50);
  const provenance = await Promise.all(
    sourceLinks.map(async (link) => ({
      source: await ctx.db.get(link.sourceId),
      excerpt: link.excerpt,
    })),
  );
  if (!provenance.length && source)
    provenance.push({ source, excerpt: finding.excerpt });
  const changes = await ctx.db
    .query("operatorWorkspaceScanChanges")
    .withIndex("finding", (q) => q.eq("findingId", finding._id))
    .take(30);
  let importState: GoogleWorkspaceScanActivity["importState"];
  const imported = changes.find((change) => change.table === "policies");
  if (imported) {
    const id = ctx.db.normalizeId("policies", imported.entityId);
    const pipeline = id ? await readPolicyPipelineState(ctx, id) : null;
    importState =
      pipeline?.pipelineStatus === "complete"
        ? "complete"
        : !pipeline || pipeline.pipelineStatus === "error"
          ? "error"
          : pipeline.pipelineStatus === "idle"
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
    sources: provenance.flatMap(({ source, excerpt }) =>
      source?.evidence
        ? [
            {
              sourceId: source._id,
              mailbox: source.mailbox,
              messageId: source.messageId,
              threadId: source.threadId,
              subject: source.evidence.subject,
              sentAt: source.evidence.sentAt,
              excerpt,
              href: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(source.mailbox)}#all/${encodeURIComponent(source.threadId)}`,
            },
          ]
        : [],
    ),
    availableActions,
    importState,
  };
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
    const requestId = args.entityId
      ? ctx.db.normalizeId("procurementRequests", args.entityId)
      : null;
    const orgId = args.entityId
      ? ctx.db.normalizeId("organizations", args.entityId)
      : null;
    const organization = orgId ? await ctx.db.get(orgId) : null;
    let rows;
    if (organization?.type === "broker") {
      rows = args.status
        ? base.withIndex("broker_status", (q) =>
            q.eq("brokerId", organization._id).eq("status", args.status!),
          )
        : base.withIndex("broker", (q) => q.eq("brokerId", organization._id));
    } else if (requestId) {
      rows = args.status
        ? base.withIndex("request_status", (q) =>
            q.eq("requestId", requestId).eq("status", args.status!),
          )
        : base.withIndex("request", (q) => q.eq("requestId", requestId));
    } else if (orgId) {
      rows = args.status
        ? base.withIndex("entity_status", (q) =>
            q.eq("entityId", orgId).eq("status", args.status!),
          )
        : base.withIndex("entity", (q) => q.eq("entityId", orgId));
    } else if (args.entityId) {
      rows = args.status
        ? base.withIndex("record_status", (q) =>
            q.eq("recordId", args.entityId).eq("status", args.status!),
          )
        : base.withIndex("record", (q) => q.eq("recordId", args.entityId));
    } else {
      rows = args.status
        ? base.withIndex("status", (q) => q.eq("status", args.status!))
        : base.withIndex("recent");
    }
    const page = await rows.order("desc").paginate({
      ...args.paginationOpts,
      numItems: Math.min(50, args.paginationOpts.numItems),
    });
    return {
      ...page,
      page: await Promise.all(page.page.map((f) => activityDto(ctx, f))),
    };
  },
});
export const getActivity = query({
  args: { activityId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return activityDto(ctx, await requireFinding(ctx, args.activityId));
  },
});
export const listActivityCandidates = query({
  args: {
    activityId: v.string(),
    kind: v.union(v.literal("organization"), v.literal("request")),
    selectedOrgId: v.optional(v.id("organizations")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const finding = await requireFinding(ctx, args.activityId);
    if (
      !finding.operationJson ||
      finding.status === "updated" ||
      finding.resolvedAt
    ) {
      return { page: [], continueCursor: "", isDone: true };
    }
    const operation = scanOperationSchema.parse(
      JSON.parse(finding.operationJson),
    );
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(50, args.paginationOpts.numItems),
    };
    if (args.kind === "organization") {
      const page = await ctx.db
        .query("organizations")
        .withIndex("type", (q) => q.eq("type", operation.identity.kind))
        .paginate(paginationOpts);
      return {
        ...page,
        page: page.page.map((org) => ({
          id: org._id,
          label: [
            org.name,
            org.primaryContactEmail,
            org.mailingAddress?.street1,
          ]
            .filter(Boolean)
            .join(" · "),
        })),
      };
    }
    const orgId = args.selectedOrgId ?? finding.selectedOrgId;
    if (!orgId) return { page: [], continueCursor: "", isDone: true };
    const org = await ctx.db.get(orgId);
    if (!org || org.type !== operation.identity.kind) {
      throw new Error("Select an existing organization of the correct type");
    }
    const page = await ctx.db
      .query("procurementRequests")
      .withIndex("organization", (q) => q.eq("clientOrgId", orgId))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((request) => ({
        id: request._id,
        label: [
          request.title,
          request.targetEffectiveDate,
          request.status.replaceAll("_", " "),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    };
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
      const current = await ctx.db.get(id);
      if (current && "updatedAt" in current)
        patch.updatedAt = dayjs().valueOf();
      if (current && "updatedByUserId" in current)
        patch.updatedByUserId = operator.userId;
      if (change.table === "orgWikiSections")
        patch.manuallyEditedAt = dayjs().valueOf();
      if (
        change.table === "markdownDocuments" &&
        current &&
        "markdown" in current
      ) {
        const restoredMarkdown =
          typeof patch.markdown === "string"
            ? patch.markdown
            : current.markdown;
        patch.markdown =
          current.kind === "company_wiki"
            ? manualWikiDocument(restoredMarkdown)
            : restoredMarkdown;
        patch.revision = current.revision + 1;
      }
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
