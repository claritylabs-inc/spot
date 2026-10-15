import { normalizedSearchText, uniqueSearchTerms } from "./searchTokenizer";

export type OrgWikiSource =
  | "extraction"
  | "analysis"
  | "chat"
  | "email"
  | "imessage"
  | "slack"
  | "manual"
  | "operator"
  | "mcp";

export const COMPANY_WIKI_FACT_MAX_LENGTH = 280;

const ORG_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "company",
  "co",
  "the",
]);

function orgNameTokens(orgName: string | undefined | null) {
  return uniqueSearchTerms(orgName ?? "").filter(
    (token) => token.length > 1 && !ORG_SUFFIXES.has(token),
  );
}

export function mentionsOrganization(content: string, orgName?: string | null) {
  const tokens = orgNameTokens(orgName);
  if (tokens.length === 0) return true;

  const normalizedContent = normalizedSearchText(content);
  const normalizedOrgName = normalizedSearchText(orgName ?? "");
  if (normalizedOrgName && normalizedContent.includes(normalizedOrgName)) {
    return true;
  }

  return tokens.every((token) => normalizedContent.includes(token));
}

export function normalizeWikiContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

/** Bound automatically extracted facts and keep their organization association.
 * Authored prose is validated by the Markdown owner, never by keyword blacklists. */
export function isCompanyWikiFact(args: {
  content: string;
  orgName?: string | null;
  trusted?: boolean;
}) {
  const content = normalizeWikiContent(args.content);
  if (!content || content.length > COMPANY_WIKI_FACT_MAX_LENGTH) return false;
  if (!mentionsOrganization(content, args.orgName)) return false;
  return true;
}
