import { z } from "zod";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./markdownDocument";

const wikiMetadataSchema = z.object({
  manual: z.boolean().optional(),
  protectedHeadings: z.array(z.string()).optional(),
  contributions: z
    .record(
      z.string(),
      z.object({ lines: z.array(z.string()), sources: z.array(z.string()) }),
    )
    .optional(),
  proposals: z
    .record(z.string(), z.object({ body: z.string(), rationale: z.string() }))
    .optional(),
});
export type WikiMetadata = z.infer<typeof wikiMetadataSchema>;

export function readWikiDocument(markdown: string) {
  const parsed = parseMarkdownDocument(markdown);
  const metadata = wikiMetadataSchema.parse(parsed.frontmatter._spot ?? {});
  return { ...parsed, metadata };
}

export function renderWikiDocument(
  body: string,
  metadata: WikiMetadata = {},
  frontmatter: Record<string, unknown> = {},
) {
  return stringifyMarkdownDocument(
    {
      ...frontmatter,
      title: frontmatter.title ?? "Company wiki",
      _spot: metadata,
    },
    body,
  );
}

export function manualWikiDocument(markdown: string) {
  const { frontmatter, body } = parseMarkdownDocument(markdown);
  return renderWikiDocument(body, { manual: true }, frontmatter);
}
