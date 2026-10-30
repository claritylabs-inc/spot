import type { OperatorPageContextEntry } from "./types";

type RequestRead = {
  request?: {
    procurementRequestId?: unknown;
    clientOrgId?: unknown;
    clientName?: unknown;
    status?: unknown;
  };
  outreaches?: Array<{ status?: unknown }>;
  proposals?: Array<{
    status?: unknown;
    reviewConclusion?: unknown;
    reviewStale?: unknown;
  }>;
  proposalsNextCursor?: unknown;
};

type ProposalRead = {
  _id?: unknown;
  requestId?: unknown;
  brokerName?: unknown;
  status?: unknown;
  reviews?: Array<{
    modelConclusion?: unknown;
    staffConclusion?: unknown;
    stale?: unknown;
  }>;
  nextActions?: Array<{ tool?: unknown; why?: unknown }>;
};

type RequestListRead = {
  requests?: Array<{ status?: unknown }>;
  bounded?: unknown;
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const label = (value: unknown) => text(value)?.replaceAll("_", " ");

/** `2 quote received, 1 request sent`, most common first. */
function countBy(rows: ReadonlyArray<{ status?: unknown }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = label(row.status) ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

/**
 * Where the placement stands, derived in code from the prefetched request and
 * the proposal open in its drawer.
 */
export function procurementRequestHints(
  requestRead: unknown,
  proposalRead: unknown,
): string[] {
  const read = requestRead as RequestRead | undefined;
  const hints: string[] = [];
  const request = read?.request;
  if (request && typeof request === "object") {
    const orgId = text(request.clientOrgId);
    if (orgId)
      hints.push(
        `Client: ${text(request.clientName) ?? "unnamed"} (orgId ${orgId})`,
      );
    const outreaches = Array.isArray(read.outreaches) ? read.outreaches : [];
    hints.push(
      outreaches.length
        ? `Provider outreach: ${outreaches.length}${outreaches.length >= 100 ? "+" : ""} (${countBy(outreaches)})`
        : "No provider outreach yet.",
    );
    const proposals = Array.isArray(read.proposals) ? read.proposals : [];
    const more = typeof read.proposalsNextCursor === "string";
    if (!proposals.length) hints.push("No proposals yet.");
    else {
      const stale = proposals.filter((row) => row.reviewStale === true).length;
      const unreviewed = proposals.filter(
        (row) => !row.reviewConclusion,
      ).length;
      hints.push(
        `Proposals: ${proposals.length}${more ? "+ (more pages)" : ""} (${countBy(proposals)})${
          unreviewed ? `; ${unreviewed} without a review` : ""
        }${stale ? `; ${stale} with a stale review` : ""}`,
      );
    }
  }
  const proposal = proposalRead as ProposalRead | undefined;
  const proposalId = text(proposal?._id);
  if (proposal && proposalId) {
    const requestId = text(request?.procurementRequestId);
    if (requestId && text(proposal.requestId) !== requestId) {
      hints.push(
        `The proposal open in the drawer (${proposalId}) belongs to another request (${text(proposal.requestId) ?? "unknown"}).`,
      );
    } else {
      const review = Array.isArray(proposal.reviews)
        ? proposal.reviews[0]
        : undefined;
      const conclusion = label(
        review?.staffConclusion ?? review?.modelConclusion,
      );
      hints.push(
        `Open proposal ${proposalId}: ${text(proposal.brokerName) ?? "unknown provider"}, ${label(proposal.status) ?? "unknown status"}, ${
          conclusion
            ? `review ${conclusion}${review?.staffConclusion ? "" : " (not staff-confirmed)"}${review?.stale === true ? " (stale)" : ""}`
            : "not reviewed"
        }`,
      );
      const next = Array.isArray(proposal.nextActions)
        ? proposal.nextActions[0]
        : undefined;
      const tool = text(next?.tool);
      if (tool)
        hints.push(
          `Its suggested next step: ${tool}${text(next?.why) ? ` (${text(next?.why)!.slice(0, 160)})` : ""}`,
        );
    }
  }
  return hints;
}

/** Request counts on the prefetched page of a client's procurement list. */
export function procurementListHints(listRead: unknown): string[] {
  const read = listRead as RequestListRead | undefined;
  if (!read || !Array.isArray(read.requests)) return [];
  if (!read.requests.length) return ["The client has no procurement requests."];
  return [
    `Requests: ${read.requests.length}${read.bounded === true ? "+ (more pages)" : ""} (${countBy(read.requests)})`,
  ];
}

export const procurementPageContexts: readonly OperatorPageContextEntry[] = [
  {
    pageTypes: ["procurement_request"],
    noun: "procurement request",
    families: ["procurement"],
    prefetch: [
      [
        {
          toolName: "get_procurement_request",
          input: ({ focus }) =>
            focus.entityId
              ? {
                  procurementRequestId: focus.entityId,
                  include: ["outreach", "proposals"],
                  view: "summary",
                }
              : undefined,
        },
        {
          toolName: "get_procurement_proposal",
          input: ({ relatedId }) => {
            const proposalId = relatedId?.("procurement_proposal");
            return proposalId
              ? { procurementProposalId: proposalId, view: "compact" }
              : undefined;
          },
        },
        {
          // An open information form or question.
          toolName: "get_procurement_information",
          input: ({ focus, relatedId }) =>
            focus.entityId &&
            (relatedId?.("procurement_information_form") ??
              relatedId?.("procurement_information_question"))
              ? {
                  procurementRequestId: focus.entityId,
                  include: ["information"],
                }
              : undefined,
        },
      ],
    ],
    hints: (results) =>
      procurementRequestHints(
        results.get("get_procurement_request"),
        results.get("get_procurement_proposal"),
      ),
  },
  {
    pageTypes: ["operator_client_procurement"],
    noun: "client procurement list",
    families: ["procurement"],
    prefetch: [
      [
        {
          toolName: "list_procurement_requests",
          input: ({ focus }) =>
            focus.entityId
              ? { orgId: focus.entityId, view: "summary", limit: 50 }
              : undefined,
        },
      ],
    ],
    hints: (results) =>
      procurementListHints(results.get("list_procurement_requests")),
  },
  {
    // Every client's requests: no single record to read.
    pageTypes: ["operator_procurement"],
    noun: "procurement list across clients",
    families: ["procurement"],
    prefetch: [],
  },
];
