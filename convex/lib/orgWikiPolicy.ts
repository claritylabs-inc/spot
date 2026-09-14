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

const UNSAFE_COMPANY_WIKI_PATTERNS = [
  /\b(the\s+)?(agent|assistant)\b.*\b(can|cannot|can't|will|should|must|requires?|needs?|asks?|asked|responded|said|stated|indicated|sent|attached|drafts?|blocked|unable|proceed|initiated)\b/i,
  /\bspot\b.*\b(can|cannot|can't|will|should|must|requires?|needs?|asks?|asked|sent|attached|drafts?|generates?|blocked|unable)\b/i,
  /\b(the\s+)?user\b.*\b(requested|asked|wants|can proceed|provided|indicates|confirmed|approved|approval|needs?|requires?)\b/i,
  /\b(email draft|draft email|bcc|cc field|recipient|reply[- ]to|message[- ]id|attachment|attached|\.pdf\b|policy documents attached)\b/i,
  /\b(policy|endorsement|coi|certificate of insurance|certificate holder|additional insured|waiver of subrogation|primary and noncontributory|holder email|holder address|case id|status checker|application intake|intake id|pce)\b/i,
  /\b(policy number|policy period|named insured|limit of liability|aggregate limit|per[- ]occurrence|each claim|deductible|retroactive date|coinsurance|claims-made|carrier|insurer|coverage part)\b/i,
  /\b(request|task|status|on hold|blocked|cannot|can't|unable|requires|needs|must provide|can proceed)\b/i,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\b[A-Z]{2,}(?:-[A-Z0-9]{2,}){2,}\b/,
];

/** Check newly introduced prose without imposing the extraction fact format
 * on a complete authored Markdown document. */
export function assertAgentWikiContent(previous: string, proposed: string) {
  const existing = new Set(previous.split("\n").map((line) => line.trim()));
  for (const line of proposed.split("\n")) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      existing.has(trimmed) ||
      /^#{1,6}\s|^[-*_`~|:\s]+$/.test(trimmed)
    )
      continue;
    const content = trimmed
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^[-*+]\s+|^\d+\.\s+/, "");
    if (UNSAFE_COMPANY_WIKI_PATTERNS.some((pattern) => pattern.test(content))) {
      throw new Error(
        "Company wiki edits must contain company information, not policy terms, delivery instructions, or task status.",
      );
    }
  }
}

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

/** Gate every line written into the wiki. `trusted` marks a schema-validated
 * extraction path, which may use first-person phrasing the free-text agent
 * tools must not. */
export function isCompanyWikiFact(args: {
  content: string;
  orgName?: string | null;
  trusted?: boolean;
}) {
  const content = normalizeWikiContent(args.content);
  if (!content || content.length > COMPANY_WIKI_FACT_MAX_LENGTH) return false;
  if (!mentionsOrganization(content, args.orgName)) return false;
  if (args.trusted) return true;
  if (/^(we|our|i|the user|user)\b/i.test(content)) return false;
  return !UNSAFE_COMPANY_WIKI_PATTERNS.some((pattern) => pattern.test(content));
}
