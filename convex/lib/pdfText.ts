"use node";

// Owner: P1 (docs/architecture/convex-section-extraction.md).
// Convex-native pdf.js text layer for every PDF consumer. Replaces the worker's
// LiteParse conversion endpoint.

import type {
  SpotSourceChunk,
  SpotSourceKind,
  SpotSourceSpan,
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

export async function extractPdfText(_params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SpotSourceKind;
}): Promise<PdfTextResult> {
  throw new Error("extractPdfText: not implemented (P1)");
}

/** Bounded plain-text helper for callers that only need text. Null when empty. */
export async function extractPdfPlainText(_params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SpotSourceKind;
  maxChars?: number;
}): Promise<string | null> {
  throw new Error("extractPdfPlainText: not implemented (P1)");
}
