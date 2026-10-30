import type { OperatorPageContextEntry } from "./types";

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

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

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

/**
 * get_policy_status returns identity and extraction state only, so the hints
 * say where coverages and wording come from instead of implying they are
 * loaded.
 */
export function policyStatusHints(read: unknown): string[] {
  const policy = read as PolicyStatus | undefined;
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
    `Loaded: identity and extraction status only. For coverages, limits, premium or terms call lookup_policy with orgId and policyIds ["${policyId ?? "this policy"}"]; for exact wording call lookup_policy_section.`,
  ];
}

export function clientPolicyListHints(read: unknown): string[] {
  const list = read as PolicyList | undefined;
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

/**
 * Policy, compliance and certificate pages. Compliance requirements and
 * policy coverages are read by actions (lookup_compliance_requirements,
 * lookup_policy), which prefetch does not run, so those pages only require
 * their families and the model reads them itself.
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
      ],
    ],
    hints: (results) => policyStatusHints(results.get("get_policy_status")),
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
    hints: (results) => clientPolicyListHints(results.get("list_policies")),
  },
  {
    pageTypes: ["operator_client_compliance"],
    noun: "client's compliance page",
    families: ["compliance"],
    prefetch: [],
  },
  {
    pageTypes: ["requirement_source"],
    noun: "requirement source",
    families: ["compliance"],
    prefetch: [],
  },
  {
    pageTypes: ["requirement"],
    noun: "compliance requirement",
    families: ["compliance", "policies"],
    prefetch: [],
  },
  {
    pageTypes: ["certificate"],
    noun: "certificate of insurance",
    families: ["compliance", "policies"],
    prefetch: [],
  },
];
