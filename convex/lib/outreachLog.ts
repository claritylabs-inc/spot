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
  return document
    ? parseMarkdownDocument(document.markdown).body
    : legacyOutreachLog(outreach);
}

export function legacyOutreachLog(
  outreach: Doc<"procurementBrokerOutreaches">,
) {
  const sections = outreach.notes?.trim() ? [outreach.notes] : [];
  const application = [
    outreach.applicationUrl
      ? `[Application link](${outreach.applicationUrl})`
      : null,
    ...(outreach.applicationQuestions ?? []).map((question) => `- ${question}`),
  ].filter(Boolean);
  if (application.length)
    sections.push(`## Application\n\n${application.join("\n")}`);
  const quote = [
    outreach.quoteSummary?.trim(),
    outreach.quoteAmount !== undefined
      ? `Premium: ${outreach.quoteCurrency ?? "USD"} ${outreach.quoteAmount}`
      : null,
    outreach.quoteUrl ? `[Quote link](${outreach.quoteUrl})` : null,
  ].filter(Boolean);
  if (quote.length) sections.push(`## Legacy quote\n\n${quote.join("\n\n")}`);
  return sections.join("\n\n");
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
