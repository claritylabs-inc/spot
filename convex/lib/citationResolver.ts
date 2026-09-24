// Owner: P1 (docs/architecture/convex-section-extraction.md).
// Maps model citations ({ page, quote }) onto stored pdf.js source spans.

import type { SourceSpanLike } from "./sourceTree";

export type SectionCitation = {
  /** 1-based page number in the ORIGINAL PDF (not the section slice). */
  page: number;
  /** Short verbatim quote copied from the page. */
  quote: string;
};

export type CitationBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResolvedCitation = SectionCitation & {
  sourceSpanIds: string[];
  bbox: CitationBox[];
  /** exact: verbatim span match; normalized: whitespace/case/punctuation-insensitive; page_only: page exists but quote not located; unresolved: page not in document. */
  match: "exact" | "normalized" | "page_only" | "unresolved";
};

export function resolveCitation(
  _citation: SectionCitation,
  _spans: SourceSpanLike[],
): ResolvedCitation {
  throw new Error("resolveCitation: not implemented (P1)");
}

export function resolveCitations(
  citations: SectionCitation[],
  spans: SourceSpanLike[],
): ResolvedCitation[] {
  return citations.map((citation) => resolveCitation(citation, spans));
}
