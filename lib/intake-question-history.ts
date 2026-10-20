import { followupQuestionVisible } from "./intake-followups";
import { autoQuoteQuestionHistory } from "./intake-auto-quote";
import {
  DRIVER_QUESTIONS,
  DRIVER_FIELDS,
  driverModelContext,
  hasCommercialAuto,
} from "./intake-drivers";
import {
  INTAKE_FIELDS,
  INTAKE_STEPS,
  type IntakeAnswers,
  type IntakeField,
} from "./insurance-intake";
import type { IntakeDetails } from "./insurance-intake-details";

/** All base facts are reserved, including optional/conditional questions left blank.
 * Follow-ups collect new facts rather than rephrasing the base application.
 */
export const INTAKE_STEP_FIELDS: Partial<Record<number, IntakeField[]>> = {
  0: ["name", "email", "phone"],
  1: ["trigger"],
  2: ["effectiveDate", "deadline", "timingUnknown"],
  3: ["requirements"],
  5: ["requestDetails"],
  6: ["coverage"],
  7: ["limits"],
  8: ["separateQuotes"],
  9: ["coverageScope"],
  10: ["legalName"],
  11: ["website", "dba"],
  12: ["entityType", "formation"],
  13: ["fein", "businessNumber"],
  14: ["registeredAddress", "mailingAddress"],
  15: ["relatedEntities"],
  16: ["description", "industry", "industryVertical", "yearStarted"],
  17: ["fullTime", "partTime", "contractors"],
  18: ["trailingRevenue", "projectedRevenue"],
  19: ["locations"],
  20: ["currentInsurance"],
  22: ["currentInsuranceDetails"],
  23: ["claims"],
  25: ["cancellations"],
  26: ["changes"],
  27: ["companyConfirmed"],
};
export function intakeQuestionHistory(
  answers: IntakeAnswers,
  details: IntakeDetails,
  skippedSteps: number[],
) {
  return {
    baseQuestions: INTAKE_STEPS.slice(0, 28).map((question, step) => ({
      id: `base_${step}`,
      question,
      reservedForBaseIntake: true,
      skipped: skippedSteps.includes(step),
      fields: (INTAKE_STEP_FIELDS[step] ?? []).map((field) => ({
        id: field,
        question: INTAKE_FIELDS[field],
        answer: answers[field] ?? "",
        status: answers[field]?.trim()
          ? "answered"
          : details.skippedBaseFields?.includes(field) ||
              skippedSteps.includes(step)
            ? "skipped"
            : "unanswered",
      })),
    })),
    driverQuestions: hasCommercialAuto(details)
      ? DRIVER_QUESTIONS.map((question, index) => ({
          id: `driver_${index}`,
          question,
          reservedForBaseIntake: true,
          answers: (details.drivers ?? []).map((driver) => ({
            driver: driver.name,
            answer: driverModelContext(driver)[DRIVER_FIELDS[index]] || "",
            status: driver[DRIVER_FIELDS[index]] ? "answered" : "unanswered",
          })),
        }))
      : [],
    autoQuoteQuestions: autoQuoteQuestionHistory(details, skippedSteps),
    scheduledDriverCount: details.drivers?.length ?? 0,
    followupQuestions: (details.followups ?? []).map((row) => ({
      id: row.id,
      section: row.section,
      question: row.label,
      answer: row.answer,
      kind: row.kind,
      options: row.options,
      conditions: row.conditions ?? [],
      applicable: followupQuestionVisible(row, details.followups),
      status: row.answer.trim()
        ? "answered"
        : row.skipped
          ? "skipped"
          : "asked_unanswered",
    })),
    rule: "Driver schedule count, identity, licensing, experience and five-year accident/violation history are reserved base facts. Do not ask any base question again, including its fields, rewordings, totals, periods or units. Blank, unanswered, skipped and not-sure responses are intentional, not permission to ask again. Do not repeat previously asked follow-ups. Only ask for materially new underwriting facts; genuinely separate details about an affirmative answer are allowed.",
  };
}
