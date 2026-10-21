import type { IntakeDetails } from "./insurance-intake-details";
import { hasCommercialAuto } from "./intake-drivers";
export const AUTO_QUOTE_STEPS = {
  freight: 41,
  vehicleValue: 42,
  uninsuredReason: 43,
} as const;
export const AUTO_QUOTE_QUESTIONS = [
  "What freight do you haul?",
  "What is this vehicle’s approximate current value?",
  "Why doesn’t your business currently have insurance?",
] as const;
export function autoVehicles(details: IntakeDetails) {
  return (
    details.coverages.find((line) => line.coverage === "commercial_auto")
      ?.vehicles ?? []
  );
}
export function vehicleQuoteLabel(
  vehicle: { year: string; make: string; model: string },
  index: number,
) {
  return (
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
    `Vehicle ${index + 1}`
  );
}
export function estimatedVehicleValueError(value?: string) {
  if (!value?.trim()) return;
  if (
    !/^(?:\d[\d,]*(?:\.\d{0,2})?|\.\d{1,2})$/.test(value) ||
    !Number.isFinite(Number(value.replaceAll(",", ""))) ||
    Number(value.replaceAll(",", "")) <= 0
  )
    return "Enter an approximate value greater than zero, or clear it to skip.";
}
export function autoQuoteQuestionHistory(
  details: IntakeDetails,
  skippedSteps: number[],
) {
  return [
    {
      id: "auto_freight",
      question: AUTO_QUOTE_QUESTIONS[0],
      reservedForBaseIntake: true,
      applicable: hasCommercialAuto(details),
      answers: [],
      answer: details.freightHauled ?? "",
      status: details.freightHauled?.trim()
        ? "answered"
        : skippedSteps.includes(41)
          ? "skipped"
          : "unanswered",
    },
    {
      id: "auto_vehicle_value",
      question: AUTO_QUOTE_QUESTIONS[1],
      reservedForBaseIntake: true,
      applicable: hasCommercialAuto(details),
      answer: "",
      status: skippedSteps.includes(42) ? "skipped" : "unanswered",
      answers: autoVehicles(details).map((vehicle, index) => ({
        vehicle: vehicleQuoteLabel(vehicle, index),
        answer: vehicle.estimatedValue ?? "",
        status: vehicle.estimatedValue?.trim()
          ? "answered"
          : vehicle.estimatedValueSkipped
            ? "skipped"
            : "unanswered",
      })),
    },
    {
      id: "no_current_insurance_reason",
      question: AUTO_QUOTE_QUESTIONS[2],
      reservedForBaseIntake: true,
      applicable: false,
      answers: [],
      answer: details.noCurrentInsuranceReason ?? "",
      status: details.noCurrentInsuranceReason?.trim()
        ? "answered"
        : skippedSteps.includes(43)
          ? "skipped"
          : "unanswered",
    },
  ];
}
