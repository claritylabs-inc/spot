import { IntakeReviewRows } from "./company-review";
import {
  followupQuestionVisible,
  personalizeIntakeQuestion,
  formatIntakeFollowupAnswer,
  type IntakeFollowupAnswer,
} from "@/lib/intake-followups";
export function IntakeFollowupReview({
  answers,
  businessName,
}: {
  answers: IntakeFollowupAnswer[];
  businessName?: string;
}) {
  const rows = answers.filter((row) => followupQuestionVisible(row, answers));
  return (
    <IntakeReviewRows
      layout="stacked"
      emptyTitle="No additional answers provided"
      rows={rows.map((row) => ({
        label: personalizeIntakeQuestion(row.label, businessName),
        value:
          formatIntakeFollowupAnswer(row) ||
          (row.skipped ? "Skipped" : "Not answered"),
      }))}
    />
  );
}
