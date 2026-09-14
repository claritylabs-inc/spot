import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readPacketDocument } from "./packetDocuments";
import {
  getMarkdownDocument,
  saveMarkdownDocument,
} from "../markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
  readMarkdownHeading,
  replaceMarkdownHeading,
} from "./markdownDocument";

export const NARRATIVE_SECTION_KEY = "intake_narrative";

export async function requestNarrative(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"procurementRequests">,
) {
  const document = await getMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "request_intake",
  });
  return document
    ? parseMarkdownDocument(document.markdown).body
    : (request.narrative ?? "");
}

export async function saveRequestNarrative(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  narrative: string,
) {
  const existing = await getMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "request_intake",
  });
  const incoming = parseMarkdownDocument(narrative);
  return saveMarkdownDocument(ctx, {
    orgId: request.clientOrgId,
    requestId: request._id,
    kind: "request_intake",
    filename: "request-intake.md",
    markdown: stringifyMarkdownDocument(
      {
        title: request.title,
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

export async function seedNarrativePacketSection(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    narrative: string;
    userId: Id<"users">;
    source: Doc<"procurementPacketSections">["source"];
  },
) {
  const body = args.narrative.trim();
  if (!body) return;
  const request = await ctx.db.get(args.requestId);
  if (!request) throw new Error("Procurement request not found");
  await saveRequestNarrative(ctx, request, body);
  const document = await readPacketDocument(
    ctx,
    request,
    "submission-packet.md",
  );
  const parsed = parseMarkdownDocument(document.markdown);
  if (readMarkdownHeading(parsed.body, "Client narrative")) return;
  await saveMarkdownDocument(ctx, {
    orgId: args.clientOrgId,
    requestId: args.requestId,
    kind: "packet",
    filename: document.filename,
    markdown: stringifyMarkdownDocument(
      { ...parsed.frontmatter, visibility: "shared" },
      replaceMarkdownHeading(parsed.body, "Client narrative", body),
    ),
    expectedRevision: document.revision,
  });
  await ctx.db.patch(args.requestId, {
    packetRevision: (request.packetRevision ?? 0) + 1,
    updatedAt: dayjs().valueOf(),
    updatedByUserId: args.userId,
  });
}
