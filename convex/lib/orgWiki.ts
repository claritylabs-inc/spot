import { normalizeWikiContent } from "./orgWikiPolicy";

/** Suggested headings for automatic fact placement in the company's Markdown
 * file. Human-authored documents may contain any headings or Markdown. */
export const ORG_WIKI_SECTIONS = [
  ["profile", "Company profile"],
  ["operations", "Operations"],
  ["scale", "Scale"],
  ["compliance", "Compliance posture"],
  ["preferences", "Preferences"],
  ["notes", "Other notes"],
] as const;

export type OrgWikiSectionKey = (typeof ORG_WIKI_SECTIONS)[number][0];

export const ORG_WIKI_SECTION_KEYS = ORG_WIKI_SECTIONS.map(([key]) => key) as [
  OrgWikiSectionKey,
  ...OrgWikiSectionKey[],
];

const ORG_WIKI_SECTION_MAP = new Map<
  string,
  { key: OrgWikiSectionKey; heading: string }
>(ORG_WIKI_SECTIONS.map(([key, heading]) => [key, { key, heading }]));

export function requireOrgWikiSection(key: string) {
  const canonical = ORG_WIKI_SECTION_MAP.get(key);
  if (!canonical) throw new Error(`Unknown company wiki section ${key}`);
  return canonical;
}

export function isOrgWikiSectionKey(
  value: unknown,
): value is OrgWikiSectionKey {
  return typeof value === "string" && ORG_WIKI_SECTION_MAP.has(value);
}

/** Render automatically contributed facts without changing surrounding prose. */
export function renderWikiBullets(lines: string[]) {
  return [...new Set(lines.map((line) => normalizeWikiContent(line)))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((line) => `- ${line}`)
    .join("\n");
}

export function wikiBulletLines(body: string) {
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}
