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
type NoteWriter = { actorUserId?: Id<"users"> };

async function isOperatorWriter(ctx: MutationCtx, writer: NoteWriter) {
  if (!writer.actorUserId) return true;
  const [user, profile, impersonation] = await Promise.all([
    ctx.db.get(writer.actorUserId),
    ctx.db.query("operatorProfiles").withIndex("user", (q) => q.eq("userId", writer.actorUserId!)).unique(),
    ctx.db.query("operatorImpersonationSessions").withIndex("operator_status", (q) => q.eq("operatorUserId", writer.actorUserId!).eq("status", "active")).first(),
  ]);
  return user?.accountKind === "operator" && !user.isAnonymous && !user.serviceAccountKind && profile?.status === "active" && !impersonation;
}

async function readNote(ctx: ReadCtx, scope: DocumentScope, includePrivate = false) {
  const document = await getMarkdownDocument(ctx, scope);
  if (!document) return undefined;
  const parsed = parseMarkdownDocument(document.markdown);
  if (parseDocumentVisibility(document.markdown) === "private" && !includePrivate) return undefined;
  return parsed.body.trim() || undefined;
}

async function prepareNote(ctx: MutationCtx, scope: DocumentScope, body: string, title: string, writer: NoteWriter) {
  const existing = await getMarkdownDocument(ctx, scope);
  const frontmatter = existing ? parseMarkdownDocument(existing.markdown).frontmatter : {};
  const input = parseMarkdownDocument(body);
  const operator = await isOperatorWriter(ctx, writer);
  if (!operator && (frontmatter.visibility === "private" || input.frontmatter.visibility === "private")) throw new Error("Private notes are available only to operators");
  const visibility = input.frontmatter.visibility ?? frontmatter.visibility ?? (!operator ? "shared" : "private");
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

export function readRequirementNotes(ctx: ReadCtx, source: Doc<"requirementSourceDocuments">, includePrivate = false) {
  return readNote(ctx, {
    orgId: source.orgId, kind: "requirement_notes", requirementSourceDocumentId: source._id,
  }, includePrivate);
}

export async function saveRequirementNotes(ctx: MutationCtx, source: Doc<"requirementSourceDocuments">, notes: string, writer: NoteWriter = {}) {
  await saveNote(ctx, {
    orgId: source.orgId, kind: "requirement_notes", requirementSourceDocumentId: source._id,
  }, notes, `${source.title} notes`, writer);
}

export function readHolderNotes(ctx: ReadCtx, holder: Doc<"certificateHolders">, includePrivate = false) {
  return readNote(ctx, {
    orgId: holder.orgId, kind: "holder_notes", certificateHolderId: holder._id,
  }, includePrivate);
}

export async function saveHolderNotes(ctx: MutationCtx, holder: Doc<"certificateHolders">, notes: string, writer: NoteWriter = {}) {
  await saveNote(ctx, {
    orgId: holder.orgId, kind: "holder_notes", certificateHolderId: holder._id,
  }, notes, `${holder.displayName} notes`, writer);
}

export async function copyHolderNotes(ctx: MutationCtx, source: Doc<"certificateHolders">, target: Doc<"certificateHolders">) {
  const document = await getMarkdownDocument(ctx, { orgId: source.orgId, kind: "holder_notes", certificateHolderId: source._id });
  if (document) await saveHolderNotes(ctx, target, document.markdown);
}
