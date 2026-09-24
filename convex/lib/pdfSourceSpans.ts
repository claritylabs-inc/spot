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
      sourceChunks: chunkSpotSourceSpans(sourceSpans),
      pageCount: doc.numPages,
    };
  } catch (error) {
    console.warn(`PDF source span extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return { sourceSpans: [], sourceChunks: [], pageCount: 0 };
  }
}
