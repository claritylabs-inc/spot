"use node";

import { createHash } from "crypto";

export type SpotSourceKind = "policy_pdf" | "email" | "attachment" | "manual_note";

export interface SpotSourceSpan {
  id: string;
  documentId: string;
  sourceKind: SpotSourceKind;
  kind: "pdf_text" | "plain_text";
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  text: string;
  textHash: string;
  hash: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  location?: {
    page?: number;
    startPage?: number;
    endPage?: number;
    fieldPath?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SpotSourceChunk {
  id: string;
  documentId: string;
  sourceSpanIds: string[];
  text: string;
  textHash: string;
  pageStart?: number;
  pageEnd?: number;
  metadata?: Record<string, string>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(normalizeWhitespace(value).toLowerCase()).digest("hex");
}

function idPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function buildSpan(input: {
  documentId: string;
  sourceKind: SpotSourceKind;
  pageNumber?: number;
  text: string;
  index: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  metadata?: Record<string, string>;
}): SpotSourceSpan | undefined {
  const text = normalizeWhitespace(input.text);
  if (!text) return undefined;
  const textHash = hashText(text);
  const pagePart = input.pageNumber ?? "na";
  return {
    id: `${idPart(input.documentId)}:span:${pagePart}:${input.index}:${textHash.slice(0, 12)}`,
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    kind: input.sourceKind.endsWith("_pdf") ? "pdf_text" : "plain_text",
    pageStart: input.pageNumber,
    pageEnd: input.pageNumber,
    sectionId: input.sectionId,
    formNumber: input.formNumber,
    sourceUnit: input.sourceUnit,
    parentSpanId: input.parentSpanId,
    bbox: input.bbox,
    text,
    textHash,
    hash: textHash,
    location: {
      page: input.pageNumber,
      startPage: input.pageNumber,
      endPage: input.pageNumber,
      fieldPath: input.sectionId,
    },
    metadata: input.metadata,
  };
}

type PdfLineItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
};

const LINE_BASELINE_TOLERANCE = 2;

type LineBox = { x: number; y: number; width: number; height: number };

function itemBboxTopLeft(item: PdfLineItem, viewportHeight: number): LineBox {
  const height = item.height || Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || 10;
  const baseline = item.transform[5] ?? 0;
  const x = item.transform[4] ?? 0;
  const width = item.width || 0;
  return { x, y: viewportHeight - (baseline + height), width, height };
}

function unionLineBox(boxes: LineBox[]): LineBox {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: maxX - x, height: maxY - y };
}

/**
 * Groups pdf.js text items into visual lines using `hasEOL` plus baseline
 * proximity (items are already in reading order), then converts each line's
 * bbox from pdf.js's bottom-left origin to top-left origin via `viewportHeight`.
 */
function groupItemsIntoLines(
  items: PdfLineItem[],
  viewportHeight: number,
): Array<{ text: string; bbox: LineBox }> {
  const lines: PdfLineItem[][] = [];
  let current: PdfLineItem[] = [];
  let currentBaseline: number | undefined;

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL && current.length > 0) {
        lines.push(current);
        current = [];
        currentBaseline = undefined;
      }
      continue;
    }
    const baseline = item.transform[5] ?? 0;
    if (current.length > 0 && currentBaseline !== undefined && Math.abs(baseline - currentBaseline) > LINE_BASELINE_TOLERANCE) {
      lines.push(current);
      current = [];
    }
    current.push(item);
    currentBaseline = baseline;
    if (item.hasEOL) {
      lines.push(current);
      current = [];
      currentBaseline = undefined;
    }
  }
  if (current.length > 0) lines.push(current);

  const result: Array<{ text: string; bbox: LineBox }> = [];
  for (const lineItems of lines) {
    const text = normalizeWhitespace(lineItems.map((item) => item.str).join(" "));
    if (!text) continue;
    result.push({ text, bbox: unionLineBox(lineItems.map((item) => itemBboxTopLeft(item, viewportHeight))) });
  }
  return result;
}

function splitPageIntoSectionCandidates(text: string): Array<{ title: string; text: string; formNumber?: string }> {
  const headingPattern = /^(?:SECTION|COVERAGE|EXCLUSION|EXCLUSIONS|CONDITION|CONDITIONS|ENDORSEMENT|ENDORSEMENTS|DEFINITION|DEFINITIONS|DECLARATIONS?|SCHEDULE|FORM)\b[\s:.-]*(.*)$/i;
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (headingPattern.test(line)) {
      if (current) sections.push(current);
      current = { title: normalizeWhitespace(line).slice(0, 120), lines: [line] };
      continue;
    }
    current?.lines.push(rawLine);
  }
  if (current) sections.push(current);

  return sections
    .map((section) => {
      const sectionText = normalizeWhitespace(section.lines.join("\n"));
      return {
        title: section.title,
        text: sectionText,
        formNumber: sectionText.match(/\b[A-Z]{2,8}\s+\d{2,5}(?:\s+\d{2,4})?\b/)?.[0],
      };
    })
    .filter((section) => section.text.length >= 120);
}

export function chunkSpotSourceSpans(
  sourceSpans: SpotSourceSpan[],
  maxChars = 6000,
): SpotSourceChunk[] {
  const chunks: SpotSourceChunk[] = [];
  let current: SpotSourceSpan[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((span) => span.text).join("\n\n");
    const textHash = hashText(text);
    chunks.push({
      id: `${idPart(current[0].documentId)}:source_chunk:${chunks.length}:${hashText(current.map((span) => span.id).join("|")).slice(0, 12)}`,
      documentId: current[0].documentId,
      sourceSpanIds: current.map((span) => span.id),
      text,
      textHash,
      pageStart: current.find((span) => typeof span.pageStart === "number")?.pageStart,
      pageEnd: [...current].reverse().find((span) => typeof span.pageEnd === "number")?.pageEnd,
    });
    current = [];
    currentLength = 0;
  };

  for (const span of sourceSpans) {
    const nextLength = currentLength + span.text.length + (current.length > 0 ? 2 : 0);
    if (current.length > 0 && nextLength > maxChars) flush();
    current.push(span);
    currentLength += span.text.length + (current.length > 1 ? 2 : 0);
  }
  flush();

  return chunks;
}

export async function buildPdfSourceSpans(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SpotSourceKind;
  /** Invoked once per page with the raw extracted text, in page order. */
  onPageText?: (page: number, text: string) => void;
}): Promise<{ sourceSpans: SpotSourceSpan[]; sourceChunks: SpotSourceChunk[]; pageCount: number }> {
  try {
    const { getDocument, VerbosityLevel } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(params.pdfBytes),
      isEvalSupported: false,
      useWasm: false,
      useSystemFonts: true,
      verbosity: VerbosityLevel.ERRORS,
    });
    const doc = await loadingTask.promise;
    const sourceSpans: SpotSourceSpan[] = [];

    try {
      for (let index = 0; index < doc.numPages; index += 1) {
        const pageNumber = index + 1;
        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => {
            if (!("str" in item)) return "";
            return `${item.str}${item.hasEOL ? "\n" : " "}`;
          })
          .join("");
        params.onPageText?.(pageNumber, text);
        const span = buildSpan({
          documentId: params.documentId,
          sourceKind: params.sourceKind ?? "policy_pdf",
          pageNumber,
          text,
          index,
        });
        if (span) sourceSpans.push(span);

        const viewport = page.getViewport({ scale: 1 });
        const lineItems: PdfLineItem[] = textContent.items.flatMap((item) =>
          "str" in item ? [item as unknown as PdfLineItem] : [],
        );
        for (const line of groupItemsIntoLines(lineItems, viewport.height)) {
          const lineSpan = buildSpan({
            documentId: params.documentId,
            sourceKind: params.sourceKind ?? "policy_pdf",
            pageNumber,
            text: line.text,
            index: sourceSpans.length,
            sourceUnit: "line",
            parentSpanId: span?.id,
            bbox: [{ page: pageNumber, ...line.bbox }],
            metadata: {
              sourceUnit: "line",
              bboxCoordinateWidth: String(viewport.width),
              bboxCoordinateHeight: String(viewport.height),
            },
          });
          if (lineSpan) sourceSpans.push(lineSpan);
        }

        for (const section of splitPageIntoSectionCandidates(text)) {
          const sectionSpan = buildSpan({
            documentId: params.documentId,
            sourceKind: params.sourceKind ?? "policy_pdf",
            pageNumber,
            text: section.text,
            sectionId: section.title,
            formNumber: section.formNumber,
            metadata: { sourceUnit: "section_candidate" },
            index: sourceSpans.length,
          });
          if (sectionSpan) sourceSpans.push(sectionSpan);
        }
        page.cleanup();
      }
    } finally {
      await doc.destroy();
    }

    return {
      sourceSpans,
      sourceChunks: chunkSpotSourceSpans(sourceSpans.filter((entry) => entry.sourceUnit !== "line")),
      pageCount: doc.numPages,
    };
  } catch (error) {
    console.warn(`PDF source span extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return { sourceSpans: [], sourceChunks: [], pageCount: 0 };
  }
}
