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

type IndexedSpan = {
  span: SourceSpanLike;
  id: string;
  text: string;
};

export type CitationIndex = {
  pageSpans: Map<number, IndexedSpan[]>;
};

function fallbackId(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function spanIdOf(span: SourceSpanLike): string {
  return span.id ?? span.spanId ?? span.textHash ?? span.hash ?? fallbackId(span.text ?? "");
}

function spanPageRange(span: SourceSpanLike): [number, number] | undefined {
  const location =
    span.location && typeof span.location === "object" ? (span.location as Record<string, unknown>) : undefined;
  const start =
    span.pageStart ?? (typeof location?.page === "number" ? (location.page as number) : undefined) ??
    (typeof location?.startPage === "number" ? (location.startPage as number) : undefined);
  if (typeof start !== "number") return undefined;
  const end =
    span.pageEnd ?? (typeof location?.endPage === "number" ? (location.endPage as number) : undefined) ?? start;
  return [Math.min(start, end), Math.max(start, end)];
}

export function buildCitationIndex(spans: SourceSpanLike[]): CitationIndex {
  const pageSpans = new Map<number, IndexedSpan[]>();
  for (const span of spans) {
    const range = spanPageRange(span);
    if (!range) continue;
    const indexed: IndexedSpan = { span, id: spanIdOf(span), text: span.text ?? "" };
    for (let page = range[0]; page <= range[1]; page += 1) {
      const list = pageSpans.get(page);
      if (list) list.push(indexed);
      else pageSpans.set(page, [indexed]);
    }
  }
  return { pageSpans };
}

function normalizeForMatch(value: string): string {
  return value
    .replace(/[‘’‛′`']/g, "")
    .replace(/[“”″"]/g, "")
    .replace(/-\s+/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWindowMatch(
  pageSpans: IndexedSpan[],
  quote: string,
  normalize: (value: string) => string,
): IndexedSpan[] | undefined {
  const target = normalize(quote);
  if (!target) return undefined;
  const n = pageSpans.length;
  for (let size = 1; size <= n; size += 1) {
    for (let start = 0; start + size <= n; start += 1) {
      const window = pageSpans.slice(start, start + size);
      const combined = normalize(window.map((entry) => entry.text).join(" "));
      if (combined.includes(target)) return window;
    }
  }
  return undefined;
}

function bboxForMatch(spans: IndexedSpan[], page: number): CitationBox[] {
  return spans.flatMap((entry) => (entry.span.bbox ?? []).filter((box) => box.page === page));
}

function fullPageBbox(pageSpans: IndexedSpan[], page: number): CitationBox[] {
  const boxes = pageSpans.flatMap((entry) => (entry.span.bbox ?? []).filter((box) => box.page === page));
  if (boxes.length === 0) return [];
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return [{ page, x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
}

export function resolveCitationWithIndex(citation: SectionCitation, index: CitationIndex): ResolvedCitation {
  const pageSpans = index.pageSpans.get(citation.page);
  if (!pageSpans || pageSpans.length === 0) {
    return { ...citation, sourceSpanIds: [], bbox: [], match: "unresolved" };
  }

  const quote = citation.quote.trim();
  if (quote) {
    const exact = findWindowMatch(pageSpans, quote, (value) => value);
    if (exact) {
      return {
        ...citation,
        sourceSpanIds: exact.map((entry) => entry.id),
        bbox: bboxForMatch(exact, citation.page),
        match: "exact",
      };
    }

    const normalized = findWindowMatch(pageSpans, quote, normalizeForMatch);
    if (normalized) {
      return {
        ...citation,
        sourceSpanIds: normalized.map((entry) => entry.id),
        bbox: bboxForMatch(normalized, citation.page),
        match: "normalized",
      };
    }
  }

  return {
    ...citation,
    sourceSpanIds: [],
    bbox: fullPageBbox(pageSpans, citation.page),
    match: "page_only",
  };
}

export function resolveCitation(citation: SectionCitation, spans: SourceSpanLike[]): ResolvedCitation {
  return resolveCitationWithIndex(citation, buildCitationIndex(spans));
}

export function resolveCitations(
  citations: SectionCitation[],
  spans: SourceSpanLike[],
): ResolvedCitation[] {
  const index = buildCitationIndex(spans);
  return citations.map((citation) => resolveCitationWithIndex(citation, index));
}
