import dayjs from "dayjs";
import type { IntakeDetails } from "./insurance-intake-details";
export type IntakeDriver = {
  id: string;
  name: string;
  dateOfBirth: string;
  licenseNumber: string;
  licenseJurisdiction: string;
  licenseClass: string;
  yearsExperience: string;
  accidents: "" | "yes" | "no";
  accidentDetails: string;
  violations: "" | "yes" | "no";
  violationDetails: string;
};
export const DRIVER_QUESTIONS = [
  "Who will drive the insured vehicles?",
  "What is this driver’s date of birth?",
  "What is this driver’s license number?",
  "Where was this driver’s license issued?",
  "What license class and endorsements does this driver hold?",
  "How many years has this driver operated this type of vehicle?",
  "Has this driver had any vehicle accidents in the past five years?",
  "Describe this driver’s accidents in the past five years.",
  "Has this driver had any moving violations or license suspensions in the past five years?",
  "Describe this driver’s violations or suspensions in the past five years.",
] as const;
export function driverQuestion(step: number, name?: string) {
  const question: string = DRIVER_QUESTIONS[step - 31] ?? "";
  if (!name?.trim() || step === 31) return question;
  return question
    .replaceAll("this driver’s", `${name.trim()}’s`)
    .replaceAll("this driver", name.trim());
}
export const DRIVER_FIELDS = [
  "name",
  "dateOfBirth",
  "licenseNumber",
  "licenseJurisdiction",
  "licenseClass",
  "yearsExperience",
  "accidents",
  "accidentDetails",
  "violations",
  "violationDetails",
] as const;
export const isDriverStep = (step: number) => step >= 31 && step <= 40;
export const hasCommercialAuto = (details: Pick<IntakeDetails, "coverages">) =>
  details.coverages.some((line) => line.coverage === "commercial_auto");
export function newIntakeDriver(): IntakeDriver {
  return {
    id: crypto.randomUUID(),
    name: "",
    dateOfBirth: "",
    licenseNumber: "",
    licenseJurisdiction: "",
    licenseClass: "",
    yearsExperience: "",
    accidents: "",
    accidentDetails: "",
    violations: "",
    violationDetails: "",
  };
}
export function driverFieldValid(driver: IntakeDriver, step: number): boolean {
  const value = driver[DRIVER_FIELDS[step - 31]];
  if (typeof value !== "string") return false;
  // Names define the schedule. Other fields can be supplied later for carriers
  // that require them; any entered date/number must still be well formed.
  if (step !== 31 && !value.trim()) return true;
  if (step === 32)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      dayjs(value).format("YYYY-MM-DD") === value &&
      dayjs(value).isBefore(dayjs(), "day")
    );
  if (step === 36)
    return (
      value.trim() !== "" &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 100
    );
  if (step === 37 || step === 39) return value === "yes" || value === "no";
  if (
    (step === 38 && driver.accidents !== "yes") ||
    (step === 40 && driver.violations !== "yes")
  )
    return true;
  return !!value.trim();
}
export function driverScheduleErrors(details: IntakeDetails): string[] {
  if (!hasCommercialAuto(details)) return [];
  if (!details.drivers?.length)
    return ["Driver schedule: add at least one driver"];
  return details.drivers.flatMap((driver, index) =>
    DRIVER_FIELDS.flatMap((field, offset) =>
      driverFieldValid(driver, 31 + offset)
        ? []
        : [
            `Driver ${index + 1}: ${field.replace(/([A-Z])/g, " $1").toLowerCase()}`,
          ],
    ),
  );
}
/** Keep raw birth dates/license identifiers out of generation and analytics. */
export function driverModelContext(driver: IntakeDriver) {
  return {
    ...driver,
    dateOfBirth: driver.dateOfBirth ? "[provided securely]" : "",
    licenseNumber: driver.licenseNumber ? "[provided securely]" : "",
  };
}
