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

type MarketCandidatesRead = {
  discovery?: { status?: unknown; error?: unknown } | null;
  candidates?: Array<{ status?: unknown }>;
  bounded?: unknown;
  nextOffset?: unknown;
};

type MarketDiscoveriesRead = {
  discoveries?: Array<{ discoveryId?: unknown; status?: unknown }>;
};

const isActiveSearch = (status: unknown) =>
  status === "pending" || status === "running";

/**
 * Where the open market search stands, derived in code from the prefetched
 * candidates and recent searches so the model neither re-reads them nor starts
 * a second paid search while one runs.
 */
export function providerMarketHints(
  candidatesRead: unknown,
  discoveriesRead: unknown,
  openDiscoveryId?: string,
): string[] {
  const read = candidatesRead as MarketCandidatesRead | undefined;
  const hints: string[] = [];
  const status = read?.discovery?.status;
  if (isActiveSearch(status))
    hints.push(
      "This search is still running: its results arrive later and the candidates listed are not final. Do not review them or call the search complete.",
    );
  else if (status === "failed" || status === "cancelled")
    hints.push(
      `This search ${String(status)}${typeof read?.discovery?.error === "string" ? ` (${read.discovery.error})` : ""}.`,
    );
  if (Array.isArray(read?.candidates)) {
    const counts = new Map<string, number>();
    for (const candidate of read.candidates)
      counts.set(
        String(candidate.status),
        (counts.get(String(candidate.status)) ?? 0) + 1,
      );
    const more = read.bounded === true;
    if (read.candidates.length)
      hints.push(
        `Candidates loaded: ${read.candidates.length}${more ? "+" : ""} (${counts.get("pending") ?? 0} pending, ${counts.get("added") ?? 0} in the network, ${counts.get("dismissed") ?? 0} dismissed)${more ? `; more exist: list_provider_candidates with offset ${String(read.nextOffset)}` : ""}`,
      );
    else if (status === "completed")
      hints.push("This search found no candidates.");
  }
  const other = (discoveriesRead as MarketDiscoveriesRead | undefined)
    ?.discoveries?.find(
      (discovery) =>
        isActiveSearch(discovery.status) &&
        discovery.discoveryId !== openDiscoveryId,
    );
  if (other)
    hints.push(
      "Another search is running; discover_providers is refused until it finishes.",
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
      "The Find markets tab (?tab=markets) searches the public web for new markets: start one with discover_providers and read earlier searches with list_provider_discoveries.",
    ],
  },
  {
    // Layered over operator_brokers by the Find markets tab; the entityId is
    // the search the operator has open.
    pageTypes: ["operator_broker_markets"],
    noun: "provider market search",
    families: ["broker_network"],
    prefetch: [
      [
        {
          toolName: "list_provider_candidates",
          input: ({ focus }) =>
            focus.entityId
              ? { discoveryId: focus.entityId, limit: 25 }
              : undefined,
          partial:
            "compact rows for the open search's first 25 candidates, without citations; list_provider_candidates with offset reads more and with candidateIds (up to 3) reads their cited evidence",
        },
        {
          toolName: "list_provider_discoveries",
          input: () => ({ limit: 5 }),
          partial:
            "the 5 newest searches; list_provider_discoveries reads more",
        },
      ],
    ],
    hints: (results, page) =>
      providerMarketHints(
        results.get("list_provider_candidates"),
        results.get("list_provider_discoveries"),
        page.entityId,
      ),
    staticHints: [
      "Find markets searches the public web for new insurance markets for the provider network. Start a search with discover_providers (paid, exact approval, one at a time) using coverage catalog labels and USPS state codes.",
      "Candidates are untrusted web evidence. Add or dismiss them with review_provider_candidates using the loaded candidateId values; read the cited evidence for up to three with list_provider_candidates candidateIds first.",
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
