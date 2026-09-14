import { parseDocument, stringify } from "yaml";

export const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_FRONTMATTER_BYTES = 256 * 1024;
export type DocumentVisibility = "private" | "shared";

export function parseDocumentVisibility(
  markdown: string,
  fallback: DocumentVisibility = "private",
): DocumentVisibility {
  const { frontmatter } = parseMarkdownDocument(markdown);
  if (frontmatter.visibility === undefined) return fallback;
  if (
    frontmatter.visibility !== "private" &&
    frontmatter.visibility !== "shared"
  )
    throw new Error("Markdown visibility must be private or shared");
  return frontmatter.visibility;
}

export function withDocumentVisibility(
  markdown: string,
  fallback: DocumentVisibility,
): string {
  const { frontmatter, body } = parseMarkdownDocument(markdown);
  const visibility = parseDocumentVisibility(markdown, fallback);
  return frontmatter.visibility === undefined
    ? stringifyMarkdownDocument({ ...frontmatter, visibility }, body)
    : markdown;
}

function validateMetadata(
  value: unknown,
  depth = 0,
  budget = { remaining: 10_000 },
): void {
  if (--budget.remaining < 0 || depth > 16)
    throw new Error("Markdown metadata is too complex");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateMetadata(item, depth + 1, budget);
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("Invalid Markdown metadata key");
      validateMetadata(item, depth + 1, budget);
    }
    return;
  }
  throw new Error("Markdown metadata must contain ordinary YAML values");
}

export function parseMarkdownDocument(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (new TextEncoder().encode(markdown).length > MAX_MARKDOWN_BYTES)
    throw new Error("Markdown file exceeds 512 KiB");
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    return { frontmatter: {}, body: normalized };
  const end = /^---[ \t]*$/gm;
  end.lastIndex = 4;
  const closing = end.exec(normalized);
  if (!closing) throw new Error("YAML front matter needs a closing --- line");
  const yaml = normalized.slice(4, closing.index);
  if (new TextEncoder().encode(yaml).length > MAX_FRONTMATTER_BYTES)
    throw new Error("YAML front matter exceeds 256 KiB");
  const parsed = parseDocument(yaml, {
    schema: "core",
    uniqueKeys: true,
    strict: true,
  });
  if (parsed.errors.length || parsed.warnings.length)
    throw new Error("Invalid YAML front matter");
  const metadata: unknown = parsed.toJS({ maxAliasCount: 0 });
  if (
    metadata !== null &&
    (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
  ) {
    throw new Error("YAML front matter must be a mapping");
  }
  const frontmatter = (metadata ?? {}) as Record<string, unknown>;
  validateMetadata(frontmatter);
  return {
    frontmatter,
    body: normalized
      .slice(closing.index + closing[0].length)
      .replace(/^\n/, ""),
  };
}

export function stringifyMarkdownDocument(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  validateMetadata(frontmatter);
  const markdown = `---\n${stringify(frontmatter, { aliasDuplicateObjects: false, lineWidth: 0 })}---\n${body}`;
  parseMarkdownDocument(markdown);
  return markdown;
}

export function markdownHeadingRange(body: string, heading: string) {
  const lines = body.match(/[^\n]*(?:\n|$)/g) ?? [];
  let offset = 0;
  let start: number | undefined;
  let contentStart = 0;
  let fence: string | undefined;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      offset += line.length;
      continue;
    }
    const match = !fence ? /^##\s+(.+?)\s*#*\s*$/.exec(line.trimEnd()) : null;
    if (match) {
      if (start !== undefined) return { start, contentStart, end: offset };
      if (match[1] === heading) {
        start = offset;
        contentStart = offset + line.length;
      }
    }
    offset += line.length;
  }
  return start === undefined ? null : { start, contentStart, end: body.length };
}

export function readMarkdownHeading(body: string, heading: string): string {
  const range = markdownHeadingRange(body, heading);
  return range ? body.slice(range.contentStart, range.end).trim() : "";
}

export function replaceMarkdownHeading(
  body: string,
  heading: string,
  content: string,
): string {
  const range = markdownHeadingRange(body, heading);
  if (!range)
    return content.trim()
      ? `${body.trimEnd()}${body.trim() ? "\n\n" : ""}## ${heading}\n\n${content.trim()}\n`
      : body;
  const replacement = content.trim()
    ? `## ${heading}\n\n${content.trim()}\n\n`
    : "";
  return `${body.slice(0, range.start)}${replacement}${body.slice(range.end)}`;
}
