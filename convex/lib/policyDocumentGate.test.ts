import { describe, expect, it } from "vitest";
import {
  isSpecimenPolicyDocument,
  buildDocumentGateEvidence,
} from "./policyDocumentGate";

describe("isSpecimenPolicyDocument", () => {
  it("accepts a specimen marker and disclaimer split across source spans", () => {
    expect(
      isSpecimenPolicyDocument([
        { text: "Saint Lawrence Specialty Insurance Company" },
        { text: "Policy form: Specimen Insurance Policy" },
        { text: "NOT AN ACTUAL POLICY OR EVIDENCE OF INSURANCE" },
      ]),
    ).toBe(true);
  });

  it("does not treat an ordinary policy or a passing mention as a specimen fixture", () => {
    expect(
      isSpecimenPolicyDocument([
        { text: "COMMERCIAL GENERAL LIABILITY POLICY" },
      ]),
    ).toBe(false);
    expect(
      isSpecimenPolicyDocument([
        { text: "Contact underwriting to request a specimen policy." },
      ]),
    ).toBe(false);
  });
});

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
