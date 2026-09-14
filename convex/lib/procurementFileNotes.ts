import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  getMarkdownDocument,
  saveMarkdownDocument,
} from "../markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./markdownDocument";

export async function readProcurementFileNotes(
  ctx: QueryCtx | MutationCtx,
  item: Doc<"procurementFileItems">,
) {
  const document = await getMarkdownDocument(ctx, {
    orgId: item.clientOrgId,
    fileItemId: item._id,
    kind: "procurement_file_notes",
  });
  return document
    ? parseMarkdownDocument(document.markdown).body
    : (item.notes ?? "");
}

export async function saveProcurementFileNotes(
  ctx: MutationCtx,
  item: Doc<"procurementFileItems">,
  body: string,
) {
  const existing = await getMarkdownDocument(ctx, {
    orgId: item.clientOrgId,
    fileItemId: item._id,
    kind: "procurement_file_notes",
  });
  const incoming = parseMarkdownDocument(body);
  return saveMarkdownDocument(ctx, {
    orgId: item.clientOrgId,
    fileItemId: item._id,
    kind: "procurement_file_notes",
    filename: "file-notes.md",
    markdown: stringifyMarkdownDocument(
      {
        title: item.label,
        visibility: "private",
        ...(existing
          ? parseMarkdownDocument(existing.markdown).frontmatter
          : {}),
        ...incoming.frontmatter,
      },
      incoming.body,
    ),
    expectedRevision: existing?.revision ?? 0,
  });
}
