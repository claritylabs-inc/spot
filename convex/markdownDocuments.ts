import dayjs from "dayjs";
import type { Infer } from "convex/values";
import type { markdownDocumentKind } from "./lib/markdownDocumentSchema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  parseDocumentVisibility,
  withDocumentVisibility,
} from "./lib/markdownDocument";

export type MarkdownDocumentKind = Infer<typeof markdownDocumentKind>;
type DocumentScope = {
  orgId: Id<"organizations">;
  kind: MarkdownDocumentKind;
  requestId?: Id<"procurementRequests">;
  outreachId?: Id<"procurementBrokerOutreaches">;
  requirementSourceDocumentId?: Id<"requirementSourceDocuments">;
  certificateHolderId?: Id<"certificateHolders">;
  certificateWorkflowJobId?: Id<"certificateWorkflowJobs">;
  fileItemId?: Id<"procurementFileItems">;
  filename?: string;
};

export async function getMarkdownDocument(
  ctx: QueryCtx | MutationCtx,
  scope: DocumentScope,
) {
  const requestOwned = scope.kind === "packet";
  const owners = [
    scope.requestId,
    scope.outreachId,
    scope.requirementSourceDocumentId,
    scope.certificateHolderId,
    scope.certificateWorkflowJobId,
    scope.fileItemId,
  ].filter(Boolean);
  const valid =
    scope.kind === "company_wiki"
      ? owners.length === 0
      : owners.length === 1 &&
        ((requestOwned && scope.requestId) ||
          (scope.kind === "outreach_log" && scope.outreachId) ||
          (scope.kind === "requirement_notes" &&
            scope.requirementSourceDocumentId) ||
          (scope.kind === "holder_notes" && scope.certificateHolderId) ||
          (["certificate_review_notes", "certificate_delivery_notes"].includes(
            scope.kind,
          ) &&
            scope.certificateWorkflowJobId) ||
          (scope.kind === "procurement_file_notes" && scope.fileItemId));
  if (!valid) throw new Error("Invalid Markdown document scope");
  if (scope.kind === "packet" && !scope.filename)
    throw new Error("Packet Markdown files require a filename");
  const document = await findDocument(ctx, scope);
  if (document && document.orgId !== scope.orgId)
    throw new Error("Markdown document organization mismatch");
  return document;
}

async function findDocument(ctx: QueryCtx | MutationCtx, scope: DocumentScope) {
  const documents = ctx.db.query("markdownDocuments");
  if (scope.kind === "packet")
    return documents
      .withIndex("request_file", (q) =>
        q
          .eq("requestId", scope.requestId)
          .eq("kind", "packet")
          .eq("filename", scope.filename!),
      )
      .unique();
  if (scope.requestId)
    return documents
      .withIndex("request_kind", (q) =>
        q.eq("requestId", scope.requestId).eq("kind", scope.kind),
      )
      .unique();
  if (scope.outreachId)
    return documents
      .withIndex("outreach_kind", (q) =>
        q.eq("outreachId", scope.outreachId).eq("kind", scope.kind),
      )
      .unique();
  if (scope.requirementSourceDocumentId)
    return documents
      .withIndex("requirement_kind", (q) =>
        q
          .eq("requirementSourceDocumentId", scope.requirementSourceDocumentId)
          .eq("kind", scope.kind),
      )
      .unique();
  if (scope.certificateHolderId)
    return documents
      .withIndex("holder_kind", (q) =>
        q
          .eq("certificateHolderId", scope.certificateHolderId)
          .eq("kind", scope.kind),
      )
      .unique();
  if (scope.certificateWorkflowJobId)
    return documents
      .withIndex("workflow_kind", (q) =>
        q
          .eq("certificateWorkflowJobId", scope.certificateWorkflowJobId)
          .eq("kind", scope.kind),
      )
      .unique();
  if (scope.fileItemId)
    return documents
      .withIndex("file_kind", (q) =>
        q.eq("fileItemId", scope.fileItemId).eq("kind", scope.kind),
      )
      .unique();
  return documents
    .withIndex("organization_kind", (q) =>
      q.eq("orgId", scope.orgId).eq("kind", scope.kind),
    )
    .unique();
}

/** Call only after the owning wiki/packet authorization boundary has passed. */
export async function saveMarkdownDocument(
  ctx: MutationCtx,
  args: DocumentScope & {
    filename: string;
    markdown: string;
    expectedRevision: number;
  },
) {
  if (!/^[^/\\\u0000-\u001f]+\.md$/i.test(args.filename))
    throw new Error("Use a plain .md filename");
  const existing = await getMarkdownDocument(ctx, args);
  const owner = await ctx.db.get(
    args.requestId ??
      args.outreachId ??
      args.requirementSourceDocumentId ??
      args.certificateHolderId ??
      args.certificateWorkflowJobId ??
      args.fileItemId ??
      args.orgId,
  );
  if (!owner) throw new Error("Markdown document owner not found");
  const ownerOrgId =
    "clientOrgId" in owner
      ? owner.clientOrgId
      : "orgId" in owner
        ? owner.orgId
        : owner._id;
  if (ownerOrgId !== args.orgId)
    throw new Error("Markdown document organization mismatch");
  const organization =
    args.kind === "company_wiki" ? await ctx.db.get(args.orgId) : null;
  const fallback = existing
    ? parseDocumentVisibility(existing.markdown)
    : args.kind === "company_wiki" && organization?.type === "client"
      ? "shared"
      : "private";
  const markdown = withDocumentVisibility(args.markdown, fallback);
  if (
    args.kind === "company_wiki" &&
    organization?.type === "broker" &&
    parseDocumentVisibility(markdown) !== "private"
  )
    throw new Error("Supplier company documents must remain private");
  if (args.expectedRevision !== (existing?.revision ?? 0))
    throw new Error(
      "This document changed. Reload it before saving your edits.",
    );
  if (existing?.markdown === markdown && existing.filename === args.filename)
    return existing;
  const value = {
    orgId: args.orgId,
    kind: args.kind,
    requestId: args.requestId,
    outreachId: args.outreachId,
    requirementSourceDocumentId: args.requirementSourceDocumentId,
    certificateHolderId: args.certificateHolderId,
    certificateWorkflowJobId: args.certificateWorkflowJobId,
    fileItemId: args.fileItemId,
    filename: args.filename,
    markdown,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: dayjs().valueOf(),
  };
  const id = existing
    ? existing._id
    : await ctx.db.insert("markdownDocuments", value);
  if (existing) await ctx.db.patch(id, value);
  return (await ctx.db.get(id))!;
}
