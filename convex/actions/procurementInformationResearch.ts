"use node";
import { v } from "convex/values";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import {
  clRouterCapabilities,
  clRouterDecide,
  clRouterResearch,
} from "../lib/clRouterClient";
import { routerResearchConfigured } from "../lib/routerCapabilities";
import { durableRouterClientOptionsWithTrace } from "../lib/routerJobClient";
import { jevDecisionBand, jevProceeds } from "../lib/jevThreshold";
import {
  groundResearchCandidates,
  publicResearchCitations,
  verifyResearchCandidates,
  type ResearchCitation,
} from "../lib/publicResearchVerification";
import {
  MAX_RESEARCHED_QUESTIONS,
  MAX_RESEARCH_FIELDS,
  researchFieldDescription,
  researchFieldType,
  suggestionAnswer,
} from "../lib/procurementInformationResearch";

// Research chunks run in parallel within the action's ten minutes, leaving
// time for grounding retrieval and verification.
const RESEARCH_BUDGET_MS = 300_000;
const OBJECTIVE =
  "These are insurance application questions about this exact company. Answer each field from public sources about it, preferring the company's own website and government registries or regulators, then reputable news. Use only facts published about this company, never a similarly named one or an industry norm. Return null rather than guess, and cite the page that states each answer.";

type Claim = NonNullable<
  FunctionReturnType<typeof internal.procurementInformationSuggestions.claimRun>
>;
type ClaimedQuestion = Claim["questions"][number];
type FinishArgs = FunctionArgs<
  typeof internal.procurementInformationSuggestions.finishRun
>;
type Candidate = {
  question: ClaimedQuestion;
  answer: string;
  confidence: "high" | "medium";
  provider: string;
  citations: ResearchCitation[];
};

function questionState({ question, scope }: ClaimedQuestion) {
  return {
    label: question.label,
    kind: question.kind,
    options: question.options,
    period: scope.period,
    coverage: scope.coverage,
    ...(scope.currency ? { currency: scope.currency } : {}),
  };
}

function noul(
  answers: Awaited<ReturnType<typeof clRouterDecide>>["answers"],
  key: string,
) {
  const answer = answers[key];
  return answer?.type === "noul" ? answer.noul : undefined;
}

function proceeds(
  answers: Awaited<ReturnType<typeof clRouterDecide>>["answers"],
  key: string,
) {
  return jevProceeds(noul(answers, key));
}

/** A provider's wording reaches research only when Jev confidently finds no client specifics. */
function clearlyGeneric(
  answers: Awaited<ReturnType<typeof clRouterDecide>>["answers"],
  key: string,
) {
  return jevDecisionBand(noul(answers, key), "prefill") === "low";
}

export const run = internalAction({
  args: { runId: v.id("procurementInformationResearchRuns") },
  handler: async (ctx, { runId }): Promise<null> => {
    const claim = await ctx.runMutation(
      internal.procurementInformationSuggestions.claimRun,
      { runId },
    );
    if (!claim) return null;
    const finish = (args: Omit<FinishArgs, "runId">) =>
      ctx.runMutation(internal.procurementInformationSuggestions.finishRun, {
        runId,
        ...args,
      });
    const failed = (error: string) =>
      finish({
        status: "failed",
        error,
        researchedQuestionIds: [],
        suggestions: [],
      });
    const trace = { traceId: `procurement-information:${runId}` };
    let stage = "capabilities";
    try {
      const configured = await clRouterCapabilities()
        .then(routerResearchConfigured)
        .catch(() => false);
      if (!configured) {
        await failed("research_unavailable");
        return null;
      }

      stage = "eligibility";
      const eligibility = await clRouterDecide(
        {
          task: "procurement_information_research_eligibility",
          trace,
          state: {
            entity: claim.entity,
            questions: Object.fromEntries(
              claim.questions.map((q, index) => [
                `q${index}`,
                questionState(q),
              ]),
            ),
          },
          questions: Object.fromEntries([
            ...claim.questions.map((_, index) => [
              `public${index}`,
              {
                type: "noul",
                instructions: {
                  question: `Could a careful researcher answer \`questions.q${index}\` for the company in \`entity\` from public sources (its website, government registries, regulators, reputable news) without private information?`,
                  note: "Judge whether such sources publish this kind of fact about a company, not what the answer is.",
                },
                criteria: {
                  true: {
                    what: "A fact companies, registries or regulators publish, such as founding year, locations, licenses, products and services, or what the company's website offers.",
                  },
                  false: {
                    what: "An internal or private fact, such as claims or loss history, payroll, internal security controls, contracts, plans or personal details.",
                  },
                },
              } satisfies DecisionQuestion,
            ]),
            ...claim.questions.flatMap((q, index) =>
              q.fromProvider
                ? [
                    [
                      `private${index}`,
                      {
                        type: "noul",
                        instructions: {
                          question: `Does \`questions.q${index}.label\` (or its options) contain specifics about this client's own situation, such as amounts, dates of incidents or losses, people's names, street addresses, claim, policy or account numbers?`,
                          note: "The wording may come from an insurance provider's email. Judge only the question text, not whether its answer is public.",
                        },
                        criteria: {
                          true: {
                            what: "The text names or quotes a detail of this client's own circumstances.",
                            examples: [
                              "Was the $85,000 water damage loss on March 3 repaired?",
                              "Is Jane Doe still the operations manager?",
                            ],
                          },
                          false: {
                            what: "A generic question any company could be asked, with no client-specific details.",
                            examples: [
                              "Does the company sell products online?",
                            ],
                          },
                        },
                      } satisfies DecisionQuestion,
                    ],
                  ]
                : [],
            ),
          ]),
          executionBudgetMs: 60_000,
        },
        { telemetry: ctx },
      );
      const eligible = claim.questions.filter(
        (q, index) =>
          proceeds(eligibility.answers, `public${index}`) &&
          (!q.fromProvider ||
            clearlyGeneric(eligibility.answers, `private${index}`)),
      );
      // Questions beyond the cap stay unassessed for the follow-up run.
      const researchable = eligible.slice(0, MAX_RESEARCHED_QUESTIONS);
      const ineligible = claim.questions.filter((q) => !eligible.includes(q));
      if (!researchable.length) {
        await finish({
          status: "completed",
          researchedQuestionIds: ineligible.map((q) => q.questionId),
          suggestions: [],
        });
        return null;
      }

      stage = "research";
      const chunks: ClaimedQuestion[][] = [];
      for (let i = 0; i < researchable.length; i += MAX_RESEARCH_FIELDS)
        chunks.push(researchable.slice(i, i + MAX_RESEARCH_FIELDS));
      const results = await Promise.allSettled(
        chunks.map((chunk) =>
          clRouterResearch(
            {
              ...(claim.orgId ? { orgId: claim.orgId } : {}),
              input: {
                entity: claim.entity,
                objective: OBJECTIVE,
                fields: chunk.map((q, index) => ({
                  key: `q${index}`,
                  description: researchFieldDescription(q),
                  type: researchFieldType(q.question.kind),
                  ...(q.question.kind === "dropdown"
                    ? { options: q.question.options }
                    : {}),
                })),
              },
              config: { depth: "standard" },
              executionBudgetMs: RESEARCH_BUDGET_MS,
            },
            durableRouterClientOptionsWithTrace(ctx, {
              ...trace,
              taskKind: "procurement_information_research",
            }),
          ),
        ),
      );
      const researched = chunks.filter(
        (_, index) => results[index].status === "fulfilled",
      );
      if (!researched.length) {
        await failed("research_failed");
        return null;
      }
      const candidates: Candidate[] = results.flatMap((result, chunkIndex) => {
        if (result.status !== "fulfilled") return [];
        return chunks[chunkIndex].flatMap((question, index): Candidate[] => {
          const found = result.value.answers[`q${index}`];
          const answer = found && suggestionAnswer(question, found.value);
          if (
            !answer ||
            (found.confidence !== "high" && found.confidence !== "medium")
          )
            return [];
          const citations = publicResearchCitations(found.citations);
          return citations.length
            ? [
                {
                  question,
                  answer,
                  confidence: found.confidence,
                  provider: result.value.provider,
                  citations,
                },
              ]
            : [];
        });
      });

      stage = "grounding";
      const grounded = await groundResearchCandidates(ctx, candidates, {
        claim: (candidate) => researchFieldDescription(candidate.question),
        taskKind: "procurement_information_grounding",
        trace,
      });

      stage = "verification";
      const verified = await verifyResearchCandidates(ctx, {
        task: "procurement_information_research_verification",
        trace,
        entity: claim.entity,
        candidates: grounded,
        question: (candidate) => questionState(candidate.question),
      });
      await finish({
        status: researched.length === chunks.length ? "completed" : "partial",
        ...(researched.length === chunks.length
          ? {}
          : { error: "research_partially_failed" }),
        provider: results.find((result) => result.status === "fulfilled")!.value
          .provider,
        researchedQuestionIds: [...ineligible, ...researched.flat()].map(
          (q) => q.questionId,
        ),
        suggestions: verified.map((candidate) => ({
          questionId: candidate.question.questionId,
          answer: candidate.answer,
          confidence: candidate.confidence,
          provider: candidate.provider,
          citations: candidate.citations.map(
            ({ url, title, excerpt }, index) => ({
              url,
              ...(title ? { title } : {}),
              // Only the verified excerpt is kept.
              ...(index === 0 && excerpt ? { excerpt } : {}),
            }),
          ),
        })),
      });
      // Structural counts only; no evidence or answer text.
      console.info("[procurementInformationResearch] completed", {
        runId,
        questions: claim.questions.length,
        eligible: eligible.length,
        researched: researched.flat().length,
        candidates: candidates.length,
        grounded: grounded.length,
        verified: verified.length,
      });
    } catch (error) {
      console.warn("[procurementInformationResearch] failed", {
        runId,
        stage,
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Unknown research failure",
      });
      await failed(`${stage}_failed`);
    }
    return null;
  },
});
