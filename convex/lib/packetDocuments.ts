import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { saveMarkdownDocument } from "../markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
  parseDocumentVisibility,
} from "./markdownDocument";

export const PACKET_FILES = ["private.md", "public.md"] as const;
export type PacketFilename = (typeof PACKET_FILES)[number];
export function packetFileVisibility(filename: string) {
  if (filename === "private.md") return "private" as const;
  if (filename === "public.md") return "shared" as const;
  throw new Error("Use private.md or public.md");
}

function legacyLog(row: Doc<"procurementBrokerOutreaches">) {
  return [
    row.notes,
    row.applicationUrl ? `Application: ${row.applicationUrl}` : undefined,
    ...(row.applicationQuestions ?? []).map((question) => `- ${question}`),
    row.quoteSummary,
    row.quoteAmount !== undefined
      ? `Premium: ${row.quoteCurrency ?? "USD"} ${row.quoteAmount}`
      : undefined,
    row.quoteUrl ? `Quote: ${row.quoteUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function packetSources(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  request = (await ctx.db.get(request._id)) ?? request;
  const [documents, sections, outreaches, files] = await Promise.all([
    ctx.db
      .query("markdownDocuments")
      .withIndex("request_kind", (q) =>
        q.eq("requestId", request._id).eq("kind", "packet"),
      )
      .collect(),
    ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect(),
  ]);
  if (documents.some((document) => document.orgId !== request.clientOrgId) ||
    [...sections, ...outreaches, ...files].some((row) => row.clientOrgId !== request.clientOrgId))
    throw new Error("Request document source organization mismatch");
  const sources: {
    title: string;
    body: string;
    visibility: "private" | "shared";
    metadata: unknown;
  }[] = [];
  const obsoleteDocuments: Doc<"markdownDocuments">[] = [];
  for (const document of documents) {
    if (
      PACKET_FILES.some((filename) => filename === document.filename) &&
      parseDocumentVisibility(document.markdown) ===
        packetFileVisibility(document.filename)
    )
      continue;
    const { body, frontmatter } = parseMarkdownDocument(document.markdown);
    const { markdown: _markdown, ...metadata } = document;
    sources.push({
      title:
        typeof frontmatter.title === "string"
          ? frontmatter.title
          : document.filename.replace(/\.md$/i, ""),
      body,
      visibility: parseDocumentVisibility(document.markdown),
      metadata: { ...metadata, frontmatter },
    });
    if (!PACKET_FILES.some((filename) => filename === document.filename))
      obsoleteDocuments.push(document);
  }
  for (const row of sections.sort((a, b) => a.order - b.order)) {
    const { body, ...metadata } = row;
    sources.push({
      title: row.heading,
      body:
        row.key === "intake_narrative" &&
        body.trim() === request.narrative?.trim()
          ? ""
          : body,
      visibility: row.audience === "operator" ? "private" : "shared",
      metadata,
    });
  }
  if (request.narrative !== undefined) {
    const { body, frontmatter } = parseMarkdownDocument(request.narrative);
    sources.push({
      title: "Request",
      body: documents.some(
        (document) =>
          document.filename === "request-intake.md" &&
          parseMarkdownDocument(document.markdown).body.trim() === body.trim(),
      )
        ? ""
        : body,
      visibility: parseDocumentVisibility(request.narrative, "shared"),
      metadata: { requestId: request._id, field: "narrative", frontmatter },
    });
  }
  for (const outreach of outreaches) {
    const document = await ctx.db
      .query("markdownDocuments")
      .withIndex("outreach_kind", (q) =>
        q.eq("outreachId", outreach._id).eq("kind", "outreach_log"),
      )
      .unique();
    if (document) {
      if (document.orgId !== request.clientOrgId) throw new Error("Request document source organization mismatch");
      const { body, frontmatter } = parseMarkdownDocument(document.markdown);
      const { markdown: _markdown, ...metadata } = document;
      sources.push({
        title: outreach.brokerName,
        body,
        visibility: "private",
        metadata: { ...metadata, frontmatter },
      });
      obsoleteDocuments.push(document);
    }
    const body = legacyLog(outreach);
    if (body)
      sources.push({
        title: outreach.brokerName,
        body,
        visibility: "private",
        metadata: {
          outreachId: outreach._id,
          fields: {
            notes: outreach.notes,
            applicationUrl: outreach.applicationUrl,
            applicationQuestions: outreach.applicationQuestions,
            quoteSummary: outreach.quoteSummary,
            quoteAmount: outreach.quoteAmount,
            quoteCurrency: outreach.quoteCurrency,
            quoteUrl: outreach.quoteUrl,
          },
        },
      });
  }
  for (const file of files) {
    const document = await ctx.db
      .query("markdownDocuments")
      .withIndex("file_kind", (q) =>
        q.eq("fileItemId", file._id).eq("kind", "procurement_file_notes"),
      )
      .unique();
    if (document) {
      if (document.orgId !== request.clientOrgId) throw new Error("Request document source organization mismatch");
      const { body, frontmatter } = parseMarkdownDocument(document.markdown);
      const { markdown: _markdown, ...metadata } = document;
      sources.push({
        title: file.label,
        body,
        visibility: parseDocumentVisibility(document.markdown),
        metadata: { ...metadata, frontmatter },
      });
      obsoleteDocuments.push(document);
    }
    if (file.notes !== undefined)
      sources.push({
        title: file.label,
        body: file.notes,
        visibility: "private",
        metadata: { fileItemId: file._id, field: "notes" },
      });
  }
  return { documents, sources, obsoleteDocuments, sections, outreaches, files };
}

async function projectedFiles(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const state = await packetSources(ctx, request);
  const documents = PACKET_FILES.map((filename) => {
    const existing = state.documents.find(
      (document) => document.filename === filename,
    );
    const visibility = packetFileVisibility(filename);
    const parsed = parseMarkdownDocument(
      existing && parseDocumentVisibility(existing.markdown) === visibility
        ? existing.markdown
        : "",
    );
    let body = parsed.body;
    const { legacySources: _legacySources, ...fileMetadata } =
      parsed.frontmatter;
    const metadata =
      filename === "private.md"
        ? [
            ...(Array.isArray(parsed.frontmatter.legacySources)
              ? parsed.frontmatter.legacySources
              : parsed.frontmatter.legacySources === undefined ? [] : [{ legacySources: parsed.frontmatter.legacySources }]),
            ...state.sources.map((source) => source.metadata),
            ...state.documents
              .filter((document) => document.filename === "public.md")
              .flatMap((document) => {
                const old = parseMarkdownDocument(document.markdown).frontmatter
                  .legacySources;
                return old === undefined
                  ? []
                  : [{ documentId: document._id, legacySources: old }];
              }),
          ]
        : [];
    for (const source of state.sources.filter(
      (source) => source.visibility === visibility,
    )) {
      if (source.body.trim())
        body = [body, `## ${source.title}\n\n${source.body}`]
          .filter(Boolean)
          .join("\n\n");
    }
    const frontmatter = JSON.parse(
      JSON.stringify({
        ...fileMetadata,
        visibility,
        ...(metadata.length ? { legacySources: metadata } : {}),
      }),
    ) as Record<string, unknown>;
    const markdown = stringifyMarkdownDocument(frontmatter, body);
    return {
      _id: existing?._id ?? null,
      orgId: request.clientOrgId,
      requestId: request._id,
      kind: "packet" as const,
      filename,
      markdown,
      revision: existing?.revision ?? 0,
      updatedAt: existing?.updatedAt ?? request.updatedAt,
      visibility,
    };
  });
  return { ...state, projected: documents };
}

export async function readPacketDocuments(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  return (await projectedFiles(ctx, request)).projected;
}

export async function readPacketDocument(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  filename: string,
) {
  packetFileVisibility(filename);
  return (await readPacketDocuments(ctx, request)).find(
    (document) => document.filename === filename,
  )!;
}

export async function readPacketProjection(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  audience: "operator" | "client" | "broker",
) {
  const documents = (await readPacketDocuments(ctx, request)).filter(
    (document) => audience === "operator" || document.filename === "public.md",
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

/** Consolidate the request atomically before any file edit; reruns have no source rows to reappend. */
export async function migratePacketDocuments(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
  const state = await projectedFiles(ctx, request);
  for (const document of state.projected) {
    const saved = await saveMarkdownDocument(ctx, {
      orgId: request.clientOrgId,
      requestId,
      kind: "packet",
      filename: document.filename,
      markdown: document.markdown,
      expectedRevision:
        state.documents.find(
          (existing) => existing.filename === document.filename,
        )?.revision ?? 0,
    });
    if (saved.revision !== document.revision)
      await ctx.db.patch(saved._id, { revision: document.revision });
  }
  for (const document of state.obsoleteDocuments)
    await ctx.db.delete(document._id);
  for (const row of state.sections) await ctx.db.delete(row._id);
  if (request.narrative !== undefined)
    await ctx.db.patch(requestId, { narrative: undefined });
  for (const row of state.outreaches)
    if (
      [
        "notes",
        "applicationUrl",
        "applicationQuestions",
        "quoteSummary",
        "quoteAmount",
        "quoteCurrency",
        "quoteUrl",
      ].some((field) => field in row)
    )
      await ctx.db.patch(row._id, {
        notes: undefined,
        applicationUrl: undefined,
        applicationQuestions: undefined,
        quoteSummary: undefined,
        quoteAmount: undefined,
        quoteCurrency: undefined,
        quoteUrl: undefined,
      });
  for (const row of state.files)
    if (row.notes !== undefined)
      await ctx.db.patch(row._id, { notes: undefined });
}

export async function appendPrivatePacketNote(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  heading: string,
  body: string,
) {
  await migratePacketDocuments(ctx, request._id);
  const document = await readPacketDocument(
    ctx,
    (await ctx.db.get(request._id))!,
    "private.md",
  );
  const parsed = parseMarkdownDocument(document.markdown);
  return saveMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename: "private.md",
    markdown: stringifyMarkdownDocument(
      parsed.frontmatter,
      [parsed.body, `## ${heading}\n\n${body}`].filter(Boolean).join("\n\n"),
    ),
    expectedRevision: document.revision,
  });
}
