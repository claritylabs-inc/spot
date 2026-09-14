import dayjs from "dayjs";
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

export async function requestNarrative(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
  options: { includePrivate?: boolean } = {},
) {
  const document = await getMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename: "request-intake.md",
  });
  if (!document) return "";
  if (
    !options.includePrivate &&
    parseDocumentVisibility(document.markdown) === "private"
  )
    return "";
  return parseMarkdownDocument(document.markdown).body;
}

export async function saveRequestNarrative(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  narrative: string,
  options: { includePrivate?: boolean } = {},
) {
  const existing = await getMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename: "request-intake.md",
  });
  if (
    existing &&
    !options.includePrivate &&
    parseDocumentVisibility(existing.markdown) === "private"
  )
    throw new Error("Private request intake can only be edited by an operator");
  const incoming = parseMarkdownDocument(narrative);
  const metadata = {
    title: request.title,
    visibility: "shared",
    ...(existing ? parseMarkdownDocument(existing.markdown).frontmatter : {}),
    ...incoming.frontmatter,
  };
  if (!options.includePrivate && metadata.visibility !== "shared")
    throw new Error("Client request intake must be shared");
  const markdown = stringifyMarkdownDocument(metadata, incoming.body);
  const visibility = parseDocumentVisibility(markdown);
  const document = await saveMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename: "request-intake.md",
    markdown,
    expectedRevision: existing?.revision ?? 0,
  });
  if (
    existing?.markdown !== markdown &&
    (visibility === "shared" ||
      (existing && parseDocumentVisibility(existing.markdown) === "shared"))
  )
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedAt: dayjs().valueOf(),
    });
  return document;
}

export async function seedRequestIntake(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    narrative: string;
    userId: Id<"users">;
    source: "client" | "operator_agent" | "manual";
  },
) {
  if (!args.narrative.trim()) return;
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new Error("Procurement request not found");
  await saveRequestNarrative(ctx, request, args.narrative.trim(), {
    includePrivate: args.source !== "client",
  });
}
