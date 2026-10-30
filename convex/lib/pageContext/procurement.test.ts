// Failure modes: a section or drawer read issued without its section or
// related record, or for another request's proposal without saying so.
import { expect, test } from "vitest";
import { operatorPageContextEntry } from ".";
import { procurementRequestHints } from "./procurement";

test("a procurement request reads what its section and drawer show", () => {
  const entry = operatorPageContextEntry("procurement_request")!;
  const [stage] = entry.prefetch;
  const inputs = (
    page: { href?: string },
    related: Record<string, string> = {},
  ) =>
    Object.fromEntries(
      stage.flatMap((read) => {
        const input = read.input({
          focus: { entityId: "r1" },
          results: new Map(),
          relatedId: (kind) => related[kind],
          page: {
            pageType: "procurement_request",
            entityId: "r1",
            ...page,
            related: Object.entries(related).map(([kind, id]) => ({
              kind,
              id,
            })),
          },
        });
        return input ? [[read.toolName, input]] : [];
      }),
    );
  const href = (view: string) =>
    `/operator/clients/o1/procurement/r1?view=${view}`;
  // The application view reads the request's summary only.
  expect(inputs({ href: href("application") }, { organization: "o1" })).toEqual(
    {
      get_procurement_request: { procurementRequestId: "r1", view: "summary" },
    },
  );
  expect(inputs({ href: href("market") })).toEqual({
    get_procurement_request: {
      procurementRequestId: "r1",
      include: ["outreach", "proposals"],
      view: "summary",
    },
  });
  expect(inputs({ href: href("information") })).toMatchObject({
    get_procurement_information: {
      procurementRequestId: "r1",
      include: ["information"],
    },
  });
  expect(inputs({}, { view: "submission_notes" })).toMatchObject({
    get_procurement_packet: { procurementRequestId: "r1", view: "internal" },
  });
  // A drawer's records are read whatever the section.
  expect(
    inputs(
      { href: href("application") },
      { procurement_proposal: "p1", client_file: "f1" },
    ),
  ).toEqual({
    get_procurement_request: {
      procurementRequestId: "r1",
      include: ["outreach", "proposals"],
      view: "summary",
    },
    get_procurement_proposal: { procurementProposalId: "p1", view: "compact" },
    read_client_file: { clientFileId: "f1", maxChars: 6_000 },
  });

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
