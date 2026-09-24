"use node";

// Owner: P1 (docs/architecture/convex-section-extraction.md).
// Convex-native pdf.js text layer for every PDF consumer. Replaces the worker's
// LiteParse conversion endpoint.

import {
  buildPdfSourceSpans,
  type SpotSourceChunk,
  type SpotSourceKind,
  type SpotSourceSpan,
} from "./pdfSourceSpans";

export type PdfPageText = {
  /** 1-based page number in the original PDF. */
  page: number;
  text: string;
};

export type PdfTextResult = {
  pageCount: number;
  /** Full document text, pages joined in order. */
  text: string;
  pages: PdfPageText[];
  sourceSpans: SpotSourceSpan[];
  sourceChunks: SpotSourceChunk[];
  /** True when no page produced usable text (scanned/image-only PDF). */
  textLayerMissing: boolean;
  parsedAt: number;
  parsingMs: number;
};

export async function extractPdfText(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SpotSourceKind;
}): Promise<PdfTextResult> {
  const startedAt = Date.now();
  const pages: PdfPageText[] = [];
  const { sourceSpans, sourceChunks, pageCount } = await buildPdfSourceSpans({
    pdfBytes: params.pdfBytes,
    documentId: params.documentId,
    sourceKind: params.sourceKind ?? "policy_pdf",
    onPageText: (page, text) => {
      pages.push({ page, text: text.trim() });
    },
  });
  const textLayerMissing = pages.every((page) => !page.text);
  const text = pages
    .map((page) => page.text)
    .filter(Boolean)
    .join("\n\n");
  return {
    pageCount,
    text,
    pages,
    sourceSpans,
    sourceChunks,
    textLayerMissing,
    parsedAt: Date.now(),
    parsingMs: Date.now() - startedAt,
  };
}

/** Bounded plain-text helper for callers that only need text. Null when empty. */
export async function extractPdfPlainText(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SpotSourceKind;
  maxChars?: number;
}): Promise<string | null> {
  const result = await extractPdfText(params);
  const text = result.text.trim();
  if (!text) return null;
  const maxChars = params.maxChars ?? 40_000;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
