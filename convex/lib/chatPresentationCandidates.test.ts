import { describe, expect, test } from "vitest";
import { buildPresentationCandidates } from "./chatPresentationCandidates";
import {
  parseChatPresentation,
  type PresentationEvidence,
  type PresentationToolResult,
} from "../../lib/chat-presentation";

function build(
  tools: PresentationToolResult[],
  audience: PresentationEvidence["audience"] = "operator",
) {
  return buildPresentationCandidates({
    audience,
    prompt: "Compare these records",
    response: "Invented claim: every policy provides $99m flood coverage",
    tools,
  });
}
const policy = {
  id: "policy_1",
  orgId: "org_1",
  number: "CGL-123",
  carrier: "Insurer One",
  insured: "Cove LLC",
  effective: "2026-01-01",
  expiration: "2027-01-01",
  premium: "$2,100",
  dataStage: "final",
  provisional: false,
  coverages: [
    { name: "General liability", limit: "$1,000,000", deductible: "$0" },
  ],
};

describe("authorized presentation evidence", () => {
  test("preserves comparison values, zero and missing terms without extracting assistant claims", () => {
    const result = build([
      {
        name: "compare_coverages",
        output: {
          result: {
            policy1: policy,
            policy2: {
              ...policy,
              id: "policy_2",
              number: "CGL-456",
              premium: 0,
              coverages: [],
            },
          },
          attachments: [{ secret: "hidden" }],
        },
      },
    ]);
    const comparison = result.candidates.find(
      (candidate) => candidate.element.type === "ComparisonTable",
    )?.element;
    expect(comparison?.type).toBe("ComparisonTable");
    if (comparison?.type !== "ComparisonTable")
      throw new Error("Comparison missing");
    expect(
      comparison.props.rows.find((row) => row.label === "Premium")?.values,
    ).toEqual(["$2,100", "0"]);
    expect(
      comparison.props.rows.find(
        (row) => row.label === "General liability — limit",
      )?.values,
    ).toEqual(["$1,000,000", "Not provided"]);
    expect(JSON.stringify(result)).not.toMatch(/99m|flood|hidden/);
    expect(
      result.references.find((ref) => ref.recordId === "policy_1")?.href,
    ).toBe("/operator/clients/org_1/policies/policy_1");
    for (const candidate of result.candidates) {
      expect(
        parseChatPresentation({
          version: 1,
          sourceRevision: "test",
          createdAt: 0,
          references: result.references,
          spec: {
            root: candidate.id,
            elements: { [candidate.id]: candidate.element },
          },
        }),
      ).not.toBeNull();
    }
  });

  test("retains coverage term provenance and explicitly provisional state", () => {
    const result = build(
      [
        {
          name: "lookup_policy",
          output: [
            {
              ...policy,
              dataStage: "preview",
              provisional: true,
              coverageBreakdown: {
                all: [
                  {
                    name: "General liability",
                    limits: [
                      { label: "Each occurrence", value: "$1,000,000" },
                      { label: "Aggregate", value: "$2,000,000" },
                    ],
                    sourceSpanIds: ["pdf:page-3:span-2"],
                    pageNumber: 3,
                  },
                ],
              },
            },
          ],
        },
      ],
      "client",
    );
    const factList = result.candidates.find(
      (candidate) => candidate.element.type === "FactList",
    )?.element;
    if (factList?.type !== "FactList") throw new Error("Facts missing");
    expect(
      factList.props.facts.find(
        (fact) => fact.label === "General liability — limit",
      )?.value,
    ).toBe("Each occurrence: $1,000,000; Aggregate: $2,000,000");
    expect(
      factList.props.facts.find((fact) => fact.label === "Provisional")?.value,
    ).toContain("incomplete");
    expect(result.references).toContainEqual(
      expect.objectContaining({
        kind: "source",
        policyId: "policy_1",
        sourceSpanIds: ["pdf:page-3:span-2"],
        page: 3,
      }),
    );
  });

  test("attaches original source excerpts only to a policy resolved in this turn", () => {
    const source = {
      name: "lookup_policy_section",
      input: { policyId: "policy_1" },
      output: [
        {
          title: "Flood exclusion",
          content: "This policy excludes flood.",
          originalPdfChecked: true,
          evidenceSource: "original_pdf",
          confidence: "low",
          sourceSpanIds: ["pdf:span1"],
          sourceSpans: [
            {
              id: "pdf:span1",
              pageStart: 7,
              metadata: { accessToken: "secret" },
            },
          ],
        },
      ],
    };
    expect(build([source]).candidates).toEqual([]);
    const result = build([source, { name: "lookup_policy", output: [policy] }]);
    const findings = result.candidates.find(
      (candidate) => candidate.element.type === "FindingsList",
    )?.element;
    expect(findings).toMatchObject({
      props: {
        findings: [
          { detail: "This policy excludes flood.", status: "uncertain" },
        ],
      },
    });
    expect(result.references).toContainEqual(
      expect.objectContaining({
        policyId: "policy_1",
        sourceSpanIds: ["pdf:span1"],
        page: 7,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  test("uses the server-resolved policy in source-only lookups, never an ambiguous input reference", () => {
    const result = build(
      [
        {
          name: "lookup_policy_section",
          input: { policyId: "the liability policy" },
          output: {
            policyId: "resolved_policy",
            results: [
              {
                title: "Exclusion",
                content: "Flood is excluded.",
                originalPdfChecked: true,
                sourceSpanIds: ["span:4"],
                sourceSpans: [{ pageStart: 4 }],
              },
            ],
          },
        },
      ],
      "client",
    );
    expect(result.candidates[0].element.type).toBe("FindingsList");
    expect(result.references[0]).toMatchObject({
      kind: "source",
      policyId: "resolved_policy",
      page: 4,
      sourceSpanIds: ["span:4"],
    });
    expect(JSON.stringify(result)).not.toContain("the liability policy");
  });

  test("never turns strings, errors, placeholder records, or arbitrary tools into facts", () => {
    expect(
      build([
        { name: "lookup_policy", output: "Policy CGL has $10m coverage" },
        { name: "lookup_policy", output: { isError: true, result: [policy] } },
        {
          name: "lookup_policy",
          output: [{ ...policy, dataStage: "placeholder" }],
        },
        { name: "call_mcp_tool", output: [policy] },
        { name: "lookup_compliance_requirements", output: "Requirement met" },
      ]).candidates,
    ).toEqual([]);
  });

  test("records expirations literally without inventing renewal dates or parsing malformed dates", () => {
    const result = build([
      {
        name: "list_policies",
        input: { orgId: "org_1" },
        output: [
          {
            policyId: "p1",
            policyNumber: "P-1",
            expirationDate: "Awaiting confirmation",
          },
        ],
      },
    ]);
    const dates = result.candidates.find(
      (candidate) => candidate.element.type === "DateList",
    )?.element;
    expect(dates).toMatchObject({
      props: {
        dates: [{ label: "P-1 — expiration", value: "Awaiting confirmation" }],
      },
    });
  });

  test("keeps missing, expiring and unverified compliance distinct from satisfied", () => {
    const result = build(
      [
        {
          name: "lookup_vendor_compliance",
          output: [
            {
              vendorOrgId: "v1",
              name: "Vendor",
              checks: [
                {
                  requirementId: "r1",
                  title: "Liability",
                  status: "met",
                  matchedPolicy: {
                    _id: "p1",
                    coverageLimit: "$1m",
                    provisional: false,
                  },
                },
                {
                  requirementId: "r2",
                  title: "Auto",
                  status: "expiring_soon",
                  expiresAt: "2026-10-01",
                },
                {
                  requirementId: "r3",
                  title: "Umbrella",
                  status: "not_met",
                  reasons: ["no_matching_policy"],
                },
                {
                  requirementId: "r4",
                  title: "Property",
                  status: "unverified",
                },
                {
                  requirementId: "r5",
                  title: "Provisional",
                  status: "met",
                  matchedPolicy: { provisional: true },
                },
              ],
            },
          ],
        },
      ],
      "client",
    );
    const matrix = result.candidates[0].element;
    if (matrix.type !== "RequirementMatrix") throw new Error("Matrix missing");
    expect(matrix.props.requirements.map((row) => row.status)).toEqual([
      "satisfied",
      "uncertain",
      "missing",
      "uncertain",
      "uncertain",
    ]);
    expect(matrix.props.requirements[0].evidence).toContain("$1m");
  });

  test("uses structured requirement fields and saved checks, never the formatted prose wrapper", () => {
    const result = build(
      [
        {
          name: "lookup_compliance_requirements",
          output: {
            text: "Incorrect prose says satisfied",
            requirements: [
              {
                requirementId: "r1",
                orgId: "org_1",
                title: "Liability",
                scope: "own_org",
                requirementText: "Maintain liability coverage.",
                limits: [
                  {
                    kind: "per_occurrence",
                    amount: 1000000,
                    label: "$1,000,000",
                  },
                ],
                maxDeductible: { amount: 0 },
                currentComplianceStatus: "unverified",
                currentComplianceReasons: [],
                matchedPolicyIds: [],
                requirementSourceDocumentId: "document1",
                sourceDocumentName: "Lease.pdf",
                sourceExcerpt: "At least $1,000,000",
                sourcePageStart: 4,
              },
            ],
          },
        },
      ],
      "client",
    );
    const matrix = result.candidates[0].element;
    if (matrix.type !== "RequirementMatrix") throw new Error("Matrix missing");
    expect(matrix.props.requirements[0]).toMatchObject({ status: "uncertain" });
    expect(matrix.props.requirements[0].evidence).toContain(
      "per_occurrence: $1,000,000",
    );
    expect(matrix.props.requirements[0].evidence).toContain(
      "Maximum deductible: 0",
    );
    expect(result.references).toContainEqual(
      expect.objectContaining({
        kind: "source",
        recordId: "document1",
        page: 4,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("Incorrect prose");
  });

  test("offers vendor clarification only for explicit structured disambiguation", () => {
    const result = build(
      [
        {
          name: "lookup_vendor_policies",
          output: {
            needsDisambiguation: true,
            vendors: [
              { vendorOrgId: "v1", name: "Cove East" },
              { vendorOrgId: "v2", name: "Cove West" },
            ],
          },
        },
      ],
      "client",
    );
    expect(result.candidates[0].element).toMatchObject({
      type: "ChoiceGroup",
      props: {
        options: [
          { value: "v1", label: "Cove East" },
          { value: "v2", label: "Cove West" },
        ],
      },
    });
    expect(
      build([
        {
          name: "lookup_vendor_policies",
          output: { vendors: [{ vendorOrgId: "v1", name: "Cove East" }] },
        },
      ]).candidates,
    ).toEqual([]);
  });

  test("excludes all operator-private domains for client evidence, even when supplied accidentally", () => {
    const tools = [
      {
        name: "get_procurement_request",
        output: {
          request: { _id: "r1", title: "Secret request" },
          proposals: [{ secret: true }],
        },
      },
      {
        name: "get_procurement_proposal",
        output: {
          _id: "p1",
          brokerName: "Private broker",
          extractedOffer: { premium: "$2,000" },
        },
      },
      {
        name: "get_broker_network_profile",
        output: { broker: { _id: "b1", name: "Private broker" }, profile: {} },
      },
      {
        name: "get_organization",
        output: { orgId: "b2", type: "broker", name: "Provider" },
      },
      {
        name: "list_policies",
        output: [{ policyId: "private", policyNumber: "Secret policy" }],
      },
    ];
    expect(build(tools).candidates.length).toBeGreaterThan(0);
    expect(build(tools, "client")).toEqual({ candidates: [], references: [] });
  });

  test("uses request facts and shared file IDs without leaking inbox tokens, private notes or storage URLs", () => {
    const result = build([
      {
        name: "get_procurement_request",
        output: {
          request: {
            _id: "r1",
            clientOrgId: "org_1",
            title: "Renewal",
            status: "marketing",
            targetEffectiveDate: "2027-01-01",
            inboxToken: "SECRET",
          },
          files: [
            {
              clientFileId: "f1",
              label: "Loss runs",
              brokerRelease: "listed",
              clientFile: { _id: "f1", url: "https://storage/SECRET" },
            },
            {
              clientFileId: "f2",
              label: "Private",
              brokerRelease: "hidden",
              clientVisible: false,
              clientFile: { _id: "f2" },
            },
            {
              clientFileId: "f3",
              label: "Unavailable",
              brokerRelease: "listed",
              clientFile: null,
            },
          ],
          privateMarkdown: "SECRET",
        },
      },
    ]);
    expect(
      result.references
        .filter((ref) => ref.kind === "file")
        .map((ref) => ref.recordId),
    ).toEqual(["f1"]);
    expect(result.references.find((ref) => ref.kind === "request")?.href).toBe(
      "/operator/clients/org_1/procurement/r1",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|storage|Private|Unavailable/,
    );
  });

  test("uses scoped client request DTOs and preserves each request grant for the same file", () => {
    const result = build(
      [
        {
          name: "lookup_client_requests",
          output: {
            requests: [
              {
                _id: "request1",
                title: "Renewal",
                status: "in_progress",
                packet: { markdown: "Do not parse prose into facts" },
                files: [
                  {
                    _id: "item1",
                    clientFileId: "sharedFile",
                    name: "Loss runs",
                    url: "SECRET URL",
                  },
                ],
              },
              {
                _id: "request2",
                title: "New coverage",
                status: "completed",
                completionOutcome: "bound",
                files: [
                  {
                    _id: "item2",
                    clientFileId: "sharedFile",
                    name: "Loss runs",
                  },
                ],
              },
            ],
          },
        },
      ],
      "client",
    );
    expect(
      result.references
        .filter((ref) => ref.kind === "file")
        .map((ref) => ref.requestId),
    ).toEqual(["request1", "request2"]);
    expect(result.references.find((ref) => ref.kind === "request")?.href).toBe(
      "/requests/request1",
    );
    expect(JSON.stringify(result)).not.toMatch(/SECRET URL|Do not parse prose/);
  });

  test("compares actual extracted proposal offers and preserves unknown deductible", () => {
    const result = build([
      {
        name: "list_procurement_proposals",
        output: {
          private: true,
          proposals: [
            {
              _id: "p1",
              brokerName: "Agency A",
              status: "ready",
              extractedOffer: {
                carrier: "Insurer A",
                premium: "$4,321",
                coverages: [{ name: "Building", limit: "$1,325,000" }],
              },
              documents: [{ url: "SECRET" }],
            },
            { _id: "p2", brokerName: "Agency B", status: "extracting" },
          ],
        },
      },
    ]);
    const table = result.candidates[0].element;
    if (table.type !== "ComparisonTable") throw new Error("Comparison missing");
    expect(
      table.props.rows.find((row) => row.label === "Total premium")?.values,
    ).toEqual(["$4,321", "Not provided"]);
    expect(
      table.props.rows.find((row) => row.label === "Building")?.values,
    ).toEqual(["Limit: $1,325,000; deductible: Not provided", "Not provided"]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("keeps provider research partial and drops uncited prose and internal lease metadata", () => {
    const result = build([
      {
        name: "get_broker_network_profile",
        output: {
          broker: {
            _id: "b1",
            name: "North Agency",
            companyResearch: {
              status: "partial",
              sourceUrls: ["https://north.example/about"],
              leaseId: "SECRET",
              facts: [
                {
                  key: "operations",
                  content: "Wholesale agency",
                  sourceRef: "https://north.example/about",
                },
                {
                  key: "operations",
                  content: "Unverified claim",
                  sourceRef: "https://unverified.example",
                },
              ],
            },
          },
          profile: { writingStates: ["CA"], lineOfBusinessCodes: ["CGL"] },
        },
      },
    ]);
    const text = JSON.stringify(result);
    expect(text).toContain("partial");
    expect(text).toContain("Wholesale agency");
    expect(text).not.toMatch(/SECRET|Unverified claim|completed/);
    expect(
      result.references.every(
        (reference) => !reference.href || reference.href.startsWith("/"),
      ),
    ).toBe(true);
  });

  test("bounds large evidence without truncating a literal into a different value", () => {
    const result = build(
      Array.from({ length: 100 }, (_, i) => ({
        name: "lookup_policy",
        output: [{ ...policy, id: `policy_${i}`, number: "X".repeat(5000) }],
      })),
    );
    expect(result.candidates.length).toBeLessThanOrEqual(18);
    expect(result.references.length).toBeLessThanOrEqual(80);
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThan(96 * 1024);
    expect(JSON.stringify(result)).not.toContain("X".repeat(100));
  });
});
