import { workJurisdictionsComplete } from "./intake-jurisdictions";
import { cyberDocumentUrlValid } from "./intake-cyber-research";
import { payrollAnswerComplete } from "./intake-payroll";
import { routeAnswerComplete } from "./route-input";
import { followupQuestionVisible } from "./intake-followups";
import dayjs from "dayjs";
import {
  INTAKE_FIELDS,
  missingIntakeAnswers,
  type IntakeAnswers,
} from "./insurance-intake";
import {
  coverageOption,
  validCoverageLimit,
  validCoverageScope,
  type IntakeDetails,
} from "./insurance-intake-details";
import { driverScheduleErrors } from "./intake-drivers";
import { vinError } from "./intake-vehicles";
import { estimatedVehicleValueError } from "./intake-auto-quote";
import { parseCalendarDateInput } from "./date-format";

export type IntakeSubmissionProblem = {
  label: string;
  step: number;
  coverageIndex?: number;
  vehicleIndex?: number;
};
/** The same typed checks drive review links and the server's final write gate. */
export function intakeSubmissionProblems(
  answers: IntakeAnswers,
  details: IntakeDetails,
): IntakeSubmissionProblem[] {
  const steps: Record<string, number> = {
    [INTAKE_FIELDS.name]: 0,
    [INTAKE_FIELDS.email]: 0,
    [INTAKE_FIELDS.phone]: 0,
    [INTAKE_FIELDS.trigger]: 1,
    [INTAKE_FIELDS.coverage]: 6,
    [INTAKE_FIELDS.legalName]: 10,
    [INTAKE_FIELDS.description]: 16,
    [INTAKE_FIELDS.currentInsurance]: 20,
    "Desired effective date": 2,
  };
  const problems: IntakeSubmissionProblem[] = missingIntakeAnswers(answers).map(
    (label) => ({ label, step: steps[label] ?? 10 }),
  );
  const add = (
    label: string,
    step: number,
    coverageIndex?: number,
    vehicleIndex?: number,
  ) =>
    problems.push({
      label,
      step,
      ...(coverageIndex === undefined ? {} : { coverageIndex }),
      ...(vehicleIndex === undefined ? {} : { vehicleIndex }),
    });
  if (details.coverages.some(line => line.coverage === "cyber") && Object.values(details.cyberDocuments ?? {}).some(value => !cyberDocumentUrlValid(value))) add("Valid privacy policy and terms links, or choose I’m not sure", 29);
  if (details.followups?.some(row => row.source?.endsWith(" · wc.terms.covered_jurisdictions") && followupQuestionVisible(row, details.followups) && !workJurisdictionsComplete(row.answer))) add("Complete employee work locations or choose I’m not sure", 29);
  if (details.followups?.some(row => row.source?.endsWith(" · shared.operations.annual_payroll") && followupQuestionVisible(row, details.followups) && !payrollAnswerComplete(row.answer))) add("Complete payroll groups or choose I’m not sure", 29);
  if (answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email.trim()))
    add("Valid work email", 0);
  for (const key of ["effectiveDate", "deadline"] as const)
    if (
      answers[key] &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(answers[key]!) ||
        dayjs(answers[key]).format("YYYY-MM-DD") !== answers[key])
    )
      add(
        key === "effectiveDate" ? "Valid effective date" : "Valid deadline",
        2,
      );
  if (
    (details.registrationCountry || "United States") === "United States" &&
    answers.fein &&
    !/^\d{2}-?\d{7}$/.test(answers.fein.trim())
  )
    add("Valid nine-digit FEIN", 13);
  if (
    details.registrationCountry === "Canada" &&
    answers.businessNumber &&
    !/^\d{9}$/.test(answers.businessNumber.trim())
  )
    add("Valid nine-digit Canadian business number", 13);
  if (answers.intakeGoal !== "savings") {
    for (const row of details.followups ?? [])
      if (row.source?.endsWith(" · eo.services.largest_client_share") && row.answer.trim() && row.answer !== "I'm not sure" &&
        (!Number.isFinite(Number(row.answer)) || Number(row.answer) < 0 || Number(row.answer) > 100))
        add("Enter a percentage from 0 to 100, or choose I’m not sure", 29);
    for (const row of details.followups ?? [])
      if (row.kind === "date" && row.answer.trim() && row.answer !== "I'm not sure" && followupQuestionVisible(row, details.followups) && !parseCalendarDateInput(row.answer))
        add("Enter a valid date or clear it to skip", row.section === "acord" ? 29 : 30);
    for (const row of details.followups ?? [])
      if (
        row.kind === "routes" &&
        followupQuestionVisible(row, details.followups) &&
        !routeAnswerComplete(row.answer)
      )
        add(
          "Complete the route or clear it to skip",
          row.section === "acord" ? 29 : 30,
        );
    for (const label of driverScheduleErrors(details)) add(label, 31);
    if (details.hasClaims === "yes" && !answers.claims?.trim())
      add("Claims details", 23);
    if (details.hasCancellations === "yes" && !answers.cancellations?.trim())
      add("Cancellation or renewal-decline details", 25);
    if (!details.coverages.length) add("Requested coverages", 6);
    details.coverages.forEach((line, index) => {
      if (
        line.coverage === "other" &&
        (!line.limits.coverage_description?.trim() ||
          line.limits.coverage_description === "I'm not sure")
      )
        add("Type of insurance for other coverage", 7, index);
      for (const [vehicleIndex, vehicle] of (line.vehicles ?? []).entries()) {
        const valueProblem = estimatedVehicleValueError(vehicle.estimatedValue);
        if (valueProblem)
          add(
            `Vehicle ${vehicleIndex + 1} approximate value: ${valueProblem}`,
            42,
            index,
            vehicleIndex,
          );
        const vinProblem = vinError(vehicle.vin, details.registrationCountry);
        if (vinProblem)
          add(`Vehicle ${vehicleIndex + 1} VIN: ${vinProblem}`, 9, index);
      }
      if (
        line.coverage !== "commercial_auto" &&
        !validCoverageScope(
          line,
          details.scopeNote || answers.coverageScope,
          details.registrationCountry,
        )
      )
        add(`${coverageOption(line.coverage).label}: what to insure`, 9, index);
      for (const limit of coverageOption(line.coverage).limits)
        if (!validCoverageLimit(limit.key, line.limits[limit.key]))
          add(
            `${coverageOption(line.coverage).label}: ${limit.label}`,
            7,
            index,
          );
    });
  }
  return [
    ...new Map(problems.map((problem) => [problem.label, problem])).values(),
  ];
}
