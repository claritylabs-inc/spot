import type { OperatorIntentPrefetchRead } from "../operatorAgentIntentRegistry";
import type { OperatorAgentToolName } from "../operatorAgentToolRegistry";
import type { OperatorPageContextEntry } from "./types";

type Results = ReadonlyMap<OperatorAgentToolName, unknown>;

type OrganizationRead = {
  orgId?: unknown;
  name?: unknown;
  clientAccessStatus?: unknown;
  assignee?: { name?: unknown } | null;
  memberCount?: unknown;
  policyCount?: unknown;
  archivedPolicyCount?: unknown;
  countsAreLowerBounds?: unknown;
};

type WikiRead = {
  revision?: unknown;
  businessProfile?: { submittedAt?: unknown } | null;
  proposals?: unknown[];
};

type FilesRead = { files?: unknown[]; bounded?: unknown };

type PoliciesRead = {
  policies?: Array<{ pipelineStatus?: unknown }>;
  matchedInScan?: unknown;
  bounded?: unknown;
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const RECENT_FILES = 25;
const POLICIES = 25;

const organization: OperatorIntentPrefetchRead = {
  toolName: "get_organization",
  input: ({ focus }) => (focus.entityId ? { orgId: focus.entityId } : undefined),
};

function organizationHints(results: Results) {
  const org = results.get("get_organization") as OrganizationRead | undefined;
  if (!org || typeof org !== "object") return [];
  const name = text(org.name) ?? "unnamed";
  const status = text(org.clientAccessStatus);
  const assignee = text(org.assignee?.name);
  const hints = [
    `Client: ${name} (${String(org.orgId)})${status ? `, access ${status}` : ""}, ${
      assignee ? `assigned to ${assignee}` : "unassigned"
    }`,
  ];
  if (typeof org.policyCount === "number") {
    const plus = org.countsAreLowerBounds === true ? "+" : "";
    hints.push(
      `${org.policyCount}${plus} active and ${String(org.archivedPolicyCount ?? 0)}${plus} archived policies, ${String(org.memberCount ?? 0)}${plus} members`,
    );
  }
  return hints;
}

function wikiHints(results: Results) {
  const wiki = results.get("lookup_client_wiki") as WikiRead | undefined;
  if (!wiki || typeof wiki !== "object") return [];
  const submittedAt = wiki.businessProfile?.submittedAt;
  return [
    typeof submittedAt === "number"
      ? `Business profile version ${submittedAt} (expectedVersion for update_client_business_profile)`
      : "No business profile saved yet (expectedVersion 0 for update_client_business_profile)",
    `Company notes revision ${String(wiki.revision ?? 0)} (expectedRevision for update_client_wiki replace mode)`,
    ...(Array.isArray(wiki.proposals) && wiki.proposals.length > 0
      ? [`${wiki.proposals.length} proposed notes updates awaiting review`]
      : []),
  ];
}

function clientFilesHints(results: Results) {
  const read = results.get("list_client_files") as FilesRead | undefined;
  if (!read || !Array.isArray(read.files)) return [];
  return [
    `${read.files.length} newest active files listed${read.bounded === true ? "; more exist" : ""}. File text is not loaded: read it with read_client_file.`,
  ];
}

function policiesHints(results: Results) {
  const read = results.get("list_policies") as PoliciesRead | undefined;
  if (!read || !Array.isArray(read.policies)) return [];
  const failed = read.policies.filter(
    (policy) => policy.pipelineStatus === "error",
  ).length;
  return [
    `${String(read.matchedInScan ?? read.policies.length)} active policies, earliest expiration first${
      read.bounded === true ? `; only the first ${read.policies.length} are listed` : ""
    }`,
    ...(failed > 0 ? [`${failed} listed policies have an extraction error`] : []),
  ];
}

export const clientPageContexts: readonly OperatorPageContextEntry[] = [
  {
    pageTypes: ["operator_client"],
    noun: "client",
    families: ["organizations"],
    prefetch: [
      [
        {
          toolName: "get_organization",
          input: ({ focus }) =>
            focus.entityId
              ? { orgId: focus.entityId, include: ["counts"] }
              : undefined,
        },
      ],
    ],
    hints: organizationHints,
  },
  {
    pageTypes: ["operator_client_wiki"],
    noun: "client profile",
    families: ["wiki", "organizations"],
    prefetch: [
      [
        organization,
        {
          toolName: "lookup_client_wiki",
          input: ({ focus }) =>
            focus.entityId ? { orgId: focus.entityId } : undefined,
        },
      ],
    ],
    hints: (results) => [...organizationHints(results), ...wikiHints(results)],
  },
  {
    pageTypes: ["operator_client_files"],
    noun: "client's files",
    families: ["client_files"],
    prefetch: [
      [
        organization,
        {
          toolName: "list_client_files",
          input: ({ focus }) =>
            focus.entityId
              ? { orgId: focus.entityId, limit: RECENT_FILES }
              : undefined,
        },
      ],
    ],
    hints: (results) => [
      ...organizationHints(results),
      ...clientFilesHints(results),
    ],
  },
  {
    pageTypes: ["operator_client_policies"],
    noun: "client's policies",
    families: ["policies"],
    prefetch: [
      [
        organization,
        {
          toolName: "list_policies",
          input: ({ focus }) =>
            focus.entityId
              ? { orgId: focus.entityId, limit: POLICIES, sort: "expiration_asc" }
              : undefined,
        },
      ],
    ],
    hints: (results) => [...organizationHints(results), ...policiesHints(results)],
  },
  {
    pageTypes: ["operator_client_compliance"],
    noun: "client's compliance",
    families: ["compliance", "policies"],
    prefetch: [[organization]],
    hints: (results) => [
      ...organizationHints(results),
      "Only the client is loaded, not its requirements: read them with lookup_compliance_requirements.",
    ],
  },
];
