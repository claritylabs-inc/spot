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
    [INTAKE_FIELDS.locations]: 19,
    [INTAKE_FIELDS.currentInsurance]: 20,
    "Desired effective date": 2,
  };
  const problems: IntakeSubmissionProblem[] = missingIntakeAnswers(answers).map(
    (label) => ({ label, step: steps[label] ?? 10 }),
  );
  const add = (label: string, step: number, coverageIndex?: number, vehicleIndex?: number) =>
    problems.push({
      label,
      step,
      ...(coverageIndex === undefined ? {} : { coverageIndex }),
      ...(vehicleIndex === undefined ? {} : { vehicleIndex }),
    });
  if (answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email.trim()))
    add("Valid work email", 0);
  if (answers.phone && !/^\+?[\d\s().-]{7,40}$/.test(answers.phone.trim()))
    add("Valid phone number", 0);
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
