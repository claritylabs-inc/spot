import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import {
  parseMarkdownDocument,
  parseDocumentVisibility,
  stringifyMarkdownDocument,
} from "./lib/markdownDocument";

type ReadCtx = QueryCtx | MutationCtx;
type DocumentScope = Parameters<typeof getMarkdownDocument>[1];
type NoteWriter = { actorUserId?: Id<"users">; migration?: boolean };

async function isOperatorWriter(ctx: MutationCtx, writer: NoteWriter) {
  if (writer.migration || !writer.actorUserId) return true;
  const [user, profile, impersonation] = await Promise.all([
    ctx.db.get(writer.actorUserId),
    ctx.db.query("operatorProfiles").withIndex("user", (q) => q.eq("userId", writer.actorUserId!)).unique(),
    ctx.db.query("operatorImpersonationSessions").withIndex("operator_status", (q) => q.eq("operatorUserId", writer.actorUserId!).eq("status", "active")).first(),
  ]);
  return user?.accountKind === "operator" && !user.isAnonymous && !user.serviceAccountKind && profile?.status === "active" && !impersonation;
}

async function readNote(ctx: ReadCtx, scope: DocumentScope, legacy?: string, includePrivate = false) {
  const document = await getMarkdownDocument(ctx, scope);
  if (!document) return legacy;
  const parsed = parseMarkdownDocument(document.markdown);
  if (parseDocumentVisibility(document.markdown) === "private" && !includePrivate) return undefined;
  return parsed.body.trim() || undefined;
}

async function prepareNote(ctx: MutationCtx, scope: DocumentScope, body: string, title: string, writer: NoteWriter) {
  const existing = await getMarkdownDocument(ctx, scope);
  const frontmatter = existing ? parseMarkdownDocument(existing.markdown).frontmatter : {};
  const input = writer.migration ? { frontmatter: {}, body } : parseMarkdownDocument(body);
  const operator = await isOperatorWriter(ctx, writer);
  if (!operator && (frontmatter.visibility === "private" || input.frontmatter.visibility === "private")) throw new Error("Private notes are available only to operators");
  const visibility = input.frontmatter.visibility ?? frontmatter.visibility ?? (writer.migration || !operator ? "shared" : "private");
  if (visibility !== "private" && visibility !== "shared") throw new Error("Note visibility must be private or shared");
  return {
    markdown: stringifyMarkdownDocument({ title, ...frontmatter, ...input.frontmatter, visibility }, input.body.trim()),
    revision: existing?.revision ?? 0,
  };
}

async function saveNote(ctx: MutationCtx, scope: DocumentScope, body: string, title: string, writer: NoteWriter) {
  const prepared = await prepareNote(ctx, scope, body, title, writer);
  await saveMarkdownDocument(ctx, {
    ...scope,
    filename: `${scope.kind.replaceAll("_", "-")}.md`,
    markdown: prepared.markdown,
    expectedRevision: prepared.revision,
  });
}

export async function validateDeliveryNotes(ctx: MutationCtx, job: Doc<"certificateWorkflowJobs">, notes: string, actorUserId: Id<"users">) {
  await prepareNote(ctx, { orgId: job.orgId, kind: "certificate_delivery_notes", certificateWorkflowJobId: job._id }, notes, "Certificate delivery notes", { actorUserId });
}

export function readRequirementNotes(ctx: ReadCtx, source: Doc<"requirementSourceDocuments">, includePrivate = false) {
  return readNote(ctx, {
    orgId: source.orgId, kind: "requirement_notes", requirementSourceDocumentId: source._id,
  }, source.internalNotes, includePrivate);
}

export async function saveRequirementNotes(ctx: MutationCtx, source: Doc<"requirementSourceDocuments">, notes: string, writer: NoteWriter = {}) {
  await saveNote(ctx, {
    orgId: source.orgId, kind: "requirement_notes", requirementSourceDocumentId: source._id,
  }, notes, `${source.title} notes`, writer);
  if (source.internalNotes !== undefined) await ctx.db.patch(source._id, { internalNotes: undefined });
}

export function readHolderNotes(ctx: ReadCtx, holder: Doc<"certificateHolders">, includePrivate = false) {
  return readNote(ctx, {
    orgId: holder.orgId, kind: "holder_notes", certificateHolderId: holder._id,
  }, holder.notes, includePrivate);
}

export async function saveHolderNotes(ctx: MutationCtx, holder: Doc<"certificateHolders">, notes: string, writer: NoteWriter = {}) {
  await saveNote(ctx, {
    orgId: holder.orgId, kind: "holder_notes", certificateHolderId: holder._id,
  }, notes, `${holder.displayName} notes`, writer);
  if (holder.notes !== undefined) await ctx.db.patch(holder._id, { notes: undefined });
}

export async function copyHolderNotes(ctx: MutationCtx, source: Doc<"certificateHolders">, target: Doc<"certificateHolders">) {
  const document = await getMarkdownDocument(ctx, { orgId: source.orgId, kind: "holder_notes", certificateHolderId: source._id });
  if (document) await saveHolderNotes(ctx, target, document.markdown);
  else if (source.notes !== undefined) await saveHolderNotes(ctx, target, source.notes, { migration: true });
}

export async function readWorkflowNotes(ctx: ReadCtx, job: Doc<"certificateWorkflowJobs">, includePrivate = false) {
  const [reviewNotes, sendNotes] = await Promise.all([
    readNote(ctx, {
      orgId: job.orgId, kind: "certificate_review_notes", certificateWorkflowJobId: job._id,
    }, job.reviewNotes, includePrivate),
    readNote(ctx, {
      orgId: job.orgId, kind: "certificate_delivery_notes", certificateWorkflowJobId: job._id,
    }, job.sendNotes, includePrivate),
  ]);
  return { reviewNotes, sendNotes };
}

export async function saveWorkflowNotes(
  ctx: MutationCtx,
  job: Doc<"certificateWorkflowJobs">,
  notes: { reviewNotes?: string; sendNotes?: string },
  writer: NoteWriter = {},
) {
  if (notes.reviewNotes !== undefined) {
    await saveNote(ctx, {
      orgId: job.orgId, kind: "certificate_review_notes", certificateWorkflowJobId: job._id,
    }, notes.reviewNotes, "Certificate review notes", writer);
    if (job.reviewNotes !== undefined) await ctx.db.patch(job._id, { reviewNotes: undefined });
  }
  if (notes.sendNotes !== undefined) {
    await saveNote(ctx, {
      orgId: job.orgId, kind: "certificate_delivery_notes", certificateWorkflowJobId: job._id,
    }, notes.sendNotes, "Certificate delivery notes", writer);
    if (job.sendNotes !== undefined) await ctx.db.patch(job._id, { sendNotes: undefined });
  }
}
