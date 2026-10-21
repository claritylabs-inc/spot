import type { IntakeFollowupQuestion } from "../../lib/intake-followups";
import type { clRouterDecide } from "./clRouterClient";
import { jevChoiceConfidence, jevProceeds } from "./jevThreshold";

export function followupInputCriteria(question: IntakeFollowupQuestion) {
  return {
    date: "One calendar date, such as the date of a claim, accident or cancellation; not a duration, year alone or date range",
    yes_no: "One Boolean fact, without also asking for an explanation",
    number: "One numeric quantity, count, year or duration; not money or a full date",
    currency: "One money amount",
    short_text: "One short text fact, identifier or name",
    long_text: "A description or explanation in prose",
    routes: "Operating routes containing ordered cities or stops",
    ...(question.options.length >= 2 ? { dropdown: "One choice from the supplied options" } : {}),
    none: "Compound, ambiguous, unsupported, or no control can represent the requested fact",
  };
}

export function withSelectedFollowupInput(
  question: IntakeFollowupQuestion,
  decision: Awaited<ReturnType<typeof clRouterDecide>>["answers"][string] | undefined,
): IntakeFollowupQuestion | null {
  if (decision?.type !== "choice" || !jevProceeds(jevChoiceConfidence(decision)) ||
    decision.choice === "none" || !(decision.choice in followupInputCriteria(question))) return null;
  const kind = decision.choice as IntakeFollowupQuestion["kind"];
  return { ...question, kind, options: kind === "dropdown" ? question.options : [] };
}
