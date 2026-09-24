"use node";
import {
  documentOutlineNodeKind,
  documentOutlineNodeText,
  documentOutlineNodeTitle,
  flattenDocumentOutline,
  getPolicyDocumentOutline,
} from "./policyDocumentStructure";
import { lobLabel, policyLobCodes, toLobCodes } from "./linesOfBusiness";
import { normalizedSearchText, uniqueSearchTerms } from "./searchTokenizer";
import {
  renderAgentMarkdownHtml,
  renderAgentMarkdownText,
} from "./transportRenderers";

/* ── Markdown processing ── */

export function stripMarkdown(text: string): string {
  return renderAgentMarkdownText(text);
}

export function markdownToHtml(text: string): string {
  return renderAgentMarkdownHtml(text);
}

/* ── Policy search ranking ── */

export function policySearchScore(
  policy: Record<string, unknown>,
  query: string,
  lineOfBusiness?: string,
  carrier?: string,
): number {
  const q = normalizedSearchText(query);
  const words = uniqueSearchTerms(query, { minimumLength: 3 });
  const linesOfBusiness = policyLobCodes(
    policy as { linesOfBusiness?: string[] },
  );
  const lineTerms = linesOfBusiness.flatMap((code) => [code, lobLabel(code)]);
  const coverages =
    (policy.coverages as
      | Array<{ name?: string; limit?: string }>
      | undefined) ?? [];
  const outlineText = flattenDocumentOutline(getPolicyDocumentOutline(policy))
    .slice(0, 20)
    .map(({ node }) =>
      [
        documentOutlineNodeTitle(node),
        documentOutlineNodeKind(node),
        documentOutlineNodeText(node, 500),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  const searchText = [
    policy.insuredName,
    policy.security,
    policy.carrier,
    (policy.generalAgent as { agencyName?: string } | undefined)?.agencyName,
    policy.mga,
    policy.policyNumber,
    policy.summary,
    ...lineTerms,
    ...coverages.flatMap((c) => [c.name, c.limit]),
    outlineText,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedSearch = normalizedSearchText(searchText);

  if (lineOfBusiness) {
    const requested = toLobCodes([lineOfBusiness]);
    const normalizedFilter = normalizedSearchText(lineOfBusiness);
    const canMatchByCode = !(
      requested.length === 1 &&
      requested[0] === "OLIB" &&
      normalizedFilter !== "olib" &&
      !normalizedFilter.includes("other liability")
    );
    const matchesLine =
      (canMatchByCode &&
        requested.some((code) => linesOfBusiness.includes(code))) ||
      lineTerms.some((term) =>
        normalizedSearchText(term).includes(normalizedFilter),
      ) ||
      normalizedSearch.includes(normalizedFilter);
    if (!matchesLine) return 0;
  }
  if (
    carrier &&
    !normalizedSearchText(
      String(policy.security ?? policy.carrier ?? ""),
    ).includes(normalizedSearchText(carrier))
  ) {
    return 0;
  }

  let score = 0;
  if (lineOfBusiness) score += 1;
  if (carrier) score += 1;
  if (q && normalizedSearch.includes(q)) score += 6;
  for (const word of words) {
    if (normalizedSearch.includes(word)) score += 1;
  }
  if (
    words.some((word) =>
      [
        "policy",
        "policies",
        "number",
        "coverage",
        "limit",
        "deductible",
        "premium",
      ].includes(word),
    )
  )
    score += 1;
  return score;
}

/* ── Structured error logging ── */

export function logAiError(
  action: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = message
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/g, "Bearer [REDACTED]")
    .replace(/re_[a-zA-Z0-9_]+/g, "[RESEND_KEY_REDACTED]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[API_KEY_REDACTED]");

  console.error(`[${action}] ${safeMessage}`, {
    action,
    ...context,
    timestamp: new Date().toISOString(),
  });
}
