import { describe, expect, test } from "vitest";
import type { PolicySection } from "../policySectioning";
import { normalizeSourceTree, type DocumentSourceNode, type SourceSpanLike } from "../sourceTree";
import {
  declarationsPreviewFields,
  mergeSectionResults,
  modelTranscriptionSpans,
  type SectionResult,
} from "./merge";
import type {
  CitedValue,
  DeclarationsSectionOutput,
  EndorsementSectionOutput,
  InvoiceSectionOutput,
  ScheduleSectionOutput,
  SectionCoverage,
} from "./schemas";

function span(id: string, page: number, text: string, sourceUnit = "line"): SourceSpanLike {
  return { id, documentId: "policy-1", sourceKind: "policy_pdf", pageStart: page, pageEnd: page, sourceUnit, text };
}

const spans = [
  span("p1", 1, "DECLARATIONS", "page"),
  span("d-policy", 1, "Policy Number: GL-100"),
  span("d-insured", 1, "Named Insured: Acme Corp, 1 Main St, Springfield, IL 62701"),
  span("d-carrier", 1, "Insurer: Example Insurance Company"),
  span("d-period", 1, "Policy Period: 01/01/2026 to 01/01/2027"),
  span("d-gl", 1, "General Liability Each Occurrence $1,000,000"),
  span("d-auto", 1, "Hired Auto Liability $500,000"),
  span("d-building", 1, "Building $500,000"),
  span("d-premium", 1, "Total Premium $1,000"),
  span("p2", 2, "SCHEDULE", "page"),
  span("s-vehicle", 2, "1 2022 Ford F-150 VIN 1FTFW1E50NFA00001"),
  span("s-building", 2, "Building $750,000"),
  span("s-income", 2, "Business Income $100,000"),
  span("p3", 3, "ENDORSEMENT", "page"),
  span("e-summary", 3, "THIS ENDORSEMENT CHANGES THE POLICY"),
  span("e-ai", 3, "Additional Insured: Blue Co"),
  span("e-gl", 3, "Each Occurrence limit is amended to $2,000,000"),
  span("e-remove", 3, "Hired Auto Liability coverage is deleted"),
  span("e-ani", 3, "Named Insured includes Acme Holdings LLC"),
  span("p4", 4, "INVOICE", "page"),
  span("i-premium", 4, "Policy Premium $1,200"),
  span("i-fee", 4, "Policy Fee $25"),
];

const sourceTree = [
  {
    id: "root",
    documentId: "policy-1",
    kind: "document",
    title: "Document",
    description: "Document",
    sourceSpanIds: spans.map((item) => item.id!),
    order: 0,
    path: "1",
  },
  ...spans.map((item, index) => ({
    id: `node-${item.id}`,
    documentId: "policy-1",
    parentId: "root",
    kind: "text",
    title: item.text!,
    description: item.text!,
    sourceSpanIds: [item.id!],
    order: index + 1,
    path: `1.${index + 1}`,
  })),
] as DocumentSourceNode[];

function cited(value: string, page: number, quote = value): CitedValue {
  return { value, citations: [{ page, quote }] };
}

function coverage(overrides: Partial<SectionCoverage> & Pick<SectionCoverage, "name">): SectionCoverage {
  return {
    lineOfBusiness: null,
    coverageCode: null,
    limit: null,
    deductible: null,
    premium: null,
    retroactiveDate: null,
    formNumber: null,
    limits: [],
    citations: [],
    ...overrides,
  };
}

function sectionFor(kind: PolicySection["kind"], page: number): PolicySection {
  return { sectionId: `${kind}-${page}-${page}`, kind, pageStart: page, pageEnd: page, confidence: 1 };
}

const declarations: DeclarationsSectionOutput = {
  policyNumber: cited("GL-100", 1, "Policy Number: GL-100"),
  namedInsured: cited("Acme Corp", 1, "Named Insured: Acme Corp"),
  insurer: cited("Example Insurance Company", 1, "Insurer: Example Insurance Company"),
  // Page 9 is outside the declarations slice, so this citation cannot resolve.
  broker: cited("Ghost Agency", 9),
  effectiveDate: cited("01/01/2026", 1),
  expirationDate: cited("01/01/2027", 1),
  retroactiveDate: null,
  programName: null,
  operationsDescription: null,
  premium: null,
  totalCost: null,
  premiumBreakdown: [],
  taxesAndFees: [],
  linesOfBusiness: ["CGL"],
  parties: [
    {
      role: "named_insured",
      name: "Acme Corp",
      address: { street1: "1 Main St", street2: null, city: "Springfield", state: "IL", zip: "62701", country: null },
      naicNumber: null,
      licenseNumber: null,
      citations: [{ page: 1, quote: "Named Insured: Acme Corp" }],
    },
  ],
  insuredDetails: [],
  coverages: [
    coverage({
      name: "General Liability",
      lineOfBusiness: "CGL",
      limit: "$1,000,000",
      limits: [
        {
          kind: "each_occurrence_limit",
          label: "Each Occurrence",
          value: "$1,000,000",
          appliesTo: null,
          citations: [{ page: 1, quote: "Each Occurrence $1,000,000" }],
        },
      ],
      citations: [{ page: 1, quote: "General Liability" }],
    }),
    coverage({
      name: "Hired Auto Liability",
      limit: "$500,000",
      citations: [{ page: 1, quote: "Hired Auto Liability $500,000" }],
    }),
    coverage({
      name: "Building",
      limit: "$500,000",
      citations: [{ page: 1, quote: "Building $500,000" }],
    }),
  ],
  forms: [],
};

const schedule: ScheduleSectionOutput = {
  schedules: [
    {
      name: "Vehicle Schedule",
      kind: "vehicle",
      description: null,
      items: [
        {
          label: "1",
          description: null,
          values: [
            { label: "Year", value: "2022" },
            { label: "Make", value: "Ford" },
            { label: "Model", value: "F-150" },
            { label: "VIN", value: "1FTFW1E50NFA00001" },
          ],
          // Slice-relative page 1 is original page 2.
          citations: [{ page: 1, quote: "2022 Ford F-150" }],
        },
      ],
    },
  ],
  coverages: [
    coverage({ name: "Building", limit: "$750,000", citations: [{ page: 2, quote: "Building $750,000" }] }),
    coverage({
      name: "Business Income",
      limit: "$100,000",
      citations: [{ page: 2, quote: "Business Income $100,000" }],
    }),
  ],
};

const endorsement: EndorsementSectionOutput = {
  endorsements: [
    {
      formNumber: "CG 20 10",
      editionDate: "04 13",
      title: "Additional Insured",
      endorsementNumber: "3",
      endorsementType: "additional_insured",
      supportStatus: "supported",
      summary: "Adds Blue Co as an additional insured and raises the occurrence limit.",
      citations: [{ page: 3, quote: "THIS ENDORSEMENT CHANGES THE POLICY" }],
      effectiveDate: null,
      coverageChanges: [
        {
          action: "modified",
          coverage: coverage({
            name: "General Liability",
            limit: "$2,000,000",
            limits: [
              {
                kind: "each_occurrence_limit",
                label: "Each Occurrence",
                value: "$2,000,000",
                appliesTo: null,
                citations: [{ page: 3, quote: "amended to $2,000,000" }],
              },
            ],
          }),
        },
        {
          action: "removed",
          coverage: coverage({
            name: "Hired Auto Liability",
            citations: [{ page: 3, quote: "Hired Auto Liability coverage is deleted" }],
          }),
        },
      ],
      partyChanges: [
        {
          action: "added",
          role: "additional_insured",
          name: "Blue Co",
          address: null,
          scope: "Ongoing operations",
          citations: [{ page: 3, quote: "Additional Insured: Blue Co" }],
        },
        {
          action: "added",
          role: "additional_named_insured",
          name: "Acme Holdings LLC",
          address: null,
          scope: null,
          citations: [{ page: 3, quote: "Acme Holdings LLC" }],
        },
      ],
      dateChanges: [],
      premiumChange: null,
    },
  ],
};

const invoice: InvoiceSectionOutput = {
  title: "Invoice",
  summary: "Invoice for the annual premium.",
  citations: [{ page: 4, quote: "Policy Premium $1,200" }],
  premium: cited("$1,200", 4, "Policy Premium $1,200"),
  taxesAndFees: [{ name: "Policy Fee", amount: "$25", type: "fee", citations: [{ page: 4, quote: "Policy Fee $25" }] }],
  totalCost: null,
  amountDue: null,
  dueDate: null,
};

function merge(results: SectionResult[]) {
  return mergeSectionResults({ policyId: "policy-1", results, sourceSpans: spans, sourceTree });
}

const allSections: SectionResult[] = [
  { kind: "declarations", section: sectionFor("declarations", 1), output: declarations },
  { kind: "schedule", section: sectionFor("schedule", 2), output: schedule },
  { kind: "endorsement", section: { ...sectionFor("endorsement", 3), formNumber: "CG 20 10" }, output: endorsement },
  { kind: "invoice", section: sectionFor("invoice", 4), output: invoice },
];

function coverageNamed(rows: Array<Record<string, unknown>>, name: string) {
  return rows.find((row) => row.name === name);
}

describe("section merge", () => {
  test("wires citations to source spans and nodes and drops uncited facts", () => {
    const merged = merge(allSections);
    const profile = merged.operationalProfile;

    expect(profile.policyNumber).toEqual({
      value: "GL-100",
      confidence: "high",
      sourceSpanIds: ["d-policy"],
      sourceNodeIds: ["node-d-policy"],
    });
    expect(profile.broker).toBeUndefined();
    expect(merged.uncitedFactCount).toBe(1);
    expect(merged.citationMatches.unresolved).toBe(1);
    expect(profile.coverageSchedules?.[0]?.items[0]?.sourceSpanIds).toEqual(["s-vehicle"]);
    expect(profile.sourceSpanIds).toEqual(expect.arrayContaining(["d-policy", "e-ai", "s-income"]));
    expect(profile.sourceNodeIds).not.toContain("root");
  });

  test("keeps declarations authoritative while endorsements add parties with provenance", () => {
    const merged = merge(allSections);
    const profile = merged.operationalProfile;
    const document = merged.document as Record<string, any>;

    expect(profile.namedInsured?.value).toBe("Acme Corp");
    expect(document.insuredName).toBe("Acme Corp");
    expect(document.insuredAddress).toEqual({
      street1: "1 Main St",
      city: "Springfield",
      state: "IL",
      zip: "62701",
      sourceSpanIds: ["d-insured"],
      documentNodeId: "node-d-insured",
    });
    expect(profile.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "additional_insured", name: "Blue Co", sourceSpanIds: ["e-ai"] }),
      expect.objectContaining({ role: "additional_named_insured", name: "Acme Holdings LLC" }),
    ]));
    expect(document.additionalNamedInsureds).toEqual([
      { name: "Acme Holdings LLC", sourceSpanIds: ["e-ani"], documentNodeId: "node-e-ani" },
    ]);
    expect(profile.endorsementSupport).toEqual([
      expect.objectContaining({ kind: "additional_insured", status: "supported", sourceSpanIds: ["e-summary"] }),
    ]);
    expect(document.endorsements[0]).toMatchObject({
      formNumber: "CG 20 10",
      title: "Additional Insured",
      pageStart: 3,
      namedParties: [
        expect.objectContaining({ name: "Blue Co", role: "additional_insured", scope: "Ongoing operations" }),
        expect.objectContaining({ name: "Acme Holdings LLC", role: "other" }),
      ],
    });
  });

  test("applies endorsement coverage changes on top of the declarations", () => {
    const { coverages } = merge(allSections).operationalProfile;
    const generalLiability = coverageNamed(coverages, "General Liability");

    expect(generalLiability).toMatchObject({
      limit: "$2,000,000",
      endorsementNumber: "3",
      limits: [
        expect.objectContaining({ label: "Each Occurrence", value: "$2,000,000", sourceSpanIds: ["e-gl"] }),
      ],
    });
    expect(generalLiability?.sourceSpanIds).toEqual(expect.arrayContaining(["d-gl", "e-gl"]));
    expect(coverageNamed(coverages, "Hired Auto Liability")).toBeUndefined();
  });

  test("adds schedule coverage rows while declarations win conflicting limits", () => {
    const merged = merge(allSections);
    const { coverages } = merged.operationalProfile;

    expect(coverageNamed(coverages, "Building")).toMatchObject({ limit: "$500,000" });
    expect(coverageNamed(coverages, "Building")?.sourceSpanIds)
      .toEqual(expect.arrayContaining(["d-building", "s-building"]));
    expect(coverageNamed(coverages, "Business Income")).toMatchObject({
      limit: "$100,000",
      sourceSpanIds: ["s-income"],
    });
    expect((merged.document as Record<string, unknown>).vehicles).toEqual([
      { number: 1, year: 2022, make: "Ford", model: "F-150", vin: "1FTFW1E50NFA00001" },
    ]);
  });

  test("uses invoice financials only when the declarations have none", () => {
    const merged = merge(allSections);

    expect(merged.operationalProfile.premium?.sourceSpanIds).toEqual(["i-premium"]);
    expect(merged.operationalProfile.taxesAndFees).toEqual([
      {
        name: "Policy Fee",
        amount: "$25",
        amountValue: 25,
        type: "fee",
        documentNodeId: "node-i-fee",
        sourceSpanIds: ["i-fee"],
      },
    ]);
    const withDeclaredPremium = merge([
      {
        kind: "declarations",
        section: sectionFor("declarations", 1),
        output: { ...declarations, premium: cited("$1,000", 1, "Total Premium $1,000") },
      },
      allSections[3]!,
    ]);
    expect(withDeclaredPremium.operationalProfile.premium).toMatchObject({
      value: "$1,000",
      sourceSpanIds: ["d-premium"],
    });
  });
});

describe("model transcription spans", () => {
  // Pages 1 and 2 have a pdf.js text layer; page 3 is a scanned image.
  const textLayer = [
    span("t-policy", 1, "Policy Number: GL-100"),
    span("t-schedule", 2, "VEHICLE SCHEDULE"),
  ];
  const results: SectionResult[] = [
    { kind: "declarations", section: sectionFor("declarations", 1), output: declarations },
    {
      kind: "schedule",
      section: { sectionId: "schedule-2-3", kind: "schedule", pageStart: 2, pageEnd: 3, confidence: 1 },
      output: {
        schedules: [
          {
            name: "Vehicle Schedule",
            kind: "vehicle",
            description: null,
            items: [
              {
                label: "1",
                description: null,
                values: [{ label: "Vehicle", value: "2022 Ford F-150" }],
                citations: [
                  { page: 3, quote: "1 2022 Ford F-150" },
                  { page: 3, quote: " 1 2022 Ford F-150 " },
                ],
              },
              {
                label: "2",
                description: null,
                values: [{ label: "Vehicle", value: "2023 Honda Civic" }],
                // Page 2 has text without this quote, so it must not move to page 3.
                citations: [{ page: 2, quote: "2 2023 Honda Civic" }],
              },
            ],
          },
        ],
        coverages: [
          coverage({
            name: "Hired Auto Physical Damage",
            limit: "$50,000",
            citations: [{ page: 3, quote: "Hired Auto Physical Damage $50,000" }],
          }),
        ],
      },
    },
  ];

  test("transcribes cited quotes only on pages without pdf.js text", () => {
    const transcriptions = modelTranscriptionSpans({
      documentId: "policy-1",
      results,
      sourceSpans: textLayer,
    });

    expect(transcriptions).toEqual([
      expect.objectContaining({
        documentId: "policy-1",
        pageStart: 3,
        pageEnd: 3,
        sourceUnit: "page",
        text: "1 2022 Ford F-150 | Hired Auto Physical Damage $50,000",
        metadata: { sourceUnit: "page", textSource: "model_transcription" },
      }),
    ]);
    expect(transcriptions[0]!.id).toMatch(/^policy-1:span:3:transcription:[0-9a-f]{12}$/);
    expect(
      modelTranscriptionSpans({ documentId: "policy-1", results, sourceSpans: textLayer }),
    ).toEqual(transcriptions);
  });

  test("resolves scanned-page citations exactly while text pages keep pdf.js evidence", () => {
    const transcription = modelTranscriptionSpans({
      documentId: "policy-1",
      results,
      sourceSpans: textLayer,
    })[0]!;
    const sourceSpans = [...textLayer, transcription];
    const sourceTree = normalizeSourceTree([], sourceSpans, "policy-1");
    const merged = mergeSectionResults({ policyId: "policy-1", results, sourceSpans, sourceTree });
    const profile = merged.operationalProfile;
    const pageNode = sourceTree.find((node) => node.kind === "page" && node.pageStart === 3);

    expect(profile.policyNumber?.sourceSpanIds).toEqual(["t-policy"]);
    // Page 1 quotes missing from its text layer are dropped, not transcribed.
    expect(profile.namedInsured).toBeUndefined();
    expect(profile.coverageSchedules?.[0]?.items).toEqual([
      expect.objectContaining({ label: "1", sourceSpanIds: [transcription.id] }),
    ]);
    expect(coverageNamed(profile.coverages, "Hired Auto Physical Damage")).toMatchObject({
      limit: "$50,000",
      sourceSpanIds: [transcription.id],
      sourceNodeIds: [pageNode!.id],
    });
    expect(merged.citationMatches.exact).toBe(4);
  });
});

describe("declarations preview", () => {
  test("projects allowlisted provisional fields from the declarations", () => {
    expect(declarationsPreviewFields([declarations])).toEqual({
      documentType: "policy",
      carrier: "Example Insurance Company",
      security: "Example Insurance Company",
      broker: "Ghost Agency",
      policyNumber: "GL-100",
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      insuredName: "Acme Corp",
      linesOfBusiness: ["CGL"],
      coverages: [
        { name: "General Liability", lineOfBusiness: "CGL", limit: "$1,000,000" },
        { name: "Hired Auto Liability", limit: "$500,000" },
        { name: "Building", limit: "$500,000" },
      ],
      summary: "Example Insurance Company #GL-100 for Acme Corp",
    });
  });
});
