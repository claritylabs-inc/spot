import {
  followupQuestionVisible,
  type IntakeFollowupAnswer,
  type IntakeFollowupQuestion,
} from "../../lib/intake-followups";
import { jevChoiceConfidence, jevDecisionBand } from "./jevThreshold";
export type IntakeBooleanPrefill = {
  questionId: string;
  answer: "Yes" | "No";
  confidence: number;
};
export function intakeBooleanPrefill(
  question: IntakeFollowupQuestion,
  decision: {
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
  },
): IntakeBooleanPrefill | undefined {
  const confidence = jevChoiceConfidence(decision);
  if (
    question.kind !== "yes_no" ||
    !["Yes", "No"].includes(decision.choice) ||
    !Number.isFinite(confidence) ||
    jevDecisionBand(confidence, "prefill") !== "high" ||
    confidence > 1
  )
    return;
  return {
    questionId: question.id,
    answer: decision.choice as "Yes" | "No",
    confidence,
  };
}
/** Only final, context-checked writers call this; applicant answers always win. */
export function mergeIntakePrefills(
  current: IntakeFollowupAnswer[],
  questions: IntakeFollowupQuestion[],
  proposals: IntakeBooleanPrefill[],
  contextHash: string,
): IntakeFollowupAnswer[] {
  const rows = [...current];
  for (const question of questions) {
    const candidate = proposals.find((row) => row.questionId === question.id);
    const saved = rows.find((row) => row.id === question.id);
    if (
      !candidate ||
      question.kind !== "yes_no" ||
      !["Yes", "No"].includes(candidate.answer) ||
      !Number.isFinite(candidate.confidence) ||
      jevDecisionBand(candidate.confidence, "prefill") !== "high" ||
      candidate.confidence > 1 ||
      saved?.answer.trim() ||
      saved?.skipped ||
      !followupQuestionVisible(question, rows)
    )
      continue;
    const row = {
      ...question,
      answer: candidate.answer,
      prefilled: { confidence: candidate.confidence, contextHash },
    };
    if (saved) rows[rows.indexOf(saved)] = row;
    else rows.push(row);
  }
  return rows;
}
