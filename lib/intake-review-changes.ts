import {
  INTAKE_FIELDS,
  type IntakeAnswers,
  type IntakeField,
} from "./insurance-intake";
import {
  addressText,
  coverageOption,
  coverageRequestLabel,
  type IntakeDetails,
  type IntakeLocation,
} from "./insurance-intake-details";
import { vehicleMakeLabel } from "./vehicle-display";

export type IntakeReviewVersion = {
  answers: IntakeAnswers;
  details: IntakeDetails;
  files: { id: string; name: string }[];
};
export type IntakeReviewChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};
function reviewValues(version: IntakeReviewVersion) {
  const values = new Map<string, { label: string; value: string }>();
  const put = (key: string, label: string, value?: string) =>
    values.set(key, { label, value: value?.trim() || "" });
  const { answers, details } = version;
  const structured = new Set([
    "companyConfirmed",
    "changes",
    "deadline",
    "coverage",
    "limits",
    "separateQuotes",
    "coverageScope",
    "registeredAddress",
    "mailingAddress",
    "relatedEntities",
    "trailingRevenue",
    "projectedRevenue",
    "locations",
  ]);
  for (const [key, value] of Object.entries(answers))
    if (!structured.has(key))
      put(`answer:${key}`, INTAKE_FIELDS[key as IntakeField], value);
  put(
    "registeredAddress",
    "Registered business address",
    addressText(details.registrationAddress ?? {}) || answers.registeredAddress,
  );
  put(
    "mailingAddress",
    "Mailing address",
    addressText(details.mailingAddress) || answers.mailingAddress,
  );
  const locationValues = (
    location: IntakeLocation,
    key: string,
    label: string,
  ) => {
    put(`${key}:name`, `${label} name`, location.name);
    put(`${key}:address`, `${label} address`, addressText(location.address));
    put(`${key}:activities`, `${label} activities`, location.details);
    put(
      `${key}:ownership`,
      `${label} ownership`,
      location.ownership === "owned"
        ? "Owned"
        : location.ownership === "leased"
          ? "Leased"
          : "",
    );
    put(`${key}:staff`, `${label} staff`, location.staff);
  };
  details.locations.forEach((location, index) =>
    locationValues(location, `location:${index}`, `Location ${index + 1}`),
  );
  if (!details.locations.length)
    put("legacyLocations", "Locations", answers.locations);
  details.relatedEntities.forEach((entity, index) => {
    const label = `Related entity ${index + 1}`;
    put(`entity:${index}:name`, `${label} name`, entity.legalName);
    put(
      `entity:${index}:relationship`,
      `${label} relationship`,
      entity.relationship,
    );
    put(
      `entity:${index}:insured`,
      `${label} included in insurance`,
      entity.insured === "include"
        ? "Yes"
        : entity.insured === "exclude"
          ? "No"
          : entity.insured === "unsure"
            ? "Not sure"
            : "",
    );
  });
  put(
    "relatedEntitiesChoice",
    "Related legal entities",
    details.hasRelatedEntities === "no"
      ? "None"
      : details.relatedEntities.length
        ? ""
        : answers.relatedEntities,
  );
  put(
    "relatedEntitiesNote",
    "Related entity notes",
    details.relatedEntitiesNote,
  );
  for (const period of ["annual", "projected"] as const) {
    const label = period === "annual" ? "Annual revenue" : "Projected revenue";
    put(
      `revenue:${period}:amount`,
      label,
      details.revenue?.[`${period}Amount`] ||
        (period === "annual"
          ? answers.trailingRevenue
          : answers.projectedRevenue),
    );
    put(
      `revenue:${period}:period`,
      `${label} reporting period`,
      details.revenue?.[`${period}Period`],
    );
  }
  details.coverages.forEach((line) => {
    const label = coverageRequestLabel(line);
    const key = `coverage:${line.coverage}`;
    put(key, "Requested coverage", label);
    for (const limit of coverageOption(line.coverage).limits) {
      if (limit.key !== "coverage_description")
        put(
          `${key}:${limit.key}`,
          `${label}: ${limit.label}`,
          line.limits[limit.key],
        );
    }
    put(
      `${key}:additional`,
      `${label}: Additional coverages`,
      line.additionalCoverages,
    );
    put(`${key}:scope`, `${label}: What to insure`, line.scopeDescription);
    line.properties?.forEach((location, index) =>
      locationValues(
        location,
        `${key}:property:${index}`,
        `${label}: Property ${index + 1}`,
      ),
    );
    line.vehicles?.forEach((vehicle, index) => {
      put(
        `${key}:vehicle:${index}`,
        `${label}: Vehicle ${index + 1}`,
        [vehicle.year, vehicleMakeLabel(vehicle.make), vehicle.model]
          .filter(Boolean)
          .join(" "),
      );
      put(
        `${key}:vehicle:${index}:vin`,
        `${label}: Vehicle ${index + 1} VIN`,
        vehicle.vin,
      );
    });
  });
  if (!details.coverages.length) {
    put("legacyCoverage", "Requested coverages", answers.coverage);
    put("legacyLimits", "Desired limits", answers.limits);
  }
  put("limitsNote", "Other limits", details.limitsNote);
  put(
    "additionalNote",
    "Additional coverage requests",
    details.additionalNote || answers.separateQuotes,
  );
  put("scopeNote", "Scope notes", details.scopeNote);
  version.files.forEach((file) =>
    put(`file:${file.id}`, "Supporting document", file.name),
  );
  return values;
}
export function intakeReviewChanges(
  previous: IntakeReviewVersion,
  current: IntakeReviewVersion,
): IntakeReviewChange[] {
  const before = reviewValues(previous),
    after = reviewValues(current);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((key) => {
    const oldValue = before.get(key)?.value || "",
      newValue = after.get(key)?.value || "";
    return oldValue === newValue
      ? []
      : [
          {
            key,
            label: after.get(key)?.label || before.get(key)!.label,
            before: oldValue,
            after: newValue,
          },
        ];
  });
}
