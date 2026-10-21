import type { IntakeAnswers } from "./insurance-intake";
import type { IntakeDetails } from "./insurance-intake-details";
import { intakeCyberResearchKey } from "./intake-cyber-research";
const presentationKeys = new Set([
  "companyConfirmed",
  "coverageIndex",
  "revenueStep",
  "mailingAddressStep",
  "dateInput",
  "dateParts",
  "companyResearchSource",
  "prefillSourceIds",
  "declinedRequirementCoverages",
  "operatingLocationPrefilled",
  "activitiesPrefilled",
  "followupProgress",
  "payrollPage",
  "sectionIntroductions",
    "subsectionIntroductions",
  "driverIndex",
  "autoVehicleIndex",
  "collectSensitiveDriverDetails",
  "skippedBaseFields",
]);
export function intakePrefillEvidence(
  answers: IntakeAnswers,
  details: IntakeDetails,
) {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key, item]) =>
                  !presentationKeys.has(key) &&
                  item !== undefined &&
                  item !== "",
              )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value;
  return JSON.stringify(
    normalize({
      answers,
      details: {
        ...details,
        followups: (details.followups ?? []).filter((row) => !row.prefilled),
      },
    }),
  );
}
/** Revoke untouched inferences when their evidence changes; retain human edits. */
export function invalidateIntakePrefills(
  previousAnswers: IntakeAnswers,
  previousDetails: IntakeDetails,
  answers: IntakeAnswers,
  details: IntakeDetails,
): IntakeDetails {
  if (
    !details.followups?.some((row) => row.prefilled) ||
    intakePrefillEvidence(previousAnswers, previousDetails) ===
      intakePrefillEvidence(answers, details)
  )
    return details;
  return {
    ...details,
    followups: details.followups.filter((row) => !row.prefilled ||
      (row.prefilled.contextHash.startsWith("workforce:") && details.coverages.some(line=>line.coverage==="workers_compensation") && previousAnswers.legalName===answers.legalName && previousAnswers.dba===answers.dba) ||
      (row.prefilled.contextHash.startsWith("requirements:") &&
        details.coverages.some(line => line.coverage === "general_liability") &&
        previousAnswers.legalName === answers.legalName && previousAnswers.dba === answers.dba) ||
      (row.prefilled.contextHash.startsWith("cyber:") &&
        details.coverages.some(line => line.coverage === "cyber") &&
        intakeCyberResearchKey(previousAnswers, previousDetails) === intakeCyberResearchKey(answers, details))),
  };
}
