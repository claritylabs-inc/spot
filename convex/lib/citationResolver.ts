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

type PageIndex = {
  spans: IndexedSpan[];
  /** Start offset (inclusive) of each span's text within `rawConcat`. */
  rawStarts: number[];
  /** End offset (exclusive) of each span's text within `rawConcat`. */
  rawEnds: number[];
  rawConcat: string;
  /** Normalized form of `rawConcat`. */
  normConcat: string;
  /** normMap[i] = index into `rawConcat` that normConcat[i] was derived from. */
  normMap: number[];
};

export type CitationIndex = {
  pages: Map<number, PageIndex>;
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

function spanSourceUnit(span: SourceSpanLike): string | undefined {
  if (typeof span.sourceUnit === "string") return span.sourceUnit;
  const metadataUnit = span.metadata?.sourceUnit;
  return typeof metadataUnit === "string" ? metadataUnit : undefined;
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

/**
 * Maps a single character to its normalized form: straight/curly quotes are
 * dropped, whitespace and other punctuation collapse to a single space, and
 * letters/digits lowercase. Returns undefined for characters that are dropped
 * entirely (quotes).
 */
function normalizeChar(ch: string): string | undefined {
  if (/[‘’‛′`'“”″"]/.test(ch)) return undefined;
  if (/\s/.test(ch)) return " ";
  const lower = ch.toLowerCase();
  if (/[\p{L}\p{N}]/u.test(lower)) return lower;
  return " ";
}

/**
 * Normalizes `raw` in a single pass, collapsing whitespace, stripping
 * punctuation/quotes, lowercasing, and joining hyphenated words split across
 * a line break (a hyphen immediately followed by whitespace is dropped along
 * with that whitespace). Returns the normalized text and, for each output
 * character, the index into `raw` it was derived from (so callers can map a
 * match in the normalized text back to a raw character range).
 */
function normalizeWithMap(raw: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // suppress leading whitespace
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const ch = raw[i];
    if (ch === "-") {
      let j = i + 1;
      let sawSpace = false;
      while (j < n && /\s/.test(raw[j])) {
        sawSpace = true;
        j += 1;
      }
      if (sawSpace) {
        i = j;
        continue;
      }
    }
    const mapped = normalizeChar(ch);
    if (mapped === undefined) {
      i += 1;
      continue;
    }
    if (mapped === " ") {
      if (!lastWasSpace) {
        out.push(" ");
        map.push(i);
        lastWasSpace = true;
      }
      i += 1;
      continue;
    }
    out.push(mapped);
    map.push(i);
    lastWasSpace = false;
    i += 1;
  }
  while (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

function normalizeQuote(raw: string): string {
  return normalizeWithMap(raw).text;
}

function buildPageIndex(spans: IndexedSpan[]): PageIndex {
  const rawStarts: number[] = [];
  const rawEnds: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  spans.forEach((entry, i) => {
    if (i > 0) {
      parts.push(" ");
      cursor += 1;
    }
    rawStarts.push(cursor);
    parts.push(entry.text);
    cursor += entry.text.length;
    rawEnds.push(cursor);
  });
  const rawConcat = parts.join("");
  const { text: normConcat, map: normMap } = normalizeWithMap(rawConcat);
  return { spans, rawStarts, rawEnds, rawConcat, normConcat, normMap };
}

export function buildCitationIndex(spans: SourceSpanLike[]): CitationIndex {
  const byPage = new Map<number, IndexedSpan[]>();
  for (const span of spans) {
    const range = spanPageRange(span);
    if (!range) continue;
    const indexed: IndexedSpan = { span, id: spanIdOf(span), text: span.text ?? "" };
    for (let page = range[0]; page <= range[1]; page += 1) {
      const list = byPage.get(page);
      if (list) list.push(indexed);
      else byPage.set(page, [indexed]);
    }
  }

  const pages = new Map<number, PageIndex>();
  for (const [page, pageSpans] of byPage) {
    const lineSpans = pageSpans.filter((entry) => spanSourceUnit(entry.span) === "line");
    pages.set(page, buildPageIndex(lineSpans.length > 0 ? lineSpans : pageSpans));
  }
  return { pages };
}

function spansOverlapping(page: PageIndex, start: number, end: number): IndexedSpan[] {
  const result: IndexedSpan[] = [];
  for (let i = 0; i < page.spans.length; i += 1) {
    if (page.rawStarts[i] < end && page.rawEnds[i] > start) result.push(page.spans[i]);
  }
  return result;
}

function bboxForMatch(spans: IndexedSpan[], page: number): CitationBox[] {
  return spans.flatMap((entry) => (entry.span.bbox ?? []).filter((box) => box.page === page));
}

function fullPageBbox(spans: IndexedSpan[], page: number): CitationBox[] {
  const boxes = spans.flatMap((entry) => (entry.span.bbox ?? []).filter((box) => box.page === page));
  if (boxes.length === 0) return [];
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return [{ page, x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
}

export function resolveCitationWithIndex(citation: SectionCitation, index: CitationIndex): ResolvedCitation {
  const page = index.pages.get(citation.page);
  if (!page || page.spans.length === 0) {
    return { ...citation, sourceSpanIds: [], bbox: [], match: "unresolved" };
  }

  const quote = citation.quote.trim();
  if (quote) {
    const exactPos = page.rawConcat.indexOf(quote);
    if (exactPos !== -1) {
      const matched = spansOverlapping(page, exactPos, exactPos + quote.length);
      return {
        ...citation,
        sourceSpanIds: matched.map((entry) => entry.id),
        bbox: bboxForMatch(matched, citation.page),
        match: "exact",
      };
    }

    const normalizedQuote = normalizeQuote(quote);
    if (normalizedQuote) {
      const normPos = page.normConcat.indexOf(normalizedQuote);
      if (normPos !== -1) {
        const rawStart = page.normMap[normPos];
        const rawEnd = page.normMap[normPos + normalizedQuote.length - 1] + 1;
        const matched = spansOverlapping(page, rawStart, rawEnd);
        return {
          ...citation,
          sourceSpanIds: matched.map((entry) => entry.id),
          bbox: bboxForMatch(matched, citation.page),
          match: "normalized",
        };
      }
    }
  }

  return {
    ...citation,
    sourceSpanIds: [],
    bbox: fullPageBbox(page.spans, citation.page),
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
