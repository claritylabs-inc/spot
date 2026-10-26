import type { IntakeApplication } from "../../lib/intake-application";
import { followupQuestionVisible, formatIntakeFollowupAnswer } from "../../lib/intake-followups";
import { intakeCurrency } from "../../lib/intake-money";

export type OutreachSummaryItem = { label: string; value: string };

/** Published applicant facts only. Never read draft answers, wiki prose or files. */
export function providerOutreachSummary(application: IntakeApplication | null): {
  applicantName: string | null;
  summaryItems: OutreachSummaryItem[];
} {
  if (!application) return { applicantName: null, summaryItems: [] };
  const { answers, details } = application;
  const summaryItems: OutreachSummaryItem[] = [];
  const add = (label: string, value?: string) => {
    if (value?.trim()) summaryItems.push({ label, value: value.trim() });
  };
  add("Business activities (applicant reported)", answers.description);
  add("Request details", answers.requestDetails);
  const vehicles = details.coverages
    .filter((line) => line.coverage === "commercial_auto")
    .flatMap((line) => line.vehicles ?? [])
    .slice(0, 3)
    .map((vehicle) => [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "))
    .filter(Boolean);
  if (vehicles.length) add("Vehicles (applicant reported; verify against supporting documents)", vehicles.join("; "));
  add("Claims history (applicant reported)", answers.claims);
  add("Insurance history (applicant reported)", answers.cancellations);
  const currency = intakeCurrency(details.registrationCountry);
  for (const row of (details.followups ?? []).filter((row) =>
    row.section === "additional" && !row.skipped && row.answer.trim() &&
    followupQuestionVisible(row, details.followups),
  ).slice(0, 6)) {
    add(row.label, formatIntakeFollowupAnswer(row, currency));
  }
  return { applicantName: answers.name?.trim() || null, summaryItems };
}
