import type {
  OperatorIntentPrefetchRead,
  OperatorPrefetchPage,
} from "../operatorAgentIntentRegistry";
import type { OperatorAgentToolName } from "../operatorAgentToolRegistry";
import type { OperatorPageContextEntry } from "./types";

type Results = ReadonlyMap<OperatorAgentToolName, unknown>;
type Input = OperatorIntentPrefetchRead["input"];

type PolicyStatus = {
  policyId?: unknown;
  orgId?: unknown;
  extractionDataStage?: unknown;
  pipelineStatus?: unknown;
  pipelineError?: unknown;
  archived?: unknown;
};

type RequirementRow = {
  requirementId?: unknown;
  title?: unknown;
  requirementSourceDocumentId?: unknown;
  currentComplianceStatus?: unknown;
  currentComplianceReasons?: unknown;
  matchedPolicyIds?: unknown;
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const ids = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id !== "")
    : [];

/** Same rule as the UI's extraction state: final data, still running, or failed. */
export function policyExtraction(policy: PolicyStatus) {
  if (policy.pipelineStatus === "error") return "failed" as const;
  const stage = text(policy.extractionDataStage);
  const complete =
    policy.pipelineStatus === "complete"
      ? !stage || stage === "final"
      : !policy.pipelineStatus && stage === "final";
  return complete ? ("final" as const) : ("running" as const);
}

// lookup_policy returns the formatted policies as an array.
const loadedPolicyCount = (results: Results) => {
  const read = results.get("lookup_policy");
  return Array.isArray(read) ? read.length : undefined;
};

/**
 * The policy's client, extraction state and archive flag; when the coverage
 * summary did not load, where it comes from.
 */
export function policyStatusHints(results: Results): string[] {
  const policy = results.get("get_policy_status") as PolicyStatus | undefined;
  if (!policy || typeof policy !== "object") return [];
  const policyId = text(policy.policyId);
  const orgId = text(policy.orgId);
  const state = policyExtraction(policy);
  return [
    ...(orgId ? [`Client organization (orgId for policy tools): ${orgId}`] : []),
    state === "failed"
      ? `Extraction failed${text(policy.pipelineError) ? `: ${text(policy.pipelineError)!.slice(0, 160)}` : ""}`
      : state === "running"
        ? `Extraction still running (stage ${text(policy.extractionDataStage) ?? "pending"}); fields may be partial.`
        : "Extraction complete: final policy data is available.",
    ...(policy.archived === true ? ["Archived policy."] : []),
    ...(results.has("lookup_policy")
      ? []
      : [
          `Coverages were not loaded: call lookup_policy with orgId and policyIds ["${policyId ?? "this policy"}"].`,
        ]),
  ];
}

const requirementRows = (results: Results): RequirementRow[] => {
  const read = results.get("lookup_compliance_requirements") as
    | { requirements?: unknown }
    | undefined;
  return Array.isArray(read?.requirements)
    ? (read.requirements as RequirementRow[])
    : [];
};

/** `12 requirements: 3 not met, 9 met`, by saved compliance status. */
function statusCounts(rows: RequirementRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = text(row.currentComplianceStatus) ?? "unverified";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = [...counts]
    .sort(([, left], [, right]) => right - left)
    .map(([status, count]) => `${count} ${status.replaceAll("_", " ")}`);
  return `${rows.length} requirement${rows.length === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

export function requirementHints(
  results: Results,
  page: OperatorPrefetchPage,
): string[] {
  if (!results.has("lookup_compliance_requirements")) return [];
  const row = requirementRows(results).find(
    (candidate) => candidate.requirementId === page.entityId,
  );
  if (!row)
    return [
      `Requirement ${page.entityId} is not among the loaded results; call lookup_compliance_requirements with a narrower query from its title.`,
    ];
  const reasons = Array.isArray(row.currentComplianceReasons)
    ? row.currentComplianceReasons.filter(
        (reason): reason is string => typeof reason === "string",
      )
    : [];
  const matched = ids(row.matchedPolicyIds);
  const policies = loadedPolicyCount(results);
  return [
    `Saved compliance status: ${(text(row.currentComplianceStatus) ?? "unverified").replaceAll("_", " ")}${
      reasons.length ? ` (${reasons.slice(0, 3).join("; ").slice(0, 300)})` : ""
    }`,
    matched.length
      ? `Matched policies: ${matched.join(", ")}${policies !== undefined ? ` (${policies} loaded with lookup_policy)` : ""}`
      : "No policy is matched to this requirement.",
    ...(text(row.requirementSourceDocumentId)
      ? [
          `Requirement source (requirementSourceDocumentId for generate_coi): ${text(row.requirementSourceDocumentId)}`,
        ]
      : []),
  ];
}

export function requirementSourceHints(
  results: Results,
  page: OperatorPrefetchPage,
): string[] {
  if (!results.has("lookup_compliance_requirements")) return [];
  const rows = requirementRows(results).filter(
    (row) => row.requirementSourceDocumentId === page.entityId,
  );
  return [
    rows.length
      ? `${statusCounts(rows)} from this source loaded.`
      : "None of the loaded requirements cite this source; call lookup_compliance_requirements without a query to see every requirement.",
    `generate_coi takes requirementSourceDocumentId ${page.entityId} to issue certificates for the whole source.`,
  ];
}

/**
 * The page's own requirement or source, narrowed by the title the page gives
 * as its self entry in `related`. Without a title it is skipped rather than
 * reading every requirement.
 */
const requirementsLookup =
  (kind: "requirement" | "requirement_source"): Input =>
  ({ relatedId, relatedLabel }) => {
    const orgId = relatedId?.("organization");
    const query = relatedLabel?.(kind)?.slice(0, 500);
    return orgId && query ? { orgId, scope: "all", query } : undefined;
  };

const POLICY_SUMMARY_PARTIAL =
  "a coverage summary; lookup_policy_section returns exact wording, endorsements and exclusions";

/**
 * Policy, compliance and certificate pages. Reads are bounded by the core's
 * output limit; action reads fail open after its timeout.
 */
export const policyPageContexts: readonly OperatorPageContextEntry[] = [
  {
    pageTypes: ["policy"],
    noun: "policy",
    families: ["policies"],
    prefetch: [
      [
        {
          toolName: "get_policy_status",
          input: ({ focus }) =>
            focus.entityId ? { policyId: focus.entityId } : undefined,
        },
        {
          toolName: "lookup_policy",
          input: ({ focus, relatedId }) => {
            const orgId = relatedId?.("organization");
            return focus.entityId && orgId
              ? { orgId, policyIds: [focus.entityId] }
              : undefined;
          },
          partial: POLICY_SUMMARY_PARTIAL,
        },
      ],
      // Without the client on the page, the status read names it.
      [
        {
          toolName: "lookup_policy",
          input: ({ focus, results, relatedId }) => {
            if (relatedId?.("organization") || !focus.entityId) return undefined;
            const orgId = text(
              (results.get("get_policy_status") as PolicyStatus | undefined)
                ?.orgId,
            );
            return orgId ? { orgId, policyIds: [focus.entityId] } : undefined;
          },
        },
      ],
    ],
    hints: (results) => policyStatusHints(results),
  },


  {
    pageTypes: ["requirement"],
    noun: "compliance requirement",
    families: ["compliance", "policies"],
    prefetch: [
      [
        {
          toolName: "lookup_compliance_requirements",
          input: requirementsLookup("requirement"),
        },
      ],
      [
        {
          toolName: "lookup_policy",
          input: ({ focus, page, relatedId, results }) => {
            const orgId = relatedId?.("organization");
            const row = (
              (results.get("lookup_compliance_requirements") as
                | { requirements?: RequirementRow[] }
                | undefined)?.requirements ?? []
            ).find((candidate) => candidate.requirementId === focus.entityId);
            // The saved check is fresher than the page's snapshot.
            const policyIds = (
              row
                ? ids(row.matchedPolicyIds)
                : (page?.related ?? [])
                    .filter((entry) => entry.kind === "policy")
                    .map((entry) => entry.id)
            ).slice(0, 5);
            return orgId && policyIds.length ? { orgId, policyIds } : undefined;
          },
        },
      ],
    ],
    hints: requirementHints,
  },
  {
    pageTypes: ["requirement_source"],
    noun: "requirement source",
    families: ["compliance"],
    prefetch: [
      [
        {
          toolName: "lookup_compliance_requirements",
          input: requirementsLookup("requirement_source"),
        },
      ],
    ],
    hints: requirementSourceHints,
  },
  {
    pageTypes: ["certificate"],
    noun: "certificate of insurance",
    families: ["compliance", "policies"],
    prefetch: [
      [
        {
          toolName: "lookup_policy",
          input: ({ relatedId }) => {
            const orgId = relatedId?.("organization");
            const policyId = relatedId?.("policy");
            return orgId && policyId ? { orgId, policyIds: [policyId] } : undefined;
          },
          partial: `the certificate's policy only; no tool reads the certificate itself. ${POLICY_SUMMARY_PARTIAL}`,
        },
      ],
    ],
    staticHints: [
      "No tool reads a certificate itself: work from the summary and the related policy (lookup_policy with its policyId).",
      "Reissuing or changing the holder generates a new version with generate_coi (policyId plus holder, or the related requirementSourceDocumentId), which needs the operator's exact confirmation.",
    ],
  },
];
