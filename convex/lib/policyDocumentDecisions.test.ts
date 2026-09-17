import { beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decidePolicyDocumentIntake } from "./policyDocumentDecisions";

const mocks = vi.hoisted(() => ({ pageCount: vi.fn(), decision: vi.fn() }));
vi.mock("@claritylabs/cl-sdk", () => ({ getPdfPageCount: mocks.pageCount }));
vi.mock("./decisions", () => ({ decideWithFallback: mocks.decision }));
const fallbackResult = {
  classification: "unknown" as const,
  shouldExtract: false,
  confidence: 0.5,
  reason: "Needs PDF interpretation",
  detectedTitle: null,
};
const fallback = vi.fn(async () => fallbackResult);
const base = {
  ctx: {} as ActionCtx,
  orgId: "org" as Id<"organizations">,
  pdfBytes: new Uint8Array(),
  fallback,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pageCount.mockResolvedValue(2);
});

test("missing page text cannot become a text-only intake decision", async () => {
  expect(
    await decidePolicyDocumentIntake({
      ...base,
      sourceSpans: [{ pageStart: 1, text: "Declaration page" }],
    }),
  ).toEqual(fallbackResult);
  expect(mocks.decision).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledOnce();
});

test("section excerpts cannot masquerade as full page coverage", async () => {
  await decidePolicyDocumentIntake({
    ...base,
    sourceSpans: [
      { pageStart: 1, text: "Declaration page" },
      {
        pageStart: 2,
        text: "Snippet",
        metadata: { sourceUnit: "section_candidate" },
      },
    ],
  });
  expect(mocks.decision).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledOnce();
});

test("uncertain document-status support retains PDF reasoning", async () => {
  mocks.decision.mockImplementation(async (options) => {
    const candidate = options.accept({
      artifact: {
        type: "choice",
        choice: "bound_policy_document",
        confidence: 1,
        probabilities: { bound_policy_document: 1 },
      },
      sufficient: { type: "noul", noul: 0.6 },
    });
    return candidate ?? options.fallback();
  });
  expect(
    await decidePolicyDocumentIntake({
      ...base,
      sourceSpans: [
        { pageStart: 1, text: "Declaration" },
        { pageStart: 2, text: "Terms" },
      ],
    }),
  ).toEqual(fallbackResult);
  expect(fallback).toHaveBeenCalledOnce();
});
