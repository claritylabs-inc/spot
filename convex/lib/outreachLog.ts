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

export async function readOutreachLog(
  ctx: QueryCtx | MutationCtx,
  outreach: Doc<"procurementBrokerOutreaches">,
) {
  const document = await getMarkdownDocument(ctx, {
    orgId: outreach.clientOrgId,
    outreachId: outreach._id,
    kind: "outreach_log",
  });
  return document ? parseMarkdownDocument(document.markdown).body : "";
}

export async function saveOutreachLog(
  ctx: MutationCtx,
  outreach: Doc<"procurementBrokerOutreaches">,
  body: string,
) {
  const existing = await getMarkdownDocument(ctx, {
    orgId: outreach.clientOrgId,
    outreachId: outreach._id,
    kind: "outreach_log",
  });
  const incoming = parseMarkdownDocument(body);
  return saveMarkdownDocument(ctx, {
    orgId: outreach.clientOrgId,
    outreachId: outreach._id,
    kind: "outreach_log",
    filename: "market-log.md",
    markdown: stringifyMarkdownDocument(
      {
        title: outreach.brokerName,
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
