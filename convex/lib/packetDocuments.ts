import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
  parseDocumentVisibility,
} from "./markdownDocument";

export async function readPacketDocuments(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const documents = await ctx.db
    .query("markdownDocuments")
    .withIndex("request_kind", (q) =>
      q.eq("requestId", request._id).eq("kind", "packet"),
    )
    .collect();
  const canonical = documents.map((document) => ({
    ...document,
    visibility: parseDocumentVisibility(document.markdown, "private"),
  }));
  return canonical.sort((left, right) =>
    left.filename.localeCompare(right.filename),
  );
}

export async function readPacketDocument(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  filename: string,
) {
  return (
    (await readPacketDocuments(ctx, request)).find(
      (document) => document.filename === filename,
    ) ?? {
      _id: null,
      orgId: request.clientOrgId,
      requestId: request._id,
      kind: "packet" as const,
      filename,
      markdown: stringifyMarkdownDocument({ visibility: "private" }, ""),
      revision: 0,
      updatedAt: request.updatedAt,
      visibility: "private" as const,
    }
  );
}

export async function readPacketProjection(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  audience: "operator" | "client" | "broker",
) {
  const documents = (await readPacketDocuments(ctx, request)).filter(
    (document) => audience === "operator" || document.visibility === "shared",
  );
  const sections = documents.flatMap((document, order) => {
    const body = parseMarkdownDocument(document.markdown).body;
    return body.trim()
      ? [
          {
            _id: document._id,
            key: document.filename,
            heading: document.filename,
            body,
            order,
            audience:
              document.visibility === "shared"
                ? ("broker" as const)
                : ("operator" as const),
          },
        ]
      : [];
  });
  return {
    documents,
    sections,
    markdown: sections.map((section) => section.body).join("\n\n"),
  };
}
