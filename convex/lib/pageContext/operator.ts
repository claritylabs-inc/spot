import type { OperatorPageContextEntry } from "./types";

type BrokerProfileRead = {
  profile?: { networkStatus?: unknown; isTest?: unknown } | null;
  submissionDefaults?: {
    defaults?: Array<{ coverageCode?: unknown; forms?: unknown }>;
    bounded?: unknown;
  };
};

/**
 * Facts the model would otherwise look up before preparing a submission: a
 * provider operators must not contact, a test provider, and which coverage
 * lines have saved defaults and application forms.
 */
export function brokerProfileHints(read: unknown): string[] {
  const broker = read as BrokerProfileRead | undefined;
  if (!broker || typeof broker !== "object") return [];
  const hints: string[] = [];
  if (broker.profile?.networkStatus === "blacklisted")
    hints.push("Network status: Do Not Contact.");
  if (broker.profile?.isTest === true) hints.push("Marked as a test provider.");
  const defaults = broker.submissionDefaults?.defaults ?? [];
  hints.push(
    defaults.length
      ? `Submission defaults saved for: ${defaults
          .map((entry) => {
            const forms = Array.isArray(entry.forms) ? entry.forms.length : 0;
            return `${String(entry.coverageCode)} (${forms} application form${forms === 1 ? "" : "s"})`;
          })
          .join(", ")}${broker.submissionDefaults?.bounded ? ", and more" : ""}.`
      : "No submission defaults saved.",
  );
  return hints;
}

const brokerProfilePrefetch: OperatorPageContextEntry["prefetch"] = [
  [
    {
      toolName: "get_broker_network_profile",
      input: ({ focus }) =>
        focus.entityId ? { brokerOrgId: focus.entityId } : undefined,
    },
  ],
];

export const operatorAdminPageContexts: readonly OperatorPageContextEntry[] = [
  {
    pageTypes: ["operator_broker"],
    noun: "insurance provider page",
    families: ["broker_network"],
    prefetch: brokerProfilePrefetch,
    hints: (results) =>
      brokerProfileHints(results.get("get_broker_network_profile")),
    staticHints: [
      "This provider's brokerOrgId is the entityId; change its profile with update_broker_network_profile.",
    ],
  },
  {
    // With an entityId this is a provider page attached before provider pages
    // had their own type.
    pageTypes: ["operator_brokers"],
    noun: "insurance provider list",
    families: ["broker_network"],
    prefetch: brokerProfilePrefetch,
    hints: (results) =>
      brokerProfileHints(results.get("get_broker_network_profile")),
    staticHints: [
      "The list's status, state and coverage line filters match list_broker_network_profiles status, writingState and lineOfBusinessCode; its country filter has no tool equivalent.",
      "Related broker records are the providers the operator checked in the list.",
    ],
  },
  {
    pageTypes: ["operator_inbox"],
    noun: "team inbox list",
    families: ["team_inbox"],
    prefetch: [],
    staticHints: [
      "The list's filters match list_team_inbox_threads: client is clientOrgId (the related organization), category, the Archived mailbox is archived, Unlinked is unlinked. It cannot filter by the Sent mailbox or by another operator's ownership.",
      "The search box only filters conversations already loaded on the page; find mail by words with search_team_inbox.",
      "Related team_email_thread records are the conversations the operator checked; read them with get_team_inbox_thread teamEmailThreadIds.",
    ],
  },
  {
    pageTypes: ["operator_channels"],
    noun: "agent channels page",
    families: ["platform"],
    prefetch: [],
    staticHints: [
      "Read Slack and connected-email health with get_platform_status sections channels.",
    ],
  },
  {
    pageTypes: ["operator_team"],
    noun: "teammates page",
    families: ["platform"],
    prefetch: [],
    staticHints: [
      "Related user records are the teammates online; team_email_thread records are emails they have open, readable with get_team_inbox_thread.",
      "list_operators lists every operator; send_operator_slack_message messages one by email.",
    ],
  },
  {
    pageTypes: ["operator_settings"],
    noun: "operator settings page",
    families: ["platform"],
    prefetch: [],
    staticHints: [
      "Invite an operator with invite_operator. Approve all, MCP servers, event subscriptions and notification routes change only in this page's controls.",
    ],
  },
  {
    // Listing a server's tools calls the remote server, so nothing is prefetched.
    pageTypes: ["operator_mcp_server"],
    noun: "MCP server settings",
    families: ["mcp"],
    prefetch: [],
    staticHints: [
      "List this server's tools with list_mcp_tools serverId set to the entityId; that call reaches the remote server.",
    ],
  },
  {
    pageTypes: ["operator_audit", "operator_audit_entry"],
    noun: "operator activity log",
    families: [],
    prefetch: [],
    staticHints: [
      "No tool reads the activity log: the summary is what the page shows.",
      "Related records are the filtered operator (user) or the inspected entry's target: read an organization with get_organization, a broker with get_broker_network_profile, a procurement_request with get_procurement_request and an operator_thread with read_operator_conversation.",
    ],
  },
  {
    pageTypes: ["operator_profile"],
    noun: "operator profile page",
    families: [],
    prefetch: [],
  },
];
