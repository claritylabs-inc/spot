import type { IntakeDetails } from "./insurance-intake-details";
import { VEHICLE_UNDERWRITING_FIELDS, vehicleUnderwritingValues } from "./intake-vehicle-underwriting";
import { vehicleMakeLabel } from "./vehicle-display";
import { intakeCatalogCoverage } from "./intake-acord-questions";
import type { IntakeFollowupQuestion } from "./intake-followups";

const prompts: Record<string, string> = {
  body_type: "What type of vehicle is this?",
  ownership: "Who owns or leases this vehicle?",
  garaging_address: "Where is this vehicle kept overnight?",
  use: "What do you use this vehicle for?",
  annual_distance: "How far is this vehicle driven in a typical year?",
  gross_vehicle_weight: "What is this vehicle’s gross vehicle weight rating?",
  seats: "How many passenger seats does this vehicle have?",
  custom_equipment: "Does this vehicle have any nonstandard permanently installed equipment?",
  custom_equipment_detail: "What equipment has been added, and how much would it cost to replace?",
  personal_use: "Is this vehicle also used for personal trips?",
};

/** These pages edit typed vehicle facts, never generated follow-up answers. */
export function vehicleSubsectionQuestions(details: IntakeDetails) {
  return details.coverages.flatMap((line, coverageIndex) => line.coverage !== "commercial_auto" ? [] :
    (line.vehicles ?? []).flatMap((vehicle, vehicleIndex) => {
      const name = [vehicle.year, vehicleMakeLabel(vehicle.make), vehicle.model].filter(Boolean).join(" ") || `Vehicle ${vehicleIndex + 1}`;
      let hash = 2166136261;
      for (const char of JSON.stringify([vehicle.year, vehicle.make, vehicle.model, vehicle.vin])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      const values = vehicleUnderwritingValues(vehicle, vehicleIndex, details.followups);
      return VEHICLE_UNDERWRITING_FIELDS.filter(field => !("retired" in field) &&
        (field.key !== "custom_equipment_detail" || values.custom_equipment === "Yes"))
        .map(field => ({
          coverageIndex, vehicleIndex, field: field.key,
          question: {
            id: `vehicle_base_${coverageIndex}_${vehicleIndex}_${(hash >>> 0).toString(36)}_${field.key}`,
            label: `Vehicle ${vehicleIndex + 1} (${name}): ${prompts[field.key]}`,
            section: "acord" as const, source: "Base vehicle details",
            kind: ("options" in field ? field.key === "ownership" ? "dropdown" : "yes_no" : field.key === "seats" ? "number" : ["use", "custom_equipment_detail"].includes(field.key) ? "long_text" : "short_text") as IntakeFollowupQuestion["kind"],
            options: "options" in field ? [...field.options] : [],
          } satisfies IntakeFollowupQuestion,
          answer: values[field.key] ?? "",
        }));
    }));
}

export function isVehicleSubsectionQuestion(question?: IntakeFollowupQuestion) {
  return !!question?.id.startsWith("vehicle_base_");
}

export function withVehicleSubsections(details: IntakeDetails, questions: IntakeFollowupQuestion[]) {
  const fixed = vehicleSubsectionQuestions(details).map(row => row.question);
  if (!fixed.length) return questions;
  const firstAuto = questions.findIndex(question => intakeCatalogCoverage(question, details.coverages.map(line => line.coverage)) === "commercial_auto");
  const position = firstAuto < 0 ? questions.length : firstAuto;
  return [...questions.slice(0, position), ...fixed, ...questions.slice(position)];
}
