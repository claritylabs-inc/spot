// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { PDFDocument, PDFOperator, PDFOperatorNames, StandardFonts } from "pdf-lib";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildPdfSourceSpans } from "./pdfSourceSpans";
import { decidePolicyDocumentIntake } from "./policyDocumentDecisions";

const mocks = vi.hoisted(() => ({ decision: vi.fn() }));
vi.mock("./decisions", () => ({ decideWithFallback: mocks.decision }));
const reasoningResult = {
  classification: "bound_policy_document" as const,
  shouldExtract: true,
  confidence: 0.94,
  reason: "PDF reasoning result",
  detectedTitle: "Policy declarations",
};
const fallback = vi.fn(async () => reasoningResult);
const base = {
  ctx: {} as ActionCtx,
  orgId: "org" as Id<"organizations">,
  fallback,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Even a purportedly certain text-only result must not replace PDF reasoning.
  mocks.decision.mockResolvedValue({ ...reasoningResult, confidence: 1 });
});

async function nativeTextPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText("Declarations: policy ABC123. Effective 2026-01-01.", {
    font: await pdf.embedFont(StandardFonts.Helvetica),
    x: 30,
    y: 700,
    size: 12,
  });
  return { pdf, page };
}

async function sourceSpans(pdfBytes: Uint8Array) {
  return (await buildPdfSourceSpans({ pdfBytes, documentId: "synthetic-intake" }))
    .sourceSpans;
}

test("mixed text and an omitted raster status stamp always retain PDF reasoning", async () => {
  const { pdf, page } = await nativeTextPdf();
  // Synthetic monochrome PNG reading: UNBOUND QUOTE - NOT COVERAGE.
  const stamp = await pdf.embedPng(
    "iVBORw0KGgoAAAANSUhEUgAAASwAAAAUAQMAAAAN7ZJCAAAABlBMVEX///8AAABVwtN+AAAACXBIWXMAAAsTAAALEwEAmpwYAAABCElEQVR4nOXRvUrDUBQH8JPkYG/gliTFIYPgsS3OKYhjvTe5Q4Y8RPMGjg4OvUmQO9mOPoaPcFNEfAw3ZzcnEYNiAg6dXDzzj//5Avg3xaeOTcrwFmKqgxfrNPEF2BavV2wUrHts5tw1MmY2JdOigIe0qCZRoxQPTT9tpv1KckY1bSUCqJbhAWuEOkzYoKn2XYmMNG1LBJjrT2aEQhoy+epKt2MnozWcacaR5VfFKQUDVvqu9L7StD3qmMjzJT0N2GJcScd8N+XdbJeicKm/Ak4jflOCWe2SWCIBzxhO4iRVWWjEDxs9Rm/FMtnY+fG4Dp6d5px7i3t632X+xv5yZ9zvHd5+7A/rA66gPcmVfO7aAAAAAElFTkSuQmCC",
  );
  page.drawImage(stamp, { x: 30, y: 620, width: 300, height: 20 });
  const pdfBytes = await pdf.save();
  const spans = await sourceSpans(pdfBytes);
  expect(spans).toHaveLength(1);
  expect(spans[0].text).toContain("Declarations");
  expect(spans[0].text).not.toContain("UNBOUND QUOTE");
  const rejection = {
    ...reasoningResult,
    classification: "insurance_related_but_not_bound_policy" as const,
    shouldExtract: false,
    reason: "PDF reasoning sees the raster quote stamp",
  };
  const pdfReasoning = vi.fn(async () => rejection);
  expect(
    await decidePolicyDocumentIntake({
      ...base,
      pdfBytes,
      sourceSpans: spans,
      fallback: pdfReasoning,
    }),
  ).toBe(rejection);
  expect(pdfReasoning).toHaveBeenCalledOnce();
  expect(mocks.decision).not.toHaveBeenCalled();
});

test("a native-text policy still succeeds through the established PDF reasoning path", async () => {
  const { pdf } = await nativeTextPdf();
  const pdfBytes = await pdf.save();
  const spans = await sourceSpans(pdfBytes);
  expect(spans[0].text).toContain("policy ABC123");
  expect(
    await decidePolicyDocumentIntake({ ...base, pdfBytes, sourceSpans: spans }),
  ).toBe(reasoningResult);
  expect(fallback).toHaveBeenCalledOnce();
  expect(mocks.decision).not.toHaveBeenCalled();
});

test("unsupported rendering content cannot become eligible through extracted page text", async () => {
  const { pdf, page } = await nativeTextPdf();
  page.pushOperators(
    PDFOperator.of("UnsupportedRenderingOperation" as PDFOperatorNames),
  );
  const pdfBytes = await pdf.save();
  const spans = await sourceSpans(pdfBytes);
  // PDF.js currently drops this command without failing extraction. Such output
  // is not a completeness certificate, even when every page has native text.
  expect(spans[0].text).toContain("Declarations");
  await decidePolicyDocumentIntake({ ...base, pdfBytes, sourceSpans: spans });
  expect(fallback).toHaveBeenCalledOnce();
  expect(mocks.decision).not.toHaveBeenCalled();
});

test("invalid bytes and caller coverage claims leave PDF failure handling authoritative", async () => {
  const failure = new Error("PDF reasoning could not read the document");
  const pdfReasoning = vi.fn(async () => {
    throw failure;
  });
  await expect(
    decidePolicyDocumentIntake({
      ...base,
      pdfBytes: new Uint8Array([0]),
      sourceSpans: [
        { pageStart: 1, text: "Bound policy", metadata: { complete: true } },
      ],
      fallback: pdfReasoning,
    }),
  ).rejects.toBe(failure);
  expect(pdfReasoning).toHaveBeenCalledOnce();
  expect(mocks.decision).not.toHaveBeenCalled();
});
