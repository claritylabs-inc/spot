import { beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  JEV_MODEL,
  parseDecideRequest,
  parseDecideResponse,
} from "@claritylabs/cl-router-policy";
import { capturePresentationTool } from "../chatPresentations";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildAgentToolExecutors } from "./agentToolExecutors";
import { buildPresentationCandidates } from "./chatPresentationCandidates";
import { composeChatPresentation } from "./chatPresentationComposer";
import { clRouterDecide } from "./clRouterClient";
import {
  parseChatPresentation,
  type PresentationEvidence,
} from "../../lib/chat-presentation";

vi.mock("./clRouterClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clRouterClient")>()),
  clRouterDecide: vi.fn(),
}));

function snapshot(name: string, output: unknown) {
  const first = capturePresentationTool(name, output);
  if (!first) throw new Error(`Capture lost ${name}`);
  const persisted = capturePresentationTool(name, JSON.parse(first.outputJson));
  if (!persisted) throw new Error(`Persistence lost ${name}`);
  return { name, output: JSON.parse(persisted.outputJson) as unknown };
}
function evidence(
  tools: PresentationEvidence["tools"],
  audience: PresentationEvidence["audience"] = "operator",
): PresentationEvidence {
  return {
    audience,
    tools,
    prompt: "Compare the returned evidence",
    response: "Do not infer facts from this prose",
  };
}
const orgId = "org1" as Id<"organizations">;
const policies = [
  {
    _id: "policy1",
    orgId,
    carrier: "Insurer",
    policyNumber: "CGL-123",
    insuredName: "Cove LLC",
    linesOfBusiness: ["CGL"],
    effectiveDate: "2026-01-01",
    expirationDate: "2027-01-01",
    premium: "$1,234",
    extractionDataStage: "final",
    pipelineStatus: "complete",
    coverages: [
      {
        name: "General liability",
        limit: "$1,000,000",
        deductible: "$0",
        sourceSpanIds: ["pdf:4"],
      },
    ],
  },
];
const proposal = {
  _id: "proposal1",
  requestId: "request1",
  clientOrgId: orgId,
  brokerName: "Agency",
  extractionFingerprint: "fp1",
  documents: [
    {
      _id: "document1",
      clientFileId: "file1",
      fileName: "Quote.pdf",
      url: "SECRET",
    },
  ],
  extractedOffer: {
    carrier: "Insurer",
    premium: "$1,234",
    subjectivities: [
      { category: "Underwriting", description: "Loss runs required." },
    ],
    exclusions: [
      {
        name: "Flood",
        content: "Flood excluded.",
        evidence: [
          {
            proposalDocumentId: "document1",
            sourceSpanIds: ["span1"],
            pageStart: 2,
          },
        ],
      },
    ],
  },
  sectionHeadings: { liability: "General liability" },
  reviews: [
    {
      stale: false,
      confirmedAt: 123,
      confirmedByUserId: "operator1",
      extractionFingerprint: "fp1",
      staffConclusion: "meets_requirements",
      findings: [
        {
          sectionKey: "liability",
          conclusion: "meets",
          summary: "Limit meets the requirement.",
          evidence: [
            {
              proposalDocumentId: "document1",
              sourceSpanIds: ["span1"],
              pageStart: 2,
            },
          ],
        },
      ],
    },
  ],
};

function executors() {
  const runQuery = vi.fn(async (ref) => {
    const name = getFunctionName(ref);
    if (name.startsWith("policies:")) return policies;
    if (name === "compliance:listRequirementsInternal")
      return [
        {
          _id: "requirement1",
          title: "GL",
          scope: "own_org",
          requirementText: "Carry GL",
          limits: [{ kind: "per_occurrence", amount: 1000000 }],
          complianceCheck: {
            status: "not_met",
            reasons: ["limit_below_required:per_occurrence"],
            matchedPolicyIds: ["policy1"],
          },
        },
      ];
    if (name === "clientProcurementRequests:listForAgentInternal")
      return [
        {
          _id: "request1",
          title: "Renewal",
          status: "completed",
          completionOutcome: {
            kind: "placed_elsewhere",
            provider: "Agency",
            purchaseDate: "2026-09-01",
          },
          files: [
            {
              _id: "item1",
              clientFileId: "file1",
              name: "Loss runs.pdf",
              url: "SECRET",
            },
          ],
        },
      ];
    return { name: "Cove LLC" };
  });
  return buildAgentToolExecutors({ runQuery } as unknown as ActionCtx, {
    surface: "web",
    orgId,
    userId: "user1" as Id<"users">,
    scope: {
      mode: "client",
      surface: "web",
      primaryOrgId: orgId,
      readOrgIds: [orgId],
      writableOrgIds: [],
      brokerInternal: false,
      orgs: [
        {
          orgId,
          name: "Cove LLC",
          type: "client",
          isPrimary: true,
          canWrite: false,
        },
      ],
    },
  });
}

function validatedDecision(
  request: Parameters<typeof clRouterDecide>[0],
  abstain = false,
) {
  const parsed = parseDecideRequest({ ...request, tenantId: "glass" });
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([key, question]) => {
      if (question.type !== "choice")
        throw new Error("Expected native discrete choices");
      const keys = Object.keys(question.criteria);
      const choice =
        key === "root"
          ? abstain
            ? "unavailable"
            : "layout"
          : (keys.find((key) => key.startsWith("use:candidate")) ?? keys[0]);
      return [
        key,
        {
          type: "choice",
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(
            keys.map((key) => [key, key === choice ? 1 : 0]),
          ),
        },
      ];
    }),
  );
  return parseDecideResponse(
    {
      contractVersion: 1,
      requestId: "decision1",
      model: JEV_MODEL,
      answers,
      usage: { inputTokens: 20, outputTokens: 5 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 10,
    },
    parsed,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clRouterDecide).mockImplementation(async (request) =>
    validatedDecision(request),
  );
});

describe("captured tool evidence through native composition", () => {
  test("preserves real policy and requirement DTO values through capture and router-validated composition", async () => {
    const tools = executors();
    const snapshots = [
      snapshot("lookup_policy", await tools.lookup_policy.execute({})),
      snapshot(
        "lookup_compliance_requirements",
        await tools.lookup_compliance_requirements.execute({}),
      ),
    ];
    const captured = evidence(snapshots, "client");
    const candidates = buildPresentationCandidates(captured);
    expect(JSON.stringify(candidates)).toContain("$1,000,000");
    expect(JSON.stringify(candidates)).toContain("$0");
    expect(
      candidates.candidates.some(
        (candidate) => candidate.element.type === "RequirementMatrix",
      ),
    ).toBe(true);
    const result = await composeChatPresentation(
      { runMutation: vi.fn() } as unknown as ActionCtx,
      { evidence: captured, sourceRevision: "rev1" },
    );
    expect(result).not.toBeNull();
    expect(parseChatPresentation(result)).toEqual(result);
    expect(clRouterDecide).toHaveBeenCalledTimes(2);
  });

  test("preserves client request completion facts and request-scoped file references", async () => {
    const result = buildPresentationCandidates(
      evidence(
        [
          snapshot(
            "lookup_client_requests",
            await executors().lookup_client_requests.execute({}),
          ),
        ],
        "client",
      ),
    );
    expect(result.references).toContainEqual(
      expect.objectContaining({
        kind: "file",
        recordId: "file1",
        requestId: "request1",
      }),
    );
    expect(JSON.stringify(result)).toContain("2026-09-01");
    expect(JSON.stringify(result)).toContain("Agency");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test.each(["get_procurement_proposal", "list_procurement_proposals"])(
    "retains owned proposal documents and current confirmed findings through %s capture",
    (name) => {
      const output =
        name === "get_procurement_proposal"
          ? proposal
          : { proposals: [proposal], private: true };
      const result = buildPresentationCandidates(
        evidence([snapshot(name, output)]),
      );
      const findings = result.candidates.flatMap((candidate) =>
        candidate.element.type === "FindingsList"
          ? candidate.element.props.findings
          : [],
      );
      expect(findings).toContainEqual(
        expect.objectContaining({
          label: "General liability",
          status: "satisfied",
        }),
      );
      expect(findings).toContainEqual(
        expect.objectContaining({
          label: "Subjectivity: Underwriting",
          status: "uncertain",
        }),
      );
      expect(result.references).toContainEqual(
        expect.objectContaining({
          kind: "file",
          recordId: "file1",
          sourceSpanIds: ["span1"],
          page: 2,
        }),
      );
      expect(JSON.stringify(result)).not.toContain("SECRET");
    },
  );

  test("keeps exact policy spans and verified provider URLs while excluding their private payloads", () => {
    const result = buildPresentationCandidates(
      evidence([
        snapshot("lookup_policy_section", {
          policyId: "policy1",
          results: [
            {
              title: "Flood",
              content: "Flood excluded.",
              originalPdfChecked: true,
              sourceSpanIds: ["pdf:4"],
              sourceSpans: [
                { id: "pdf:4", pageStart: 4, metadata: { secret: "SECRET" } },
              ],
            },
          ],
        }),
        snapshot("get_broker_network_profile", {
          broker: {
            _id: "broker1",
            name: "Agency",
            companyResearch: {
              status: "partial",
              sourceUrls: ["https://agency.example/about"],
              facts: [
                {
                  key: "operations",
                  content: "Independent agency.",
                  sourceRef: "https://agency.example/about",
                },
              ],
              leaseId: "SECRET",
            },
          },
          profile: { writingStates: ["CA"], lineOfBusinessCodes: ["CGL"] },
        }),
      ]),
    );
    expect(result.references).toContainEqual(
      expect.objectContaining({
        policyId: "policy1",
        sourceSpanIds: ["pdf:4"],
        page: 4,
      }),
    );
    expect(result.references).toContainEqual(
      expect.objectContaining({
        kind: "source",
        recordId: "broker1",
        sourceUrl: "https://agency.example/about",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("marks capture-side truncation when a long source excerpt is dropped", () => {
    const result = buildPresentationCandidates(
      evidence([
        snapshot("lookup_policy_section", {
          policyId: "policy1",
          results: [
            {
              title: "Short excerpt",
              content: "Terms",
              originalPdfChecked: true,
              sourceSpanIds: ["span1"],
            },
            {
              title: "Long excerpt",
              content: "x".repeat(5000),
              originalPdfChecked: true,
              sourceSpanIds: ["span2"],
            },
          ],
        }),
      ]),
    );
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.element.type === "Text" &&
          candidate.element.props.text.startsWith("Partial results shown"),
      ),
    ).toBe(true);
  });

  test("preserves marker-only capture loss beside retained facts through native composition", async () => {
    const captured = evidence([
      snapshot("lookup_policy", await executors().lookup_policy.execute({})),
      snapshot("get_procurement_proposal", {
        proposals: Array.from({ length: 40 }, (_, index) => ({
          _id: `proposal${index}`,
          description: "x".repeat(3000),
        })),
      }),
    ]);
    expect(captured.tools[1].output).toEqual({ bounded: true });
    const result = await composeChatPresentation(
      { runMutation: vi.fn() } as unknown as ActionCtx,
      { evidence: captured, sourceRevision: "partial" },
    );
    expect(result).not.toBeNull();
    expect(Object.values(result!.spec.elements)).toContainEqual({
      type: "Text",
      props: {
        text: "Partial results shown. Open the full records for a complete review.",
      },
      children: [],
    });
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
  });

  test("native abstention retains text fallback and client scope excludes captured private proposal evidence", async () => {
    const privateEvidence = snapshot("get_procurement_proposal", proposal);
    expect(
      buildPresentationCandidates(evidence([privateEvidence], "client")),
    ).toEqual({ candidates: [], references: [] });
    vi.mocked(clRouterDecide).mockImplementation(async (request) =>
      validatedDecision(request, true),
    );
    expect(
      await composeChatPresentation(
        { runMutation: vi.fn() } as unknown as ActionCtx,
        { evidence: evidence([privateEvidence]), sourceRevision: "abstain" },
      ),
    ).toBeNull();
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
  });
});
