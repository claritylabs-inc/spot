import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";

import { extractPdfPlainText, extractPdfText } from "./pdfText";

async function buildPdf(pages: Array<string | undefined>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage();
    if (text) {
      page.drawText(text, { x: 50, y: page.getHeight() - 80, size: 12, font });
    }
  }
  return pdf.save();
}

describe("extractPdfText", () => {
  test("returns one page entry per page with joined text", async () => {
    const bytes = await buildPdf(["Hello world", "Second page text"]);
    const result = await extractPdfText({ pdfBytes: bytes, documentId: "doc-1" });

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].page).toBe(1);
    expect(result.pages[0].text).toContain("Hello world");
    expect(result.pages[1].page).toBe(2);
    expect(result.pages[1].text).toContain("Second page text");
    expect(result.text).toContain("Hello world");
    expect(result.text).toContain("Second page text");
    expect(result.textLayerMissing).toBe(false);
    expect(result.sourceSpans.length).toBeGreaterThan(0);
  });

  test("marks textLayerMissing when every page is empty (scanned/image-only PDF)", async () => {
    const bytes = await buildPdf([undefined, undefined]);
    const result = await extractPdfText({ pdfBytes: bytes, documentId: "doc-2" });

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.every((page) => page.text === "")).toBe(true);
    expect(result.textLayerMissing).toBe(true);
    expect(result.text).toBe("");
  });

  test("does not mark textLayerMissing when only some pages are empty", async () => {
    const bytes = await buildPdf(["Only page with text", undefined]);
    const result = await extractPdfText({ pdfBytes: bytes, documentId: "doc-3" });

    expect(result.pages[0].text).toContain("Only page with text");
    expect(result.pages[1].text).toBe("");
    expect(result.textLayerMissing).toBe(false);
  });
});

describe("extractPdfPlainText", () => {
  test("returns trimmed text bounded by maxChars", async () => {
    const bytes = await buildPdf(["Some policy text here"]);
    const text = await extractPdfPlainText({
      pdfBytes: bytes,
      documentId: "doc-4",
      maxChars: 5,
    });

    expect(text).not.toBeNull();
    expect(text?.length).toBe(5);
  });

  test("defaults maxChars to 40000", async () => {
    const longLine = "A".repeat(1000);
    const bytes = await buildPdf([longLine]);
    const text = await extractPdfPlainText({ pdfBytes: bytes, documentId: "doc-5" });

    expect(text?.length).toBeLessThanOrEqual(40_000);
  });

  test("returns null for an image-only PDF with no extractable text", async () => {
    const bytes = await buildPdf([undefined]);
    const text = await extractPdfPlainText({ pdfBytes: bytes, documentId: "doc-6" });

    expect(text).toBeNull();
  });
});
