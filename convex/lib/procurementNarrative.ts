import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  readPacketProjection,
  migratePacketDocuments,
  readPacketDocument,
} from "./packetDocuments";
import { saveMarkdownDocument } from "../markdownDocuments";
import {
  parseDocumentVisibility,
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./markdownDocument";

export async function requestPacketText(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  return (await readPacketProjection(ctx, request, "operator")).markdown;
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
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new Error("Procurement request not found");
  const visibility = parseDocumentVisibility(args.narrative, "shared");
  if (args.source === "client" && visibility !== "shared")
    throw new Error("Client request intake must be shared");
  await migratePacketDocuments(ctx, args.requestId);
  if (!args.narrative.trim()) return;
  const filename = visibility === "private" ? "private.md" : "public.md";
  const document = await readPacketDocument(ctx, request, filename);
  const previous = parseMarkdownDocument(document.markdown);
  const incoming = parseMarkdownDocument(args.narrative);
  await saveMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "packet",
    filename,
    markdown: stringifyMarkdownDocument(
      { ...previous.frontmatter, ...incoming.frontmatter, visibility },
      [previous.body, `## Request\n\n${incoming.body}`]
        .filter(Boolean)
        .join("\n\n"),
    ),
    expectedRevision: document.revision,
  });
  if (visibility === "shared")
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
    });
}
