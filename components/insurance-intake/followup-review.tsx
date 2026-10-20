import type { IntakeDetails } from "@/lib/insurance-intake-details";
import { intakeApplicantQuestion, intakeLocationHeading } from "@/lib/intake-applicant-wording";
import { isFixedVehicleFollowup } from "@/lib/intake-vehicle-underwriting";
import { typeStyle } from "@/lib/typography";
import { IntakeReviewRows } from "./company-review";
import {
  followupQuestionVisible,
  intakeVehicleQuestionSubject,
  intakeLocationQuestionSubject,
  personalizeIntakeQuestion,
  formatIntakeFollowupAnswer,
  type IntakeFollowupAnswer,
} from "@/lib/intake-followups";
export function IntakeFollowupReview({
  answers,
  businessName,
  details,
}: {
  answers: IntakeFollowupAnswer[];
  businessName?: string;
  details?: IntakeDetails;
}) {
  const rows = answers.filter(
    (row) =>
      !isFixedVehicleFollowup(row) && followupQuestionVisible(row, answers),
  );
  const groups = new Map<string, IntakeFollowupAnswer[]>();
  for (const row of rows) {
    const subject = intakeVehicleQuestionSubject(row) ?? intakeLocationQuestionSubject(row) ?? "";
    const group = groups.get(subject) ?? [];
    group.push(row);
    groups.set(subject, group);
  }
  const reviewRows = (group: IntakeFollowupAnswer[], subject = "") => (
    <IntakeReviewRows
      emptyTitle="No additional answers provided"
      rows={group.map((row) => ({
        label: row.section === "acord" ? intakeApplicantQuestion(row).title : personalizeIntakeQuestion(
          (subject ? row.label.slice(subject.length + 2) : row.label)
            .replace(/\s*Include the units\.?/gi, "")
            .trim(),
          businessName,
        ),
        value: row.prefilled ? (
          <div className="space-y-1">
            <div>{formatIntakeFollowupAnswer(row)}</div>
            <span
              className={`text-muted-foreground ${typeStyle("body.large")}`}
            >
              Prefilled
            </span>
          </div>
        ) : (
          formatIntakeFollowupAnswer(row) ||
          (row.skipped ? "Skipped" : "Not answered")
        ),
      }))}
    />
  );
  if (!rows.length) return reviewRows([]);
  return (
    <div data-review-content className="space-y-5">
      {[...groups].map(([subject, group]) => (
        <section
          key={subject || "general"}
          aria-label={subject || "General questions"}
          className="space-y-3"
        >
          {(subject || groups.size > 1) && (
            <h3 className={typeStyle("heading.item")}>
              {(details && intakeLocationHeading(group[0], details)?.name) || subject || "General questions"}
            </h3>
          )}
          {reviewRows(group, subject)}
        </section>
      ))}
    </div>
  );
}
