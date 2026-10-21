import type { IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupAnswer } from "./intake-followups";
export const VEHICLE_UNDERWRITING_FIELDS = [
  { key: "body_type", label: "Body type", placeholder: "e.g. Box truck" },
  {
    key: "ownership",
    label: "Ownership",
    options: [
      "Business owned",
      "Leased by business",
      "Employee owned",
      "Hired",
      "Other",
    ],
  },
  {
    key: "garaging_address",
    label: "Where is it kept overnight?",
    placeholder: "City or garaging address",
  },
  { key: "use", label: "What is this vehicle used for?" },
  {
    key: "radius",
    label: "Typical travel radius",
    retired: true,
    placeholder: "e.g. 250 miles",
  },
  {
    key: "annual_distance",
    label: "Estimated annual distance",
    placeholder: "e.g. 40,000 miles",
  },
  {
    key: "gross_vehicle_weight",
    label: "Gross vehicle weight rating (GVWR)",
    placeholder: "e.g. 26,000 lbs",
  },
  { key: "seats", label: "Number of passenger seats", placeholder: "e.g. 2" },
  {
    key: "custom_equipment",
    label: "Nonstandard permanently installed equipment",
    options: ["Yes", "No", "I'm not sure"],
  },
  {
    key: "custom_equipment_detail",
    label: "Equipment description",
  },
  { key: "custom_equipment_value", label: "Equipment replacement cost" },
  {
    key: "personal_use",
    label: "Used for personal trips",
    options: ["Yes", "No", "I'm not sure"],
  },
] as const;
export type IntakeVehicleUnderwriting = Partial<
  Record<(typeof VEHICLE_UNDERWRITING_FIELDS)[number]["key"], string>
>;
export const FIXED_VEHICLE_CATALOG_IDS = new Set(
  VEHICLE_UNDERWRITING_FIELDS.map((field) => `auto.vehicle.${field.key}`),
);
/** Same identity as legacy scoped catalog answers, so accepted answers remain visible. */
function subjectSuffix(identity: string) {
  let first = 2166136261,
    second = 5381;
  for (const char of identity) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second, 33) ^ char.charCodeAt(0);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
export function vehicleUnderwritingValues(
  vehicle: {
    year: string;
    make: string;
    model: string;
    vin: string;
    underwriting?: IntakeVehicleUnderwriting;
  },
  index: number,
  legacy: IntakeFollowupAnswer[] = [],
): IntakeVehicleUnderwriting {
  const key = subjectSuffix(
    JSON.stringify([
      "commercial_auto",
      index,
      vehicle.year,
      vehicle.make,
      vehicle.model,
      vehicle.vin,
    ]),
  );
  const values = Object.fromEntries(
    VEHICLE_UNDERWRITING_FIELDS.map((field) => [
      field.key,
      vehicle.underwriting?.[field.key] ??
        legacy.find(
          (row) => row.id === `catalog2_auto_vehicle_${field.key}_s${key}`,
        )?.answer ??
        "",
    ]),
  ) as IntakeVehicleUnderwriting;
  if (values.ownership === "Owned") values.ownership = "Business owned";
  if (values.ownership === "Leased") values.ownership = "Leased by business";
  if (values.custom_equipment !== "Yes") { values.custom_equipment_detail = ""; values.custom_equipment_value = ""; }
  return values;
}
export function vehicleUnderwritingRows(details: IntakeDetails) {
  return details.coverages
    .filter((line) => line.coverage === "commercial_auto")
    .flatMap((line) =>
      (line.vehicles ?? []).map((vehicle, index) => {
        const values = vehicleUnderwritingValues(
          vehicle,
          index,
          details.followups,
        );
        return {
          title: `Vehicle ${index + 1} (${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "details not provided"})`,
          rows: VEHICLE_UNDERWRITING_FIELDS.filter(
            (field) =>
              !("retired" in field) &&
              (field.key !== "custom_equipment_detail" ||
                values.custom_equipment === "Yes"),
          ).map((field) => ({
            label: field.label,
            value: values[field.key] || "Not provided",
          })),
        };
      }),
    );
}
export function validateVehicleUnderwriting(
  value: IntakeVehicleUnderwriting | undefined,
) {
  if (!value) return;
  for (const [key, answer] of Object.entries(value)) {
    const field = VEHICLE_UNDERWRITING_FIELDS.find((row) => row.key === key);
    if (
      !field ||
      typeof answer !== "string" ||
      answer.length > 2000 ||
      ("options" in field &&
        answer && answer !== "I'm not sure" &&
        !(field.options as readonly string[]).includes(answer) &&
        !(field.key === "ownership" && ["Owned", "Leased"].includes(answer)))
    )
      throw new Error("Invalid vehicle underwriting answer");
  }
  if (value.custom_equipment_detail?.trim() && value.custom_equipment !== "Yes")
    throw new Error(
      "Equipment details require an affirmative equipment answer",
    );
}

export function isFixedVehicleFollowup(row: { id: string }) {
  return [...FIXED_VEHICLE_CATALOG_IDS].some((id) =>
    row.id.startsWith(`catalog2_${id.replaceAll(".", "_")}_s`),
  );
}
