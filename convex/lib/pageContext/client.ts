import type {
  OperatorIntentPrefetchRead,
  OperatorPrefetchPage,
} from "../operatorAgentIntentRegistry";
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

type FileTextRead = {
  items?: Array<{ status?: unknown; truncated?: unknown }>;
  notFound?: unknown[];
};

type RequirementsRead = {
  requirements?: Array<{
    requirementId?: unknown;
    title?: unknown;
    currentComplianceStatus?: unknown;
    matchedPolicyIds?: unknown[];
  }>;
};

type PoliciesRead = {
  policies?: Array<{ pipelineStatus?: unknown }>;
  matchedInScan?: unknown;
  bounded?: unknown;
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const RECENT_FILES = 25;
const POLICIES = 25;
const OPEN_FILE_TEXT_CHARS = 2_000;

/** A query parameter of the page URL the context was attached from. */
function pageParam(page: OperatorPrefetchPage | undefined, name: string) {
  if (!page?.href) return undefined;
  try {
    return new URL(page.href, "https://spot.invalid").searchParams.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The open file's text, bounded; the single-ID form returns it whole. */
export const openClientFileInput: OperatorIntentPrefetchRead["input"] = ({
  relatedId,
}) => {
  const clientFileId = relatedId?.("client_file");
  return clientFileId
    ? { clientFileIds: [clientFileId], maxChars: OPEN_FILE_TEXT_CHARS }
    : undefined;
};

/** The archived view lists archived policies too. */
export const clientPoliciesInput: OperatorIntentPrefetchRead["input"] = ({
  focus,
  page,
}) =>
  focus.entityId
    ? {
        orgId: focus.entityId,
        limit: POLICIES,
        sort: "expiration_asc",
        ...(pageParam(page, "view") === "archived" ? { includeArchived: true } : {}),
      }
    : undefined;

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

function clientFilesHints(results: Results, page: OperatorPrefetchPage) {
  const hints: string[] = [];
  const list = results.get("list_client_files") as FilesRead | undefined;
  if (list && Array.isArray(list.files))
    hints.push(
      `${list.files.length} newest active files listed${list.bounded === true ? "; more exist" : ""}`,
    );
  const openFile = page.related.find((entry) => entry.kind === "client_file");
  const read = results.get("read_client_file") as FileTextRead | undefined;
  if (openFile) {
    const name = openFile.label ? `“${openFile.label.slice(0, 120)}” ` : "";
    const item = read?.items?.[0];
    hints.push(
      !read
        ? `Open file ${name}(${openFile.id}) was not read; use read_client_file.`
        : !item
          ? `Open file ${name}(${openFile.id}) was not found; it may have been deleted.`
          : item.status !== "ok"
            ? `Open file ${name}(${openFile.id}) has no extractable text (${String(item.status)}).`
            : `Open file ${name}(${openFile.id}) text is loaded${
                item.truncated === true
                  ? ` up to ${OPEN_FILE_TEXT_CHARS} characters; read_client_file with clientFileId alone reads it whole`
                  : " in full"
              }.`,
    );
  }
  return hints;
}

function complianceHints(results: Results, page: OperatorPrefetchPage) {
  const read = results.get("lookup_compliance_requirements") as
    | RequirementsRead
    | undefined;
  if (!read || !Array.isArray(read.requirements)) return [];
  const counts = new Map<string, number>();
  for (const requirement of read.requirements) {
    const status = text(requirement.currentComplianceStatus) ?? "unverified";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const hints = [
    read.requirements.length === 0
      ? "No saved compliance requirements."
      : `${read.requirements.length} requirements: ${[...counts]
          .map(([status, count]) => `${count} ${status}`)
          .join(", ")}`,
  ];
  const open = page.related.find((entry) => entry.kind === "requirement");
  if (open) {
    const requirement = read.requirements.find(
      (row) => row.requirementId === open.id,
    );
    hints.push(
      requirement
        ? `Open requirement: ${text(requirement.title) ?? "untitled"} (${open.id}), ${String(
            requirement.currentComplianceStatus ?? "unverified",
          )}${
            requirement.matchedPolicyIds?.length
              ? `, matched policies ${requirement.matchedPolicyIds.join(", ")}`
              : ", no matched policy"
          }`
        : `Open requirement ${open.id} is not among the loaded requirements.`,
    );
  }
  return hints;
}

function policiesHints(results: Results) {
  const read = results.get("list_policies") as PoliciesRead | undefined;
  if (!read || !Array.isArray(read.policies)) return [];
  const failed = read.policies.filter(
    (policy) => policy.pipelineStatus === "error",
  ).length;
  return [
    `${String(read.matchedInScan ?? read.policies.length)} policies, earliest expiration first${
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
          partial:
            "identity and counts only; get_organization with include businessProfile or research reads more",
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
          partial: `metadata of the ${RECENT_FILES} newest active files; list_client_files with query or cursor finds others, read_client_file reads text`,
        },
        {
          toolName: "read_client_file",
          input: openClientFileInput,
          partial: `the open file's first ${OPEN_FILE_TEXT_CHARS} characters; read_client_file with clientFileId alone reads it whole`,
        },
      ],
    ],
    hints: (results, page) => [
      ...organizationHints(results),
      ...clientFilesHints(results, page),
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
          input: clientPoliciesInput,
          partial: `list fields of up to ${POLICIES} policies, earliest expiration first; lookup_policy reads coverages and limits, list_policies with cursor the rest`,
        },
      ],
    ],
    hints: (results) => [...organizationHints(results), ...policiesHints(results)],
  },
  {
    pageTypes: ["operator_client_compliance"],
    noun: "client's compliance",
    families: ["compliance", "policies"],
    prefetch: [
      [
        organization,
        {
          toolName: "lookup_compliance_requirements",
          // Both scopes: a client has few, and a filtered read cannot say what it skipped.
          input: ({ focus }) =>
            focus.entityId ? { orgId: focus.entityId, scope: "all" } : undefined,
        },
      ],
    ],
    hints: (results, page) => [
      ...organizationHints(results),
      ...complianceHints(results, page),
    ],
  },
];
