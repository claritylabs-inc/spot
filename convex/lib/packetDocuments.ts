import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  getMarkdownDocument,
  saveMarkdownDocument,
} from "../markdownDocuments";
import {
  parseDocumentVisibility,
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./markdownDocument";

export const PACKET_FILES = ["private.md", "public.md"] as const;
export type PacketFilename = (typeof PACKET_FILES)[number];

export function packetFileVisibility(filename: string) {
  if (filename === "private.md") return "private" as const;
  if (filename === "public.md") return "shared" as const;
  throw new Error("Use private.md or public.md");
}

function emptyPacketDocument(
  request: Doc<"procurementRequests">,
  filename: PacketFilename,
) {
  const visibility = packetFileVisibility(filename);
  return {
    _id: null,
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet" as const,
    filename,
    markdown: stringifyMarkdownDocument({ visibility }, ""),
    revision: 0,
    updatedAt: request.updatedAt,
    visibility,
  };
}

export async function readPacketDocuments(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const documents = await Promise.all(
    PACKET_FILES.map((filename) =>
      getMarkdownDocument(ctx, {
        orgId: request.clientOrgId,
        requestId: request._id,
        kind: "packet",
        filename,
      }),
    ),
  );
  return PACKET_FILES.map((filename, index) => {
    const visibility = packetFileVisibility(filename);
    const document = documents[index];
    return document && parseDocumentVisibility(document.markdown) === visibility
      ? { ...document, visibility }
      : emptyPacketDocument(request, filename);
  });
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

export async function initializePacketDocuments(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
  },
) {
  const request = await ctx.db.get(args.requestId);
  if (!request || request.clientOrgId !== args.clientOrgId)
    throw new Error("Procurement request not found");
  for (const filename of PACKET_FILES) {
    const visibility = packetFileVisibility(filename);
    await saveMarkdownDocument(ctx, {
      orgId: request.clientOrgId,
      requestId: request._id,
      kind: "packet",
      filename,
      markdown: stringifyMarkdownDocument({ visibility }, ""),
      expectedRevision: 0,
    });
  }
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

export async function appendPrivatePacketNote(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  heading: string,
  body: string,
) {
  const currentRequest = await ctx.db.get(request._id);
  if (!currentRequest || currentRequest.clientOrgId !== request.clientOrgId)
    throw new Error("Procurement request not found");
  const document = await readPacketDocument(ctx, currentRequest, "private.md");
  const parsed = parseMarkdownDocument(document.markdown);
  return await saveMarkdownDocument(ctx, {
    orgId: currentRequest.clientOrgId,
    requestId: currentRequest._id,
    kind: "packet",
    filename: "private.md",
    markdown: stringifyMarkdownDocument(
      { ...parsed.frontmatter, visibility: "private" },
      [parsed.body, `## ${heading}\n\n${body}`].filter(Boolean).join("\n\n"),
    ),
    expectedRevision: document.revision,
  });
}
