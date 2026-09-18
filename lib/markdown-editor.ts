import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseMarkdownDocument } from "@/convex/lib/markdownDocument";

const parser = unified().use(remarkParse).use(remarkGfm);

export function editorFrontmatterRange(markdown: string) {
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(markdown);
  if (!opening) return null;
  const closing = /^---[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(markdown);
  return match
    ? {
        yamlStart: opening[0].length,
        closingStart: match.index,
        bodyStart: match.index + match[0].length,
      }
    : null;
}

/** Keep the original YAML, comments, delimiters, and line endings on prose edits. */
export function splitEditorMarkdown(markdown: string) {
  let frontmatter: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    frontmatter = parseMarkdownDocument(markdown).frontmatter;
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Invalid Markdown document";
  }
  const range = editorFrontmatterRange(markdown);
  if (!range)
    return { prefix: "", yaml: "", body: markdown, frontmatter, error };
  return {
    prefix: markdown.slice(0, range.bodyStart),
    yaml: markdown.slice(range.yamlStart, range.closingStart),
    body: markdown.slice(range.bodyStart),
    frontmatter,
    error,
  };
}

export function replaceEditorBody(markdown: string, body: string) {
  const { prefix } = splitEditorMarkdown(markdown);
  return prefix + (prefix && !prefix.endsWith("\n") ? "\n" : "") + body;
}

/** Formatting may change; authored meaning must survive the rich-text conversion. */
export function equivalentMarkdown(left: string, right: string) {
  const canonical = (value: string) =>
    JSON.stringify(parser.parse(value), (key, item) =>
      key === "position" || key === "spread" ? undefined : item,
    );
  return canonical(left) === canonical(right);
}
