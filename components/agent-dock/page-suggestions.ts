import type { PageContext } from "@/hooks/use-page-context";

export type PageSuggestion = { label: string; prompt: string };

const SUGGESTIONS_BY_PAGE: Record<string, PageSuggestion[]> = {
  policy: [
    {
      label: "Summarize this policy",
      prompt:
        "Summarize this policy: named insured, carrier, term, coverages, limits, and deductibles",
    },
    {
      label: "What does this policy exclude?",
      prompt:
        "List the key exclusions in this policy and what they mean for us, with policy evidence",
    },
    {
      label: "Check endorsement wording",
      prompt:
        "Does this policy include additional insured, waiver of subrogation, and primary noncontributory wording? Cite the source",
    },
  ],
  policies: [
    {
      label: "Which policies renew soon?",
      prompt: "Which of my policies renew in the next 90 days?",
    },
    {
      label: "Compare limits across my policies",
      prompt:
        "Compare limits, deductibles, and carriers across my active policies",
    },
  ],
  compliance: [
    {
      label: "Which requirements aren't met?",
      prompt:
        "Which active requirements are not met by my current coverage? Include policy evidence for each gap",
    },
    {
      label: "Which vendors are missing coverage?",
      prompt:
        "Which connected vendors are missing required coverage or have expiring policies?",
    },
  ],
  certificates: [
    {
      label: "Which certificates expire soon?",
      prompt: "Which of my certificates expire in the next 60 days?",
    },
    {
      label: "Draft a certificate request",
      prompt:
        "Draft a certificate request that includes holder details, required limits, and endorsement wording",
    },
  ],
  requests: [
    {
      label: "What's still needed on open requests?",
      prompt: "Summarize my open requests and what is still needed for each",
    },
  ],
  files: [
    {
      label: "Find the latest loss runs",
      prompt: "Find our most recent loss runs and summarize them",
    },
  ],
};

const clientSummary: PageSuggestion[] = [
  {
    label: "Summarize this client",
    prompt:
      "Summarize this client: business, coverage in force, open procurement, and anything that needs attention",
  },
  {
    label: "What needs attention for this client?",
    prompt:
      "What needs attention for this client right now? Check renewals, extraction issues, open requests, and compliance gaps",
  },
];

const OPERATOR_SUGGESTIONS_BY_PAGE: Record<string, PageSuggestion[]> = {
  operator_client: clientSummary,
  operator_client_wiki: clientSummary,
  operator_client_policies: [
    {
      label: "Summarize this client's coverage",
      prompt:
        "Summarize this client's policies: carriers, terms, key limits, and deductibles",
    },
    {
      label: "Which policies renew soon?",
      prompt: "Which of this client's policies renew in the next 90 days?",
    },
  ],
  policy: [
    SUGGESTIONS_BY_PAGE.policy[0],
    {
      label: "Check this policy's extraction",
      prompt:
        "Check this policy's extraction for missing sections, low-confidence values, or issues to review",
    },
  ],
  operator_client_procurement: [
    {
      label: "Summarize open procurement",
      prompt:
        "Summarize this client's open procurement requests and the next step for each",
    },
  ],
  procurement_request: [
    {
      label: "Summarize this request",
      prompt:
        "Summarize this procurement request: status, proposals received, and what is still missing",
    },
    {
      label: "Compare the proposals",
      prompt:
        "Compare the proposals on this request by premium, limits, deductibles, and notable terms",
    },
  ],
  operator_client_files: [
    {
      label: "Which files still need filing?",
      prompt:
        "Which of this client's files are not attached to a policy or request yet?",
    },
  ],
  operator_client_compliance: [
    {
      label: "Which requirements aren't met?",
      prompt:
        "Which of this client's requirements are not met by current coverage?",
    },
  ],
  operator_clients: [
    {
      label: "Which clients need attention?",
      prompt:
        "Which clients have renewals, extraction issues, or open requests that need attention this week?",
    },
  ],
  operator_logs: [
    {
      label: "Summarize recent failures",
      prompt: "Summarize failed model calls from the last 24 hours and likely causes",
    },
  ],
};

/** Suggestions for the page a new chat starts from. */
export function pageSuggestions(
  context: PageContext | null,
  surface: "client" | "operator" = "client",
) {
  if (!context) return [];
  const suggestions =
    surface === "operator" ? OPERATOR_SUGGESTIONS_BY_PAGE : SUGGESTIONS_BY_PAGE;
  return suggestions[context.pageType] ?? [];
}
