// Failure modes: a drawer's proposal or information read issued without its
// related record, or for another request's proposal without saying so.
import { expect, test } from "vitest";
import { operatorPageContextEntry } from ".";
import { procurementRequestHints } from "./procurement";

test("a procurement request reads its drawer's records only when they are attached", () => {
  const entry = operatorPageContextEntry("procurement_request")!;
  const [stage] = entry.prefetch;
  const inputs = (related: Record<string, string>) =>
    stage.map((read) => [
      read.toolName,
      read.input({
        focus: { entityId: "r1" },
        results: new Map(),
        relatedId: (kind) => related[kind],
      }),
    ]);
  expect(inputs({ organization: "o1" })).toEqual([
    [
      "get_procurement_request",
      {
        procurementRequestId: "r1",
        include: ["outreach", "proposals"],
        view: "summary",
      },
    ],
    ["get_procurement_proposal", undefined],
    ["get_procurement_information", undefined],
  ]);
  expect(
    inputs({
      procurement_proposal: "p1",
      procurement_information_question: "q1",
    }).slice(1),
  ).toEqual([
    [
      "get_procurement_proposal",
      { procurementProposalId: "p1", view: "compact" },
    ],
    [
      "get_procurement_information",
      { procurementRequestId: "r1", include: ["information"] },
    ],
  ]);

  const request = {
    request: {
      procurementRequestId: "r1",
      clientOrgId: "o1",
      clientName: "Acme",
    },
    outreaches: [
      { status: "quote_received" },
      { status: "request_sent" },
      { status: "quote_received" },
    ],
    proposals: [
      { status: "submitted", reviewConclusion: null, reviewStale: null },
      { status: "reviewed", reviewConclusion: "has_gaps", reviewStale: true },
    ],
    proposalsNextCursor: null,
  };
  const proposal = {
    _id: "p1",
    requestId: "r1",
    brokerName: "Marsh",
    status: "submitted",
    reviews: [{ modelConclusion: "has_gaps", stale: false }],
    nextActions: [
      {
        tool: "confirm_procurement_proposal_review",
        why: "Staff must confirm",
      },
    ],
  };
  expect(procurementRequestHints(request, proposal)).toEqual([
    "Client: Acme (orgId o1)",
    "Provider outreach: 3 (2 quote received, 1 request sent)",
    "Proposals: 2 (1 submitted, 1 reviewed); 1 without a review; 1 with a stale review",
    "Open proposal p1: Marsh, submitted, review has gaps (not staff-confirmed)",
    "Its suggested next step: confirm_procurement_proposal_review (Staff must confirm)",
  ]);
  expect(
    procurementRequestHints(request, { ...proposal, requestId: "r2" }).at(-1),
  ).toBe(
    "The proposal open in the drawer (p1) belongs to another request (r2).",
  );
});
