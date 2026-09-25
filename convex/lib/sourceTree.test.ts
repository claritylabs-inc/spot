import { describe, expect, it } from "vitest";

import { normalizeOperationalProfile, normalizeSourceTree, operationalProfilePolicyFields, sourceTreePolicyFields, type DocumentSourceNode, type PolicyOperationalProfile, type SourceSpanLike } from "./sourceTree";

const sourceSpans: SourceSpanLike[] = [
  { id: "span-jacket", text: "THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY.", pageStart: 1 },
  { id: "span-insurer", text: "SPECIMEN POLICY — FOR TESTING ONLY SAINT LAWRENCE SPECIALTY INSURANCE COMPANY", pageStart: 1 },
  { id: "span-named-insured", text: "Column 1: Item 1. Named Insured and | Column 2: Cios Technologies Inc.", pageStart: 5 },
  { id: "span-policy-number", text: "Column 1: Item 2. Policy Number | Column 2: SLS-EO-26-110482", pageStart: 5 },
  { id: "span-period", text: "Column 1: Item 3. Policy Period | Column 2: From: 02/01/2026 To: 02/01/2027", pageStart: 5 },
  { id: "span-business-continuation", text: "Column 1: Named Insured | Column 2: holds delegated underwriting and binding authority from one or more", pageStart: 5 },
  { id: "span-premium", text: "Column 1: Annual Premium | Column 2: CAD $42,000", pageStart: 6 },
  { id: "span-total-payable", text: "Column 1: Total Payable | Column 2: CAD $43,820", pageStart: 6 },
  { id: "span-broker", text: "Item 12. Broker of Record Wellington Risk Partners Inc. RIBO Registration No. 1142208 (Ontario) Item 13. Forms", pageStart: 7 },
];

const sourceTree: DocumentSourceNode[] = [
  {
    id: "document",
    documentId: "policy",
    kind: "document",
    title: "Policy",
    description: "Policy",
    sourceSpanIds: [],
    order: 0,
    path: "Policy",
  },
  {
    id: "jacket",
    documentId: "policy",
    parentId: "document",
    kind: "page",
    title: "Policy Jacket",
    description: "Opening policy jacket",
    textExcerpt: "THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY.",
    sourceSpanIds: ["span-jacket"],
    pageStart: 1,
    pageEnd: 1,
    order: 1,
    path: "Policy > Policy Jacket",
  },
  {
    id: "insurer",
    documentId: "policy",
    parentId: "jacket",
    kind: "text",
    title: "Insurer",
    description: "Insurer name",
    textExcerpt: "SPECIMEN POLICY — FOR TESTING ONLY SAINT LAWRENCE SPECIALTY INSURANCE COMPANY",
    sourceSpanIds: ["span-insurer"],
    pageStart: 1,
    pageEnd: 1,
    order: 2,
    path: "Policy > Policy Jacket > Insurer",
  },
  {
    id: "named-insured-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 1 Named Insured Row",
    description: "Named insured entry",
    textExcerpt: "Column 1: Item 1. Named Insured and | Column 2: Cios Technologies Inc.",
    sourceSpanIds: ["span-named-insured"],
    pageStart: 5,
    pageEnd: 5,
    order: 3,
    path: "Policy > Declarations > Item 1 Named Insured Row",
  },
  {
    id: "policy-number-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 2 Policy Number Row",
    description: "Policy number entry",
    textExcerpt: "Column 1: Item 2. Policy Number | Column 2: SLS-EO-26-110482",
    sourceSpanIds: ["span-policy-number"],
    pageStart: 5,
    pageEnd: 5,
    order: 4,
    path: "Policy > Declarations > Item 2 Policy Number Row",
  },
  {
    id: "period-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Item 3 Policy Period Row",
    description: "Policy period entry",
    textExcerpt: "Column 1: Item 3. Policy Period | Column 2: From: 02/01/2026 To: 02/01/2027",
    sourceSpanIds: ["span-period"],
    pageStart: 5,
    pageEnd: 5,
    order: 5,
    path: "Policy > Declarations > Item 3 Policy Period Row",
  },
  {
    id: "premium-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Annual Premium Row",
    description: "Annual premium entry",
    textExcerpt: "Column 1: Annual Premium | Column 2: CAD $42,000",
    sourceSpanIds: ["span-premium"],
    pageStart: 6,
    pageEnd: 6,
    order: 6,
    path: "Policy > Declarations > Annual Premium Row",
  },
  {
    id: "business-continuation-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Business Continuation Row",
    description: "Business description continuation",
    textExcerpt: "Column 1: Named Insured | Column 2: holds delegated underwriting and binding authority from one or more",
    sourceSpanIds: ["span-business-continuation"],
    pageStart: 5,
    pageEnd: 5,
    order: 7,
    path: "Policy > Declarations > Business Continuation Row",
  },
  {
    id: "total-payable-row",
    documentId: "policy",
    parentId: "document",
    kind: "table_row",
    title: "Total Payable Row",
    description: "Total payable entry",
    textExcerpt: "Column 1: Total Payable | Column 2: CAD $43,820",
    sourceSpanIds: ["span-total-payable"],
    pageStart: 6,
    pageEnd: 6,
    order: 8,
    path: "Policy > Declarations > Total Payable Row",
  },
  {
    id: "broker-page",
    documentId: "policy",
    parentId: "document",
    kind: "page",
    title: "Declarations Page 3",
    description: "Broker and forms",
    textExcerpt: "Item 12. Broker of Record Wellington Risk Partners Inc. RIBO Registration No. 1142208 (Ontario) Item 13. Forms",
    sourceSpanIds: ["span-broker"],
    pageStart: 7,
    pageEnd: 7,
    order: 9,
    path: "Policy > Declarations Page 3",
  },
];

describe("normalizeOperationalProfile", () => {
  it("drops polluted raw identity values instead of deriving declaration replacements", () => {
    const profile = normalizeOperationalProfile(
      {
        namedInsured: {
          value: ". THIS IS A CLAIMS-MADE AND REPORTED POLICY. PLEASE READ IT CAREFULLY. _________________________ Page 1 of 27",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
        },
        broker: {
          value: "ERRORS AND OMISSIONS LIABILITY POLICY In consideration of the payment of the premium",
          confidence: "high",
          sourceNodeIds: ["jacket"],
          sourceSpanIds: ["span-jacket"],
        },
        linesOfBusiness: ["professional_liability"],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.namedInsured).toBeUndefined();
    expect(profile.policyNumber).toBeUndefined();
    expect(profile.effectiveDate).toBeUndefined();
    expect(profile.expirationDate).toBeUndefined();
    expect(profile.premium).toBeUndefined();
    expect(profile.broker).toBeUndefined();
    expect(profile.insurer).toBeUndefined();
    expect(profile.linesOfBusiness).toEqual(["PL"]);
    expect(profile.parties).toEqual([]);
  });

  it("drops torn declaration table coverage fragments and repairs self-referential limits", () => {
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["professional_liability"],
        coverages: [
          {
            name: "C. Regulatory Proceedings Sub-Limit",
            limit: "C. Regulatory Proceedings Sub-Limit",
            deductible: "$5,000 Each",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
            limits: [
              {
                kind: "sublimit",
                label: "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)",
                value: "C. Regulatory Proceedings Sub-Limit",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
              {
                kind: "each_claim_limit",
                label: "Claim",
                value: "$100,000 Each Proceeding /",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
          },
          {
            name: "Coverage Part B)",
            limit: "Coverage Part B)",
            sourceNodeIds: ["named-insured-row"],
            sourceSpanIds: ["span-named-insured"],
            limits: [
              {
                kind: "other",
                label: "Aggregate (sub-limit, part of",
                value: "Coverage Part B)",
                sourceNodeIds: ["named-insured-row"],
                sourceSpanIds: ["span-named-insured"],
              },
            ],
          },
        ],
      },
      sourceTree,
      sourceSpans,
    );

    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name))
      .toContain("C. Regulatory Proceedings Sub-Limit");
    expect(profile.coverages.map((coverage: PolicyOperationalProfile["coverages"][number]) => coverage.name))
      .not.toContain("Coverage Part B)");
    const regulatory = profile.coverages.find((coverage: PolicyOperationalProfile["coverages"][number]) =>
      coverage.name === "C. Regulatory Proceedings Sub-Limit"
    );
    expect(regulatory?.limit).toBe("$100,000 Each Proceeding");
    expect(regulatory?.limits?.map((term: NonNullable<PolicyOperationalProfile["coverages"][number]["limits"]>[number]) => term.value))
      .toEqual(["$100,000 Each Proceeding"]);
  });
});
describe("normalizeSourceTree", () => {

  it("drops coverage amounts that appear only as a different cited magnitude", () => {
    const spans: SourceSpanLike[] = [
      {
        id: "statutory-notice",
        text: `
          This statutory notice contains a $100 billion government reimbursement cap.
          The annual charge attributable to the optional protection is $0.
        `,
        pageStart: 2,
      },
    ];
    const tree = normalizeSourceTree([], spans, "policy");
    const profile = normalizeOperationalProfile(
      {
        linesOfBusiness: ["property"],
        coverages: [
          {
            name: "Statutory Reimbursement Notice",
            limit: "$100",
            sourceSpanIds: ["statutory-notice"],
            sourceNodeIds: [],
            limits: [
              {
                kind: "other",
                label: "Statutory cap",
                value: "$100",
                sourceSpanIds: ["statutory-notice"],
                sourceNodeIds: [],
              },
            ],
          },
        ],
      },
      tree,
      spans,
    );

    expect(profile.coverages).toEqual([]);
  });

});

describe("sourceTreePolicyFields", () => {

  it("preserves source-backed policy party addresses and operations descriptions", () => {
    const spans: SourceSpanLike[] = [
      { id: "span-insured-address", text: "Named Insured Acme LLC 1 Client St Toronto ON M5A 1A1" },
      { id: "span-producer-address", text: "Producer Broker LLC License PR-123 2 Broker St Toronto ON M5B 1B1" },
      { id: "span-insurer-address", text: "Insurer Fortegra Specialty Insurance Company NAIC 16823 3 Carrier St Toronto ON M5C 1C1" },
      { id: "span-general-agent-address", text: "General Agent Diesel Insurance Solutions Inc. License 21058436 4 General Agent St Toronto ON M5D 1D1" },
      { id: "span-operations", text: "Business operations software implementation services" },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "policy-parties",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: spans.map((span) => String(span.id)),
        order: 0,
        path: "Policy",
      },
      {
        id: "declarations",
        documentId: "policy-parties",
        parentId: "document",
        kind: "section",
        title: "Declarations",
        description: "Declarations",
        sourceSpanIds: spans.map((span) => String(span.id)),
        order: 1,
        path: "Policy / Declarations",
      },
    ];
    const profile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        parties: [
          { role: "named_insured", name: "Acme LLC", address: { street1: "1 Client St", city: "Toronto", state: "ON", zip: "M5A 1A1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-insured-address"] },
          { role: "producer", name: "Broker LLC", licenseNumber: "PR-123", address: { street1: "2 Broker St", city: "Toronto", state: "ON", zip: "M5B 1B1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-producer-address"] },
          { role: "insurer", name: "Fortegra Specialty Insurance Company", naicNumber: "16823", address: { street1: "3 Carrier St", city: "Toronto", state: "ON", zip: "M5C 1C1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-insurer-address"] },
          { role: "general_agent", name: "Diesel Insurance Solutions Inc.", licenseNumber: "21058436", address: { street1: "4 General Agent St", city: "Toronto", state: "ON", zip: "M5D 1D1" }, sourceNodeIds: ["declarations"], sourceSpanIds: ["span-general-agent-address"] },
        ],
        operationsDescription: {
          value: "Software implementation services",
          sourceNodeIds: ["declarations"],
          sourceSpanIds: ["span-operations"],
        },
      },
      nodes,
      spans,
    );

    expect((profile as any).operationsDescription).toMatchObject({
      value: "Software implementation services",
      sourceSpanIds: ["span-operations"],
    });
    expect((profile.parties as any[]).find((party) => party.role === "general_agent")).toMatchObject({
      name: "Diesel Insurance Solutions Inc.",
      licenseNumber: "21058436",
      address: { street1: "4 General Agent St" },
    });

    const fields = operationalProfilePolicyFields(profile, {
      insurer: { legalName: "Fortegra Specialty Insurance Company" },
      producer: { agencyName: "Broker LLC", phone: "555-0100" },
    });
    expect(fields.insuredAddress).toMatchObject({ street1: "1 Client St" });
    expect(fields.insuredAddress).toMatchObject({
      documentNodeId: "declarations",
      sourceSpanIds: ["span-insured-address"],
    });
    expect(fields.producer).toMatchObject({
      agencyName: "Broker LLC",
      licenseNumber: "PR-123",
      phone: "555-0100",
      address: { street1: "2 Broker St" },
      sourceSpanIds: ["span-producer-address"],
    });
    expect(fields.brokerLicenseNumber).toBe("PR-123");
    expect(fields.insurer).toMatchObject({
      legalName: "Fortegra Specialty Insurance Company",
      naicNumber: "16823",
      address: { street1: "3 Carrier St" },
      sourceSpanIds: ["span-insurer-address"],
    });
    expect(fields.carrierNaicNumber).toBe("16823");
    expect(fields.generalAgent).toMatchObject({
      agencyName: "Diesel Insurance Solutions Inc.",
      licenseNumber: "21058436",
      address: { street1: "4 General Agent St" },
    });
  });

  it("requires generic Lloyd's parties to share provenance with the led-by clause", () => {
    const canonicalText =
      "Lloyd's Underwriters led by Canonical Managing Agency Limited Syndicate 1234";
    const unrelatedText =
      "Underlying policy: Lloyd's Underwriters led by Unrelated Managing Agency Limited Syndicate 1111 and Syndicate 2222";
    const spans: SourceSpanLike[] = [
      {
        id: "canonical-lloyds-span",
        text: canonicalText,
        pageStart: 1,
      },
      {
        id: "unrelated-lloyds-span",
        text: unrelatedText,
        pageStart: 4,
      },
    ];
    const nodes: DocumentSourceNode[] = [
      {
        id: "canonical-lloyds-carrier",
        documentId: "generic-lloyds-policy",
        kind: "section",
        title: "Insurer",
        description: canonicalText,
        textExcerpt: canonicalText,
        sourceSpanIds: ["canonical-lloyds-span"],
        order: 0,
        path: "Policy / Insurer",
      },
      {
        id: "underlying-lloyds-reference",
        documentId: "generic-lloyds-policy",
        kind: "section",
        title: "Underlying policy",
        description: unrelatedText,
        textExcerpt: unrelatedText,
        sourceSpanIds: ["unrelated-lloyds-span"],
        order: 1,
        path: "Policy / Underlying policy",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: ["canonical-lloyds-carrier"],
          sourceSpanIds: ["canonical-lloyds-span"],
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Canonical Managing Agency Limited",
      sourceName:
        "Lloyd's Underwriters led by: Canonical Managing Agency Limited, Syndicate No. 1234",
      sourceNodeIds: ["canonical-lloyds-carrier"],
      sourceSpanIds: ["canonical-lloyds-span"],
    });
  });

  it("preserves Lloyd's lead underwriter and syndicates from source evidence", () => {
    const carrierText = [
      "LLOYD'S UNDERWRITERS LED BY: TOKIO",
      "MARINE KILN, SYNDICATE NO. 0510 KLN",
      "AND SYNDICATE NO. 1880 KLN UNDER",
      "CONTRACT NUMBER PG109C/26-PC(L)",
    ];
    const spans: SourceSpanLike[] = carrierText.map((text, index) => ({
      id: `span-carrier-${index + 1}`,
      text,
      pageStart: 2,
    }));
    const nodes: DocumentSourceNode[] = [
      {
        id: "document",
        documentId: "tokio-policy",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: spans.map((span) => span.id as string),
        order: 0,
        path: "Policy",
      },
      {
        id: "carrier-identity",
        documentId: "tokio-policy",
        parentId: "document",
        kind: "section",
        title: "Insurer",
        description: carrierText.join(" "),
        textExcerpt: carrierText.join(" "),
        sourceSpanIds: spans.map((span) => span.id as string),
        order: 1,
        path: "Policy / Insurer",
      },
    ];
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        coverages: [],
        insurer: {
          value: "Lloyd's Underwriters",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: spans.map((span) => span.id as string),
        },
        parties: [{
          role: "carrier",
          name: "Lloyd's Underwriters",
          sourceNodeIds: ["carrier-identity"],
          sourceSpanIds: spans.map((span) => span.id as string),
        }],
      },
      nodes,
      spans,
    );

    const fields = sourceTreePolicyFields({
      sourceTree: nodes,
      sourceSpans: spans,
      operationalProfile,
    });

    expect(fields.carrier).toBe("Tokio Marine Kiln");
    expect(fields.carrierIdentity).toMatchObject({
      displayName: "Tokio Marine Kiln",
      sourceName:
        "Lloyd's Underwriters led by: Tokio Marine Kiln, Syndicate No. 0510 KLN and Syndicate No. 1880 KLN, under contract number PG109C/26-PC(L)",
      legalEntities: [
        { name: "Tokio Marine Kiln, Syndicate No. 0510 KLN" },
        { name: "Tokio Marine Kiln, Syndicate No. 1880 KLN" },
      ],
      legalEntityRelationship: "and",
      sourceNodeIds: ["carrier-identity"],
      sourceSpanIds: spans.map((span) => span.id as string),
    });
    expect(fields.carrierLegalName).toBe(
      "Tokio Marine Kiln, Syndicate No. 0510 KLN",
    );
    expect(fields.security).toBeUndefined();
  });

  it("resets carrier enrichment state when source extraction changes the identity", () => {
    const span = {
      id: "replacement-carrier-span",
      text: "INSURER Replacement Carrier Insurance Company",
    };
    const node: DocumentSourceNode = {
      id: "replacement-carrier",
      documentId: "replacement-policy",
      kind: "section",
      title: "Insurer",
      description: span.text,
      textExcerpt: span.text,
      sourceSpanIds: [span.id],
      order: 0,
      path: "Policy / Insurer",
    };
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        insurer: {
          value: "Replacement Carrier Insurance Company",
          sourceNodeIds: [node.id],
          sourceSpanIds: [span.id],
        },
        parties: [{
          role: "insurer",
          name: "Replacement Carrier Insurance Company",
          sourceNodeIds: [node.id],
          sourceSpanIds: [span.id],
        }],
      },
      [node],
      [span],
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [node],
      sourceSpans: [span],
      operationalProfile,
      existingPolicyFields: {
        carrierIdentity: {
          displayName: "Original Carrier Insurance Company",
          sourceName: "Original Carrier Insurance Company",
          legalEntities: [{
            name: "Original Carrier Insurance Company",
            sourceNodeIds: ["original-carrier"],
            sourceSpanIds: ["original-carrier-span"],
          }],
          legalEntityRelationship: "single",
          sourceNodeIds: ["original-carrier"],
          sourceSpanIds: ["original-carrier-span"],
        },
        carrierIdentityEnrichmentStatus: "failed",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
      },
    });

    expect(fields.carrierIdentity).toMatchObject({
      sourceName: "Replacement Carrier Insurance Company",
    });
    expect(fields).toHaveProperty("carrierIdentityEnrichmentStatus", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentAttempts", undefined);
    expect(fields).toHaveProperty(
      "carrierIdentityEnrichmentAttemptedAt",
      undefined,
    );
  });

  it("clears stale carrier identity when replacement evidence cannot rebuild it", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["CGL"],
        coverages: [],
        insurer: {
          value: "Replacement Carrier Insurance Company",
          sourceNodeIds: ["missing-replacement-carrier"],
          sourceSpanIds: ["missing-replacement-carrier-span"],
        },
      },
      [],
      [],
    );

    const fields = sourceTreePolicyFields({
      sourceTree: [],
      sourceSpans: [],
      operationalProfile,
      existingPolicyFields: {
        carrier: "Replacement Carrier Insurance Company",
        security: "Replacement Carrier Insurance Company",
        insurer: {
          legalName: "Replacement Carrier Insurance Company",
        },
        carrierLegalName: "Original Carrier Insurance Company",
        carrierIdentity: {
          displayName:
            "Original Carrier Insurance Company and/or Replacement Carrier Insurance Company",
          sourceName:
            "Original Carrier Insurance Company and/or Replacement Carrier Insurance Company",
          legalEntities: [
            {
              name: "Original Carrier Insurance Company",
              sourceNodeIds: ["original-carrier"],
              sourceSpanIds: ["original-carrier-span"],
            },
            {
              name: "Replacement Carrier Insurance Company",
              sourceNodeIds: ["original-carrier"],
              sourceSpanIds: ["original-carrier-span"],
            },
          ],
          legalEntityRelationship: "and_or",
          sourceNodeIds: ["original-carrier"],
          sourceSpanIds: ["original-carrier-span"],
        },
        carrierIdentityEnrichmentStatus: "failed",
        carrierIdentityEnrichmentAttempts: 3,
        carrierIdentityEnrichmentAttemptedAt: 100,
      },
    });

    expect(fields).toMatchObject({
      carrier: "Replacement Carrier Insurance Company",
      security: "Replacement Carrier Insurance Company",
      insurer: {
        legalName: "Replacement Carrier Insurance Company",
      },
    });
    expect(fields).toHaveProperty("carrierNaicNumber", undefined);
    expect(fields).toHaveProperty("carrierIdentity", undefined);
    expect(fields).toHaveProperty("carrierLegalName", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentStatus", undefined);
    expect(fields).toHaveProperty("carrierIdentityEnrichmentAttempts", undefined);
    expect(fields).toHaveProperty(
      "carrierIdentityEnrichmentAttemptedAt",
      undefined,
    );
  });

  it("merges declaration recovery into the operational projection without coverage premiums", () => {
    const operationalProfile = normalizeOperationalProfile(
      {
        documentType: "policy",
        linesOfBusiness: ["AUTOB"],
        premium: {
          value: "$5,166.32",
          normalizedValue: "5166.32",
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        },
        coverages: [{
          name: "Commercial Auto Physical Damage",
          lineOfBusiness: "AUTOB",
          premium: "$1,300.00",
          limits: [{
            kind: "premium",
            label: "Premium",
            value: "$1,300.00",
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
          }],
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        }],
      },
      sourceTree,
      sourceSpans,
    );
    const fields = sourceTreePolicyFields({
      sourceTree,
      operationalProfile,
      existingLinesOfBusiness: ["AUTOB"],
      existingPolicyFields: {
        premium: "$4,572.40",
        premiumAmount: 4572.4,
        totalCost: "$5,166.32",
        premiumBreakdown: [{ line: "Physical Damage", amount: "$1,300.00", sourceSpanIds: ["span-period"] }],
        coverages: [{
          name: "Commercial Auto Physical Damage",
          lineOfBusiness: "AUTOB",
          limit: "$250,000",
          limits: [{
            kind: "each_occurrence_limit",
            label: "Maximum per Occurrence",
            value: "$250,000",
            sourceNodeIds: ["period-row"],
            sourceSpanIds: ["span-period"],
          }],
          sourceNodeIds: ["period-row"],
          sourceSpanIds: ["span-period"],
        }],
      },
    });

    expect(fields).toMatchObject({ premium: "$4,572.40", premiumAmount: 4572.4 });
    expect((fields.coverages as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: "Commercial Auto Physical Damage",
      limit: "$250,000",
    });
    expect((fields.coverages as Array<Record<string, unknown>>)[0]).not.toHaveProperty("premium");
    expect(((fields.operationalProfile as PolicyOperationalProfile).coverages[0] as Record<string, unknown>)).not.toHaveProperty("premium");
  });
});
