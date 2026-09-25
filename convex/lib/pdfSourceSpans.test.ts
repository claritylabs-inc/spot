import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";

import { buildPdfSourceSpans } from "./pdfSourceSpans";

async function buildMultiLinePdf(lines: string[]): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  const { width, height } = page.getSize();
  lines.forEach((line, index) => {
    page.drawText(line, { x: 50, y: height - 80 - index * 20, size: 12, font });
  });
  return { bytes: await pdf.save(), width, height };
}

describe("buildPdfSourceSpans line spans", () => {
  test("emits one line span per drawn line, with top-left-origin bbox within the page viewport", async () => {
    const lines = ["First line of text", "Second line of text", "Third line of text"];
    const { bytes, width, height } = await buildMultiLinePdf(lines);
    const { sourceSpans } = await buildPdfSourceSpans({ pdfBytes: bytes, documentId: "doc-lines" });

    const lineSpans = sourceSpans.filter((span) => span.sourceUnit === "line");
    expect(lineSpans).toHaveLength(lines.length);

    const pageSpan = sourceSpans.find((span) => span.sourceUnit === undefined);
    expect(pageSpan).toBeDefined();

    for (const span of lineSpans) {
      expect(span.parentSpanId).toBe(pageSpan?.id);
      expect(span.metadata?.sourceUnit).toBe("line");
      expect(span.metadata?.bboxCoordinateWidth).toBe(String(width));
      expect(span.metadata?.bboxCoordinateHeight).toBe(String(height));
      expect(span.bbox).toHaveLength(1);
      const box = span.bbox?.[0];
      expect(box?.page).toBe(1);
      // top-left origin: y grows downward, box must stay within the page viewport
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box?.y).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height + 1);
    }

    // Lines were drawn top-to-bottom, so their top-left-origin y offsets should increase.
    const ys = lineSpans.map((span) => span.bbox?.[0]?.y ?? 0);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);

    expect(lineSpans[0].text).toContain("First line of text");
    expect(lineSpans[1].text).toContain("Second line of text");
    expect(lineSpans[2].text).toContain("Third line of text");
  });

  test("does not duplicate line-span text into source chunks", async () => {
    const { bytes } = await buildMultiLinePdf(["Line one", "Line two"]);
    const { sourceSpans, sourceChunks } = await buildPdfSourceSpans({ pdfBytes: bytes, documentId: "doc-chunks" });

    const lineSpanIds = new Set(sourceSpans.filter((span) => span.sourceUnit === "line").map((span) => span.id));
    for (const chunk of sourceChunks) {
      for (const spanId of chunk.sourceSpanIds) {
        expect(lineSpanIds.has(spanId)).toBe(false);
      }
    }
  });

  test("returns no line spans for an image-only page", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const { sourceSpans } = await buildPdfSourceSpans({ pdfBytes: bytes, documentId: "doc-empty" });

    expect(sourceSpans.filter((span) => span.sourceUnit === "line")).toHaveLength(0);
  });
});
