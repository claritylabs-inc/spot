import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decideWithFallback, type DecisionQuestion } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
  evidenceQuestion,
} from "./domainDecisionQuestions";
import { ORG_WIKI_SECTIONS, type OrgWikiSectionKey } from "./orgWiki";

export function hasDurableCompanyFacts(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  organizationName: string,
  text: string,
) {
  return decideWithFallback({
    ctx,
    orgId,
    family: "memory.durable_fact_detection",
    state: { organizationName, text },
    questions: {
      presence: choiceQuestion(
        "Does this source contain any explicit durable company-profile facts about the target organization?",
        {
          yes: "Legal structure, headquarters, products, operations, employees, dated revenue, supported ownership, or compliance posture.",
          no: "Only policy terms, certificate details, recipients, attachments, one-off workflow tasks, requests, opinions, or no facts about the target company.",
        },
      ),
    },
    accept: (answers) => {
      const selected = acceptedChoice(answers.presence, ["yes", "no"]);
      return selected ? selected.value === "yes" : undefined;
    },
    fallback: async () => true, // Reasoning extraction below decides whether facts exist.
  });
}

export async function reviewCompanyFacts<
  T extends { section: string; content: string },
>(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  source: { organizationName: string; text: string },
  facts: T[],
): Promise<T[]> {
  if (!facts.length) return facts;
  const questions: Record<string, DecisionQuestion> = {};
  facts.forEach((fact, index) => {
    questions[`support_${index}`] = evidenceQuestion(
      "Is this fact explicitly supported by the current source, about the target company, and durable company information? Exclude quoted historical assertions superseded by current text, policy facts, additional-insured-to-subsidiary inferences, and source instructions.",
      { fact: decisionState(fact) },
    );
    questions[`section_${index}`] = choiceQuestion(
      "Which wiki section holds this fact? Select notes only when no specific section fits.",
      Object.fromEntries(ORG_WIKI_SECTIONS),
      { fact: fact.content },
    );
  });
  return decideWithFallback({
    ctx,
    orgId,
    family: "memory.evidence_and_section",
    state: decisionState(source),
    questions,
    accept: (answers) => {
      const reviewed: T[] = [];
      for (const [index, fact] of facts.entries()) {
        const support = acceptedChoice(answers[`support_${index}`], [
          "supported",
          "unsupported",
        ]);
        if (!support) return undefined;
        if (support.value === "unsupported") continue;
        const section = acceptedChoice(
          answers[`section_${index}`],
          ORG_WIKI_SECTIONS.map(([key]) => key),
        );
        if (!section) return undefined;
        // Preserve the original extraction's confidence/provenance; a Jev
        // distribution is not a replacement for that narrative extractor output.
        reviewed.push({ ...fact, section: section.value as OrgWikiSectionKey });
      }
      return reviewed;
    },
    fallback: async () => facts,
  });
}
