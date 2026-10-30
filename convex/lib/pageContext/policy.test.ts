// Failure modes: a policy, requirement or certificate page prefetching another
// record or the client's whole library; a coverage read without the client;
// status-only reads framed as if coverages were loaded; a running or failed
// extraction reported as final; a requirement's status read from the wrong row.
import { expect, test } from "vitest";
import type { OperatorAgentToolName } from "../operatorAgentToolRegistry";
import { operatorPageContextEntry } from ".";
import {
  clientPolicyListHints,
  policyStatusHints,
  requirementHints,
} from "./policy";

const page = (
  pageType: string,
  entityId: string,
  summary: string,
  related: Array<{ kind: string; id: string }>,
) => ({
  pageType,
  entityId,
  summary,
  related,
});

function inputs(
  pageType: string,
  context: ReturnType<typeof page>,
  results = new Map<OperatorAgentToolName, unknown>(),
) {
  return operatorPageContextEntry(pageType)!.prefetch.map((stage) =>
    stage.map((read) => [
      read.toolName,
      read.input({
        focus: { entityId: context.entityId },
        results,
        page: context,
        relatedId: (kind) =>
          context.related.find((entry) => entry.kind === kind)?.id,
      }),
    ]),
  );
}

test("policy group pages read the attached record with the client from the page", () => {
  const org = { kind: "organization", id: "o1" };
  expect(inputs("policy", page("policy", "p1", "Policy GL-1", [org]))).toEqual([
    [
      ["get_policy_status", { policyId: "p1" }],
      ["lookup_policy", { orgId: "o1", policyIds: ["p1"] }],
    ],
    [["lookup_policy", undefined]],
  ]);
  // Without the client on the page, the status read supplies it.
  expect(
    inputs(
      "policy",
      page("policy", "p1", "Policy", []),
      new Map([["get_policy_status", { orgId: "o2" }]]),
    )[1],
  ).toEqual([["lookup_policy", { orgId: "o2", policyIds: ["p1"] }]]);

  expect(
    inputs(
      "requirement",
      page("requirement", "r1", "Requirement: GL each occurrence · Not met", [
        org,
        { kind: "policy", id: "p9" },
      ]),
      new Map([
        [
          "lookup_compliance_requirements",
          { requirements: [{ requirementId: "r1", matchedPolicyIds: ["p1", "p2"] }] },
        ],
      ]),
    ),
  ).toEqual([
    [
      [
        "lookup_compliance_requirements",
        { orgId: "o1", scope: "all", query: "GL each occurrence" },
      ],
    ],
    [["lookup_policy", { orgId: "o1", policyIds: ["p1", "p2"] }]],
  ]);
  expect(
    inputs(
      "certificate",
      page("certificate", "c1", "Certificate for City", [
        org,
        { kind: "policy", id: "p1" },
      ]),
    ),
  ).toEqual([[["lookup_policy", { orgId: "o1", policyIds: ["p1"] }]]]);
  expect(operatorPageContextEntry("certificate")!.staticHints).toHaveLength(2);

  expect(
    policyStatusHints(
      new Map([
        [
          "get_policy_status",
          {
            policyId: "p1",
            orgId: "o1",
            pipelineStatus: "complete",
            extractionDataStage: "preview",
            archived: true,
          },
        ],
      ]),
    ),
  ).toEqual([
    "Client organization (orgId for policy tools): o1",
    "Extraction still running (stage preview); fields may be partial.",
    "Archived policy.",
    'Coverages were not loaded: call lookup_policy with orgId and policyIds ["p1"].',
  ]);
  expect(
    clientPolicyListHints(
      new Map([
        [
          "list_policies",
          {
            policies: [
              { policyNumber: "GL-1", pipelineStatus: "complete" },
              { policyId: "p2", pipelineStatus: "error" },
            ],
            bounded: false,
          },
        ],
      ]),
    ),
  ).toEqual([
    "2 active policies loaded, soonest expiration first; this is every active policy.",
    "Extraction failed: p2",
    "Loaded rows carry identity, term and extraction status only; use lookup_policy for coverages and limits.",
  ]);
  expect(
    requirementHints(
      new Map<OperatorAgentToolName, unknown>([
        [
          "lookup_compliance_requirements",
          {
            requirements: [
              { requirementId: "r0", currentComplianceStatus: "met" },
              {
                requirementId: "r1",
                currentComplianceStatus: "not_met",
                currentComplianceReasons: ["Limit below $2M"],
                matchedPolicyIds: ["p1"],
                requirementSourceDocumentId: "s1",
              },
            ],
          },
        ],
        ["lookup_policy", [{}]],
      ]),
      page("requirement", "r1", "", []),
    ),
  ).toEqual([
    "Saved compliance status: not met (Limit below $2M)",
    "Matched policies: p1 (1 loaded with lookup_policy)",
    "Requirement source (requirementSourceDocumentId for generate_coi): s1",
  ]);
});
