import { describe, expect, test } from "vitest";
import {
  aggregateProposalDocuments,
  type ProposalDocumentExtraction,
} from "./proposalAggregation";

const documents: ProposalDocumentExtraction[] = [
  {
    proposalDocumentId: "proposal-doc-package",
    fileName: "package.pdf",
    document: {
      type: "policy",
      carrier: "Farmers",
      policyNumber: "Q-100",
      insuredName: "Sigillo LLC",
      effectiveDate: "2026-10-01",
      premium: "$12,400",
      coverages: [
        {
          name: "Building",
          limit: "$1,325,000",
          sourceSpanIds: ["package-limit"],
          documentNodeId: "package-node",
          pageNumber: 4,
        },
      ],
      premiumBreakdown: [
        {
          line: "Package",
          amount: "$12,400",
          sourceSpanIds: ["package-premium"],
          pageNumber: 2,
        },
      ],
      declarations: {
        fields: [
          {
            field: "policyNumber",
            value: "Q-100",
            sourceSpanIds: ["package-quote-number"],
          },
        ],
      },
    },
    parties: [],
    supplemental: {
      quoteExpirationDate: "2026-09-20",
      quoteExpirationEvidence: {
        description: "Quote valid until September 20, 2026",
        category: null,
        sourceNodeIds: ["package-validity-node"],
        sourceSpanIds: ["package-validity-span"],
        pageStart: 1,
        pageEnd: 1,
      },
      subjectivities: [],
      conditions: [],
    },
  },
  {
    proposalDocumentId: "proposal-doc-umbrella",
    fileName: "umbrella.pdf",
    document: {
      type: "policy",
      carrier: "Farmers",
      policyNumber: "Q-100-U",
      insuredName: "Sigillo LLC",
      coverages: [
        {
          name: "Umbrella",
          limit: "$2,000,000",
          sourceSpanIds: ["umbrella-limit"],
          pageNumber: 1,
        },
      ],
      premiumBreakdown: [
        {
          line: "Umbrella",
          amount: "$1,700",
          sourceSpanIds: ["umbrella-premium"],
          pageNumber: 1,
        },
      ],
    },
    parties: [],
  },
];

describe("aggregateProposalDocuments", () => {
  test("aggregates multiple quote documents without losing document-qualified evidence", () => {
    const aggregate = aggregateProposalDocuments(documents);
    expect(aggregate.carrier).toBe("Farmers");
    expect(aggregate.quoteExpirationDate).toBe("2026-09-20");
    expect(aggregate.evidence.quoteExpirationDate?.[0]?.proposalDocumentId).toBe(
      "proposal-doc-package",
    );
    expect(aggregate.premiums.map((premium) => premium.line)).toEqual([
      "Package",
      "Umbrella",
    ]);
    expect(aggregate.coverages[0]?.evidence).toEqual([
      {
        proposalDocumentId: "proposal-doc-package",
        sourceNodeIds: ["package-node"],
        sourceSpanIds: ["package-limit"],
        pageStart: 4,
        pageEnd: 4,
      },
    ]);
    expect(aggregate.coverages[1]?.evidence[0]?.proposalDocumentId).toBe(
      "proposal-doc-umbrella",
    );
  });

  test("merges evidence across documents that report the same coverage row", () => {
    const shared: ProposalDocumentExtraction[] = [
      {
        proposalDocumentId: "doc-a",
        fileName: "a.pdf",
        document: {
          coverages: [
            { name: "General Liability", limit: "$1,000,000", deductible: "$1,000", sourceSpanIds: ["a-span"] },
          ],
        },
        parties: [],
      },
      {
        proposalDocumentId: "doc-b",
        fileName: "b.pdf",
        document: {
          coverages: [
            { name: "general liability", limit: "$1,000,000", deductible: "$1,000", sourceSpanIds: ["b-span"] },
          ],
        },
        parties: [],
      },
    ];
    const aggregate = aggregateProposalDocuments(shared);
    expect(aggregate.coverages).toHaveLength(1);
    expect(aggregate.coverages[0]?.evidence.map((item) => item.proposalDocumentId)).toEqual([
      "doc-a",
      "doc-b",
    ]);
  });

  test("collects subjectivities and conditions only from the quote-terms supplement", () => {
    const withSupplement: ProposalDocumentExtraction[] = [
      {
        proposalDocumentId: "doc-a",
        fileName: "a.pdf",
        document: {},
        parties: [],
        supplemental: {
          quoteExpirationDate: null,
          quoteExpirationEvidence: null,
          subjectivities: [
            {
              description: "Provide loss runs",
              category: "underwriting",
              sourceNodeIds: ["node-1"],
              sourceSpanIds: ["span-1"],
              pageStart: 2,
              pageEnd: 2,
            },
          ],
          conditions: [
            {
              description: "Subject to inspection",
              category: null,
              sourceNodeIds: [],
              sourceSpanIds: ["span-2"],
              pageStart: 3,
              pageEnd: 3,
            },
          ],
        },
      },
    ];
    const aggregate = aggregateProposalDocuments(withSupplement);
    expect(aggregate.subjectivities).toHaveLength(1);
    expect(aggregate.subjectivities[0]?.description).toBe("Provide loss runs");
    expect(aggregate.conditions).toHaveLength(1);
    expect(aggregate.conditions[0]?.description).toBe("Subject to inspection");
  });

  test("aggregates parties from the operational profile, including additional insureds", () => {
    const withParties: ProposalDocumentExtraction[] = [
      {
        proposalDocumentId: "doc-a",
        fileName: "a.pdf",
        document: {},
        parties: [
          {
            role: "named_insured",
            name: "Sigillo LLC",
            sourceNodeIds: ["node-1"],
            sourceSpanIds: ["span-1"],
          },
          {
            role: "additional_insured",
            name: "Landlord Partners LLC",
            sourceNodeIds: ["node-2"],
            sourceSpanIds: ["span-2"],
          },
        ],
      },
    ];
    const aggregate = aggregateProposalDocuments(withParties);
    expect(aggregate.parties.map((party) => party.role)).toEqual([
      "named_insured",
      "additional_insured",
    ]);
  });
});
