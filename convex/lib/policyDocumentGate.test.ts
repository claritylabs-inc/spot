import { describe, expect, it } from "vitest";
import { buildDocumentGateEvidence } from "./policyDocumentGate";

describe("document gate evidence coverage", () => {
  it("keeps complete later pages and text beyond the old opening snippets", () => {
    const sourceSpans = Array.from({ length: 12 }, (_, index) => ({
      pageStart: index + 1,
      text:
        index === 11
          ? `${"Quote history ".repeat(120)}BOUND POLICY DECLARATIONS`
          : "Cover letter",
    }));
    const evidence = buildDocumentGateEvidence(sourceSpans, 12);
    expect(evidence.complete).toBe(true);
    expect(evidence.text).toContain("BOUND POLICY DECLARATIONS");
    expect(evidence.text).toContain("Page 12:");
  });

  it("cannot reject when a PDF page is missing, blank, or only a section candidate", () => {
    for (const sourceSpans of [
      [],
      [{ pageStart: 1, text: "Quote" }],
      [
        { pageStart: 1, text: "Quote" },
        { pageStart: 2, text: " " },
      ],
      [
        { pageStart: 1, text: "Quote" },
        {
          pageStart: 2,
          text: "Declarations",
          metadata: { sourceUnit: "section_candidate" },
        },
      ],
    ]) {
      expect(buildDocumentGateEvidence(sourceSpans, 2)).toEqual({
        complete: false,
        text: "",
      });
    }
  });

  it("abstains instead of truncating a document beyond the evidence budget", () => {
    expect(
      buildDocumentGateEvidence(
        [{ pageStart: 1, text: "x".repeat(60_001) }],
        1,
      ),
    ).toEqual({ complete: false, text: "" });
  });
});
