import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decideWithFallback } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";
import type { ProposalReviewOutput } from "./proposalReview";
import type { ProposalEvidenceLegend } from "./proposalMarkdown";

export function decideProposalReview(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  packetMarkdown: string;
  proposalMarkdown: string;
  sectionKeys: string[];
  legend: ProposalEvidenceLegend;
  abortSignal: AbortSignal;
  fallback: () => Promise<ProposalReviewOutput>;
}) {
  const visible = new Set(
    [...args.proposalMarkdown.matchAll(/\[((?:E\d+\s*)+)\]/g)].flatMap(
      (match) => match[1].trim().split(/\s+/),
    ),
  );
  const refs = Object.keys(args.legend).filter((ref) => visible.has(ref));
  if (
    !refs.length ||
    2 * refs.length + 1 > 128 ||
    args.sectionKeys.length > 40 ||
    args.packetMarkdown.includes("…truncated…") ||
    args.proposalMarkdown.includes("…truncated…")
  )
    return args.fallback();
  const criteria = Object.fromEntries(
    refs.flatMap((ref) => [
      [
        `meets:${ref}`,
        {
          meaning:
            "This exact evidence alone explicitly satisfies every verifiable condition of the packet section. No contradictory or qualifying proposal evidence exists.",
          reference: ref,
          provenance: decisionState(args.legend[ref]),
        },
      ],
      [
        `has_gap:${ref}`,
        {
          meaning:
            "This exact evidence establishes a clear shortfall or contradiction of an explicit requirement, with no ambiguity requiring interpretation.",
          reference: ref,
          provenance: decisionState(args.legend[ref]),
        },
      ],
    ]),
  );
  return decideWithFallback<ProposalReviewOutput>({
    ctx: args.ctx,
    orgId: args.orgId,
    family: "proposal.requirement_review",
    abortSignal: args.abortSignal,
    state: { packet: args.packetMarkdown, proposal: args.proposalMarkdown },
    questions: Object.fromEntries(
      args.sectionKeys.map((sectionKey, index) => [
        `section_${index}`,
        choiceQuestion(
          "Compare this entire packet section against all proposal evidence. Select a conclusion and its exact evidence only when one reference establishes the conclusion. Abstain for missing coverage, non-verifiable prose, multi-reference reasoning, complex wording, conflicting endorsements or nonstandard interpretation.",
          criteria,
          { sectionKey },
        ),
      ]),
    ),
    accept: (answers) => {
      const findings: ProposalReviewOutput["findings"] = [];
      for (const [index, sectionKey] of args.sectionKeys.entries()) {
        const choice = acceptedChoice(
          answers[`section_${index}`],
          Object.keys(criteria),
        );
        if (!choice) return undefined;
        const [conclusion, ref] = choice.value.split(":") as [
          "meets" | "has_gap",
          string,
        ];
        findings.push({
          sectionKey,
          conclusion,
          evidenceRefs: [ref],
          summary:
            conclusion === "meets"
              ? `Proposal evidence [${ref}] supports the section's requirements.`
              : `Proposal evidence [${ref}] establishes a gap against this section's requirements.`,
        });
      }
      return {
        findings,
        conclusion: findings.some((finding) => finding.conclusion === "has_gap")
          ? "has_gaps"
          : "meets_requirements",
      };
    },
    fallback: args.fallback,
  });
}
