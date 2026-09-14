import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  getMarkdownDocument,
  saveMarkdownDocument,
} from "../markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
  parseDocumentVisibility,
} from "./markdownDocument";

const legacyFiles = [
  { filename: "submission-packet.md", visibility: "shared" },
  { filename: "operator-packet.md", visibility: "private" },
] as const;

async function legacyPacketFiles(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const rows = await ctx.db
    .query("procurementPacketSections")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .collect();
  const files = [];
  for (const spec of legacyFiles) {
    const sections = rows
      .filter((row) =>
        spec.visibility === "private"
          ? row.audience === "operator"
          : row.audience !== "operator",
      )
      .sort((left, right) => left.order - right.order);
    if (!sections.length) continue;
    const parsed = {
      frontmatter: JSON.parse(
        JSON.stringify({
          title: request.title,
          legacySources: sections.map(({ body: _body, ...row }) => row),
        }),
      ) as Record<string, unknown>,
      body: sections
        .filter((row) => row.body.trim())
        .map((row) => `## ${row.heading}\n\n${row.body}`)
        .join("\n\n"),
    };
    const { audience: _audience, ...metadata } = parsed.frontmatter;
    files.push({
      filename: spec.filename,
      markdown: stringifyMarkdownDocument(
        { ...metadata, visibility: spec.visibility },
        parsed.body,
      ),
      updatedAt: request.updatedAt,
    });
  }
  return files;
}

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
  const legacy = await legacyPacketFiles(ctx, request);
  const fallback = legacy
    .filter(
      (file) =>
        !documents.some((document) => document.filename === file.filename),
    )
    .map((file) => ({
      _id: null,
      orgId: request.clientOrgId,
      requestId: request._id,
      kind: "packet" as const,
      filename: file.filename,
      markdown: file.markdown,
      revision: 0,
      updatedAt: file.updatedAt,
      visibility: parseDocumentVisibility(file.markdown, "private"),
    }));
  return [...canonical, ...fallback].sort((left, right) =>
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

export async function migratePacketDocuments(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  retireLegacyRows = false,
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
  let changed = false;
  for (const file of await legacyPacketFiles(ctx, request)) {
    const existing = await getMarkdownDocument(ctx, {
      orgId: request.clientOrgId,
      requestId,
      kind: "packet",
      filename: file.filename,
    });
    if (existing && existing.markdown !== file.markdown)
      throw new Error(
        `Canonical ${file.filename} conflicts with legacy packet content; reconcile both before migration`,
      );
    if (!existing) {
      await saveMarkdownDocument(ctx, {
        orgId: request.clientOrgId,
        requestId,
        kind: "packet",
        filename: file.filename,
        markdown: file.markdown,
        expectedRevision: 0,
      });
      changed = true;
    }
  }
  if (retireLegacyRows) {
    const rows = await ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .collect();
    for (const row of rows) await retireLegacyPacketSection(ctx, row);
  }
  return changed;
}

export async function retireLegacyPacketSection(
  ctx: MutationCtx,
  row: Doc<"procurementPacketSections">,
) {
  const documents = await ctx.db
    .query("markdownDocuments")
    .withIndex("request_kind", (q) =>
      q.eq("requestId", row.requestId).eq("kind", "packet"),
    )
    .collect();
  const mapped = documents
    .filter((document) => document.orgId === row.clientOrgId)
    .some((document) => {
      const sources = parseMarkdownDocument(document.markdown).frontmatter
        .legacySources;
      return (
        Array.isArray(sources) &&
        sources.some(
          (source) =>
            source && typeof source === "object" && source._id === row._id,
        )
      );
    });
  if (!mapped)
    throw new Error(
      "Migrate and verify the request Markdown documents before retiring its legacy packet rows",
    );
  await ctx.db.delete(row._id);
}
