import { followupQuestionVisible, formatIntakeFollowupAnswer } from "../../lib/intake-followups";
import dayjs from "dayjs";
import type { Doc } from "../_generated/dataModel";
import { INTAKE_FIELDS, INTAKE_STEPS, type IntakeField } from "../../lib/insurance-intake";
import { coverageRequestLabel, detailsAnswers } from "../../lib/insurance-intake-details";

// Applicant text must remain literal, including Slack mentions and Markdown links.
export const escapeIntakeSlack = (text: string) =>
  text.replace(/[\\`*_{}\[\]()#+\-.!|<>~]/g, "\\$&");

type IntakeSlackState = Partial<Pick<Doc<"procurementRequests">,
  "intakeAnswers" | "intakeDetails" | "intakeStep" | "intakeSubmittedAt" |
  "intakeRevision" | "intakeSkippedSteps" | "createdAt" | "updatedAt"
>>;

/** Only applicant facts and explicit lifecycle metadata, never backend capabilities. */
export function buildIntakeSlackContext(request: IntakeSlackState, options?: {
  emailVerified?: boolean;
  files?: { name: string; category: string }[];
}) {
  const details = request.intakeDetails;
  const derived = details ? Object.fromEntries(Object.entries(detailsAnswers(details)).filter(([, value]) => value?.trim())) : {};
  const answers = { ...request.intakeAnswers, ...derived };
  const step = request.intakeStep;
  const lines = [
    `Status: ${request.intakeSubmittedAt ? "Submitted" : "Draft — not submitted"}`,
    `Revision: ${request.intakeRevision ?? 0}`,
  ];
  if (options?.emailVerified !== undefined)
    lines.push(`Email verified: ${options.emailVerified ? "Yes" : "No"}`);
  if (request.createdAt) lines.push(`Started (UTC): ${dayjs(request.createdAt).toISOString()}`);
  if (request.updatedAt) lines.push(`Last saved (UTC): ${dayjs(request.updatedAt).toISOString()}`);
  if (step !== undefined && INTAKE_STEPS[step])
    lines.push(`Current question: ${INTAKE_STEPS[step]}`);
  if (step === 7 && details?.coverages[details.coverageIndex])
    lines.push(`Current coverage: ${escapeIntakeSlack(coverageRequestLabel(details.coverages[details.coverageIndex]))} (${details.coverageIndex + 1} of ${details.coverages.length})`);
  if (step === 18) lines.push(`Revenue period: ${details?.revenueStep ?? "annual"}`);
  if (step === 14 && details?.mailingAddressStep) lines.push("Address section: separate mailing address");
  lines.push("", "**Saved applicant answers**");
  for (const field of Object.keys(INTAKE_FIELDS) as IntakeField[]) {
    const value = answers[field]?.trim();
    if (value || ["name", "email", "phone"].includes(field))
      lines.push(`${INTAKE_FIELDS[field]}: ${escapeIntakeSlack(value || "Not provided")}`);
  }
  if(details?.freightHauled)lines.push(`Freight hauled: ${escapeIntakeSlack(details.freightHauled)}`);
  if(details?.noCurrentInsuranceReason)lines.push(`Reason for no current insurance: ${escapeIntakeSlack(details.noCurrentInsuranceReason)}`);
  for(const line of details?.coverages??[])for(const [index,vehicle]of(line.vehicles??[]).entries())if(vehicle.estimatedValue)lines.push(`Vehicle ${index+1} approximate value: $${escapeIntakeSlack(vehicle.estimatedValue)}`);
  for (const row of details?.followups ?? [])
    if (row.answer.trim() && followupQuestionVisible(row,details?.followups)) lines.push(`${escapeIntakeSlack(row.label)}: ${escapeIntakeSlack(formatIntakeFollowupAnswer(row))}`);
  if (request.intakeSkippedSteps?.length)
    lines.push("", `Skipped questions: ${request.intakeSkippedSteps.map(index => INTAKE_STEPS[index]).filter(Boolean).join("; ")}`);
  if (options?.files)
    lines.push("", `Uploaded documents: ${options.files.length ? options.files.map(file=>`${escapeIntakeSlack(file.name)} (${file.category})`).join(", ") : "None"}`);
  return lines.join("\n");
}

/** Split after Markdown rendering; preserve every character below Slack's limit. */
export function splitIntakeSlackMessage(text: string): string[] {
  const chunks: string[] = [];
  while (text.length > 12000) {
    const newline = text.lastIndexOf("\n", 12000);
    const boundary = newline > 6000 ? newline + 1 : 12000;
    chunks.push(text.slice(0, boundary));
    text = text.slice(boundary);
  }
  if (text || !chunks.length) chunks.push(text);
  return chunks;
}
