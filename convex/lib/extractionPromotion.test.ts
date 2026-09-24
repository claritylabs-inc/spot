import { describe, expect, test } from "vitest";
import { buildDocumentSourceTree, buildSourceSpan } from "@claritylabs/cl-sdk";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  evaluateExtractionPromotion,
  sectionPageCoverageReasons,
  sectionResultArtifactReasons,
  type PromotionEvidenceLedger,
} from "./extractionPromotion";

function evidence(texts: string[]) {
  const sourceSpans = texts.map((text, index) => buildSourceSpan({
    documentId: "policy-1",
    sourceKind: "policy_pdf",
    text,
    pageStart: index + 1,
    pageEnd: index + 1,
    sourceUnit: "text",
  }, index));
  return {
    sourceSpans,
    sourceTree: buildDocumentSourceTree(sourceSpans, "policy-1"),
  };
}

function sectionsManifest(
  source: ReturnType<typeof evidence>,
  ledger: PromotionEvidenceLedger,
  sections: Array<{ id: string; pageStart: number; pageEnd: number }>,
  pageCount = source.sourceSpans.length,
) {
  return buildExtractionCompletionManifest({
    extractorVersion: "test",
    ledger,
    pageCount,
    sectionPlanHash: "plan-1",
    sections: sections.map((section) => ({
      ...section,
      kind: "declarations",
      sourceSpanIds: source.sourceSpans
        .filter((span) =>
          span.pageStart! >= section.pageStart && span.pageStart! <= section.pageEnd)
        .map((span) => span.id),
      resultHash: `result-${section.id}`,
    })),
  });
}

describe("extraction promotion evidence", () => {
  test("model-reported absence cannot override detected evidence", () => {
    const source = evidence([
      "Policy Number: GL-100",
      "Named Insured: Example Corp.",
      "Insurer: Example Insurance Company",
      "Effective Date: 01/01/2026",
      "Expiration Date: 01/01/2027",
      "General Liability Coverage Limit $1,000,000",
    ]);
    const ledger = buildPromotionEvidenceLedger(source);
    const manifest = sectionsManifest(source, ledger, [
      { id: "declarations-1-6", pageStart: 1, pageEnd: 6 },
    ]);

    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: { coverages: [] },
      hasValidCarrierIdentity: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "policy_number evidence is present but the extracted profile omitted a cited value",
    );
    expect(decision.reasons).toContain(
      "carrier evidence is present without a valid carrier identity",
    );
    expect(decision.reasons).toContain(
      "coverage evidence is present but the extracted profile has no coverage rows",
    );
  });

  test("a citation must point to the detected candidate evidence", () => {
    const source = evidence([
      "Policy Number: GL-100",
      "Unrelated administrative wording.",
    ]);
    const ledger = buildPromotionEvidenceLedger(source);
    const manifest = sectionsManifest(source, ledger, [
      { id: "declarations-1-2", pageStart: 1, pageEnd: 2 },
    ]);

    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: {
        policyNumber: {
          value: "MODEL-INVENTED",
          sourceSpanIds: [source.sourceSpans[1]!.id],
        },
        coverages: [],
      },
      hasValidCarrierIdentity: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "policy_number evidence is present but the extracted profile omitted a cited value",
    );
  });
});

describe("convex-sections-v1 promotion", () => {
  const source = evidence([
    "Policy Number: GL-100",
    "Property Coverage Limit $1,000,000",
    "Unclassified policy wording.",
  ]);
  const ledger = buildPromotionEvidenceLedger(source);
  const citedProfile = {
    policyNumber: {
      value: "GL-100",
      sourceSpanIds: [source.sourceSpans[0]!.id],
    },
    coverages: [{
      name: "Property",
      sourceSpanIds: [source.sourceSpans[1]!.id],
    }],
  };
  const evaluate = (sections: Array<{ id: string; pageStart: number; pageEnd: number }>) =>
    evaluateExtractionPromotion({
      manifest: sectionsManifest(source, ledger, sections),
      ledger,
      operationalProfile: citedProfile,
      hasValidCarrierIdentity: true,
    });

  test("promotes when every page belongs to exactly one section", () => {
    const decision = evaluate([
      { id: "declarations-1-1", pageStart: 1, pageEnd: 1 },
      { id: "coverage_form-2-3", pageStart: 2, pageEnd: 3 },
    ]);

    expect(decision.reasons).toEqual([]);
    expect(decision.allowed).toBe(true);
  });

  test("blocks a manifest with an unassigned page", () => {
    const decision = evaluate([
      { id: "declarations-1-1", pageStart: 1, pageEnd: 1 },
      { id: "coverage_form-3-3", pageStart: 3, pageEnd: 3 },
    ]);

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("pages 2 are not assigned to a section");
    expect(decision.reasons).toContain("source coverage is incomplete");
  });

  test("blocks a manifest that assigns a page twice", () => {
    const decision = evaluate([
      { id: "declarations-1-2", pageStart: 1, pageEnd: 2 },
      { id: "coverage_form-2-3", pageStart: 2, pageEnd: 3 },
    ]);

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain(
      "pages 2 are assigned to more than one section",
    );
  });

  test("rejects out-of-range sections and a missing page count", () => {
    expect(sectionPageCoverageReasons({
      pageCount: 2,
      sections: [
        { id: "declarations-1-1", pageStart: 1, pageEnd: 1 },
        { id: "other-2-4", pageStart: 2, pageEnd: 4 },
      ],
    })).toEqual([
      "section other-2-4 has an invalid page range",
      "pages 2 are not assigned to a section",
    ]);
    expect(sectionPageCoverageReasons({ sections: [] })).toEqual([
      "section manifest has no valid page count",
    ]);
  });

  test("requires a persisted, succeeded section_result for every section", () => {
    const manifest = sectionsManifest(source, ledger, [
      { id: "declarations-1-1", pageStart: 1, pageEnd: 1 },
      { id: "coverage_form-2-3", pageStart: 2, pageEnd: 3 },
    ]);
    const artifacts = manifest.sections.map((section) => ({
      runId: "run-1",
      sectionId: section.id,
      sourceFingerprint: manifest.sourceFingerprint,
      extractorVersion: manifest.extractorVersion,
      metadata: {
        status: "succeeded",
        planHash: "plan-1",
        resultHash: section.resultHash,
      },
    }));
    const [declarations, coverageForm] = artifacts;

    expect(sectionResultArtifactReasons({ manifest, runId: "run-1", artifacts }))
      .toEqual([]);
    expect(sectionResultArtifactReasons({
      manifest,
      runId: "run-1",
      artifacts: [coverageForm!],
    })).toEqual(["section declarations-1-1 has no persisted successful result"]);
    expect(sectionResultArtifactReasons({
      manifest,
      runId: "run-1",
      artifacts: [
        { ...declarations!, metadata: { ...declarations!.metadata, status: "failed" } },
        coverageForm!,
      ],
    })).toEqual(["section declarations-1-1 has no persisted successful result"]);
    expect(sectionResultArtifactReasons({
      manifest,
      runId: "run-1",
      artifacts: [
        declarations!,
        { ...coverageForm!, metadata: { ...coverageForm!.metadata, resultHash: "other" } },
      ],
    })).toEqual(["section coverage_form-2-3 has no persisted successful result"]);
    expect(sectionResultArtifactReasons({ manifest, runId: "run-2", artifacts }))
      .toHaveLength(2);
  });
});
