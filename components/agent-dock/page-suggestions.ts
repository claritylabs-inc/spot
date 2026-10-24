import type { PageContext } from "@/hooks/use-page-context";

type PageSuggestion = { label: string; prompt: string };

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

/** Suggestions for the page a new chat starts from. */
export function pageSuggestions(context: PageContext | null) {
  if (!context) return [];
  return SUGGESTIONS_BY_PAGE[context.pageType] ?? [];
}
