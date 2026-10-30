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

type PolicyList = {
  policies?: Array<PolicyStatus & { policyNumber?: unknown }>;
  bounded?: unknown;
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
function extraction(policy: PolicyStatus) {
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
  const state = extraction(policy);
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

export function clientPolicyListHints(results: Results): string[] {
  const list = results.get("list_policies") as PolicyList | undefined;
  if (!list || typeof list !== "object") return [];
  const policies = Array.isArray(list.policies) ? list.policies : [];
  const numbers = (state: ReturnType<typeof extraction>) =>
    policies
      .filter((policy) => extraction(policy) === state)
      .map((policy) => text(policy.policyNumber) ?? String(policy.policyId));
  const failed = numbers("failed");
  const running = numbers("running");
  return [
    `${policies.length} active ${policies.length === 1 ? "policy" : "policies"} loaded, soonest expiration first${
      list.bounded === true
        ? "; more exist, so follow nextCursor before counting or concluding absence"
        : "; this is every active policy"
    }.`,
    ...(failed.length
      ? [`Extraction failed: ${failed.slice(0, 5).join(", ")}`]
      : []),
    ...(running.length
      ? [`Extraction still running: ${running.slice(0, 5).join(", ")}`]
      : []),
    "Loaded rows carry identity, term and extraction status only; use lookup_policy for coverages and limits.",
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

export function clientComplianceHints(results: Results): string[] {
  if (!results.has("lookup_compliance_requirements")) return [];
  const rows = requirementRows(results);
  const sources = new Set(
    rows.map((row) => text(row.requirementSourceDocumentId)).filter(Boolean),
  );
  return [
    `${statusCounts(rows)} loaded across ${sources.size} requirement source${sources.size === 1 ? "" : "s"}.`,
    "Statuses are the saved compliance checks; treat them as authoritative.",
  ];
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
 * The record's title from the summary the page wrote, e.g. `Requirement:
 * <title> · …` (see components/compliance-page.tsx), to narrow the lookup.
 */
function summaryTitle(page: OperatorPrefetchPage | undefined, prefix: string) {
  const summary = page?.summary;
  if (!summary?.startsWith(prefix)) return undefined;
  return summary.slice(prefix.length).split(" · ")[0]?.trim().slice(0, 200) || undefined;
}

const requirementsLookup =
  (prefix: string): Input =>
  ({ page, relatedId }) => {
    const orgId = relatedId?.("organization");
    if (!orgId) return undefined;
    const query = summaryTitle(page, prefix);
    return { orgId, scope: "all", ...(query ? { query } : {}) };
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
    pageTypes: ["operator_client_policies"],
    noun: "client's policy list",
    families: ["policies"],
    prefetch: [
      [
        {
          toolName: "list_policies",
          input: ({ focus }) =>
            focus.entityId
              ? { orgId: focus.entityId, limit: 25, sort: "expiration_asc" }
              : undefined,
        },
      ],
    ],
    hints: (results) => clientPolicyListHints(results),
  },
  {
    pageTypes: ["operator_client_compliance"],
    noun: "client's compliance page",
    families: ["compliance"],
    prefetch: [
      [
        {
          toolName: "lookup_compliance_requirements",
          input: ({ focus }) =>
            focus.entityId ? { orgId: focus.entityId, scope: "all" } : undefined,
        },
      ],
    ],
    hints: (results) => clientComplianceHints(results),
  },
  {
    pageTypes: ["requirement"],
    noun: "compliance requirement",
    families: ["compliance", "policies"],
    prefetch: [
      [
        {
          toolName: "lookup_compliance_requirements",
          input: requirementsLookup("Requirement: "),
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
          input: requirementsLookup("Requirement source: "),
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
