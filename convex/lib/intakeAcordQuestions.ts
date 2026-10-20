import catalog from "../../docs/procurement/acord-intake/question-catalog.json";
import {
  addressText,
  COVERAGE_OPTIONS,
  type IntakeDetails,
} from "../../lib/insurance-intake-details";
import type { IntakeFollowupQuestion } from "../../lib/intake-followups";

/** Canonical original Spot catalog from PR #519; ACORD mappings are unverified.
 * Keep the source JSON intact. This adapter targets the intake's declarative primitives,
 * not the catalog's proposed typed/scoped answer storage contract.
 */
export const INTAKE_ACORD_CATALOG_VERSION = `${catalog.catalogId}:${catalog.revision}:d982690a2e19bbeb3004d1c3fb920a201109daa0:adapter6-city-routes`;

export const INTAKE_ACORD_QUESTIONS = catalog.questions.map((definition) => {
  const group = catalog.groups.find((group) => group.id === definition.groupId);
  if (!group)
    throw new Error(`Unknown intake catalog group: ${definition.groupId}`);
  const kind: IntakeFollowupQuestion["kind"] =
    definition.id === "supplement.transport.routes"
      ? "routes"
      : definition.answerType === "money"
        ? "currency"
        : definition.answerType === "boolean"
          ? "yes_no"
          : definition.answerType === "single_choice"
            ? "dropdown"
            : ["count", "percentage", "decimal", "year"].includes(
                  definition.answerType,
                )
              ? "number"
              : ["text", "email", "phone", "date"].includes(
                    definition.answerType,
                  )
                ? "short_text"
                : "long_text";
  const hints: string[] = [];
  if (definition.answerType === "multi_choice")
    hints.push(
      `Choose all that apply: ${definition.options?.map((option) => option.label).join(", ")}.`,
    );
  if (definition.answerType === "period_money")
    hints.push("Include the amount and currency.");
  if (["period_money", "period_count"].includes(definition.answerType))
    hints.push("Include the reporting period.");
  if (
    ["duration", "distance", "area", "weight"].includes(definition.answerType)
  )
    hints.push("Include the units.");
  if (definition.answerType === "date") hints.push("Use YYYY-MM-DD.");
  const question: IntakeFollowupQuestion = {
    id: `catalog1_${definition.id.replaceAll(".", "_")}${kind === "routes" ? "_routes_v1" : kind === "currency" ? "_money_v1" : ""}`,
    section: "acord",
    label:
      kind === "routes"
        ? "Where do your vehicles usually travel?"
        : [definition.prompt, ...hints].join(" "),
    kind,
    options:
      kind === "dropdown"
        ? (definition.options?.map((option) => option.label) ?? [])
        : [],
    source: `Spot catalog v${catalog.revision} · ${definition.id}`,
  };
  return { question, definition, group };
});

/** Never infer a requested coverage, a history window, or permission to collect
 * restricted identifiers. Upload references stay in the existing upload flow.
 * Jev additionally checks unanswered facts, applicability and explicit conditions.
 */
type CatalogContext = {
  answers: Record<string, unknown>;
  details: Pick<IntakeDetails, "coverages"> &
    Partial<Pick<IntakeDetails, "followups" | "drivers" | "locations">>;
};
/** Identity-derived suffix prevents answers leaking between changed/reordered subjects. */
function subjectSuffix(identity: string) {
  let first = 2166136261,
    second = 5381;
  for (const char of identity) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second, 33) ^ char.charCodeAt(0);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
function subjects(kind: string, context: CatalogContext) {
  const details = context.details;
  if (kind === "vehicle")
    return details.coverages.flatMap((line) =>
      (line.vehicles ?? []).map((vehicle, index) => ({
        key: subjectSuffix(
          JSON.stringify([
            line.coverage,
            index,
            vehicle.year,
            vehicle.make,
            vehicle.model,
            vehicle.vin,
          ]),
        ),
        label: `Vehicle ${index + 1} (${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "vehicle details not provided"})`,
      })),
    );
  if (kind === "driver")
    return (details.drivers ?? []).map((driver) => ({
      key: subjectSuffix(driver.id),
      label: driver.name || "Unnamed driver",
    }));
  if (kind === "location")
    return (details.locations ?? []).map((location, index) => ({
      key: subjectSuffix(JSON.stringify([index, location.address])),
      label: `Location ${index + 1} (${addressText(location.address) || "address not provided"})`,
    }));
  if (kind === "building")
    return details.coverages.flatMap((line) =>
      (line.properties ?? []).map((property, index) => ({
        key: subjectSuffix(
          JSON.stringify([line.coverage, index, property.address]),
        ),
        label: `Property ${index + 1} (${addressText(property.address) || "address not provided"})`,
      })),
    );
  // No typed record means we cannot bind an answer safely to this subject.
  return [];
}
function scopedId(id: string, key: string) {
  return `catalog2_${id.replaceAll(".", "_")}_s${key}`;
}
function catalogAnswer(questionId: string, context: CatalogContext): unknown {
  const candidate = INTAKE_ACORD_QUESTIONS.find(
    ({ definition }) => definition.id === questionId,
  );
  if (!candidate) return undefined;
  const saved = context.details.followups?.find(
    ({ id }) => id === candidate.question.id,
  )?.answer;
  if (saved) {
    if (candidate.definition.answerType === "boolean")
      return saved === "Yes" ? true : saved === "No" ? false : undefined;
    if (candidate.definition.answerType === "single_choice")
      return candidate.definition.options?.find(({ label }) => label === saved)
        ?.value;
  }
  // Only explicit scalar facts can satisfy a dependency; never extract a Boolean
  // from prose or resolve an array path to a different insured subject.
  if (!["company", "coverage"].includes(candidate.definition.subjectKind))
    return undefined;
  for (const path of candidate.definition.existingAnswerCandidates) {
    let value: unknown = context;
    for (const part of path.split(".")) {
      value =
        value && typeof value === "object" && Object.hasOwn(value, part)
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    if (typeof value === "boolean") return value;
    if (
      candidate.definition.answerType === "single_choice" &&
      candidate.definition.options?.some(
        ({ value: option }) => option === value,
      )
    )
      return value;
  }
  return undefined;
}
/** Exact catalog equivalents of fixed intake fields never reach relevance AI.
 * Blank/skipped/unsure base answers are deliberate, not missing follow-up work.
 * Keep distinct facts (e.g. vehicle ownership, hired date) available to Jev.
 */
const FIXED_COVERAGE_LIMIT_PATHS = new Set<string>(
  COVERAGE_OPTIONS.flatMap((coverage) =>
    coverage.limits.map(
      (limit) => `details.coverages[${coverage.id}].limits.${limit.key}`,
    ),
  ),
);
const FIXED_INTAKE_CATALOG_FACTS = new Set([
  "shared.identity.legal_name",
  "shared.identity.trading_names",
  "shared.identity.website",
  "shared.identity.entity_type",
  "shared.identity.formation_jurisdiction",
  "shared.identity.start_year",
  "shared.identity.tax_identifier",
  "shared.identity.mailing_address",
  "shared.identity.contact_name",
  "shared.identity.contact_email",
  "shared.identity.contact_phone",
  "shared.identity.has_related_entities",
  "shared.identity.related_entity_scope",
  "shared.identity.requested_start",
  "shared.identity.requirements_deadline",
  "shared.identity.changes_description",
  "shared.operations.activities",
  "shared.operations.annual_revenue",
  "shared.operations.projected_revenue",
  "shared.operations.full_time_staff",
  "shared.operations.part_time_staff",
  "shared.operations.contractor_count",
  "shared.insurance.has_current_insurance",
  "shared.insurance.has_losses",
  "shared.insurance.adverse_insurance_action",
  "shared.insurance.uninsured_details",
  "auto.vehicle.vin",
  "auto.vehicle.year",
  "auto.vehicle.make",
  "auto.vehicle.model",
  "auto.vehicle.replacement_value",
  "auto.driver.name",
  "auto.driver.date_of_birth",
  "auto.driver.license_number",
  "auto.driver.license_jurisdiction",
  "auto.driver.license_class",
  "auto.driver.experience",
  "auto.driver.violations",
  "auto.driver.violation_details",
  "auto.driver.accidents",
  "auto.driver.accident_details",
]);

export function intakeAcordCandidates(
  coverageIds: readonly string[],
  context: CatalogContext,
) {
  return INTAKE_ACORD_QUESTIONS.flatMap((candidate) => {
    const { definition, group } = candidate;
    const explicitZeroWorkforce = ["fullTime", "partTime", "contractors"].every(
      (field) => {
        const value = context.answers[field];
        return typeof value === "number"
          ? value === 0
          : typeof value === "string" &&
              value.trim() !== "" &&
              Number(value) === 0;
      },
    );
    // An owner can work offsite without employing anybody. Preserve that
    // exposure instead of presenting an employee premise known to be false.
    const presentedCandidate =
      definition.id === "gl.exposure.work_offsite" && explicitZeroWorkforce
        ? {
            ...candidate,
            question: {
              ...candidate.question,
              label:
                "Does the business perform work at customer premises or other offsite locations?",
            },
          }
        : candidate;
    if (
      FIXED_INTAKE_CATALOG_FACTS.has(definition.id) ||
      definition.existingAnswerCandidates.some((path) =>
        FIXED_COVERAGE_LIMIT_PATHS.has(path),
      ) ||
      !group.coverageIds.some((coverage) => coverageIds.includes(coverage)) ||
      definition.sensitivity !== "ordinary_business" ||
      definition.answerType === "file_refs" ||
      definition.contextRequirements.length
    )
      return [];
    if (["company", "coverage"].includes(definition.subjectKind)) {
      if (
        definition.conditions.every(
          (condition) =>
            condition.operator === "eq" &&
            catalogAnswer(condition.questionId, context) === condition.value,
        )
      )
        return [presentedCandidate];
      // Prepare details alongside an unanswered Boolean parent, so answering Yes
      // does not require another model call or lose the catalog's follow-up.
      // Already answered No/unsure parents cannot authorize their details.
      const conditionalParents = definition.conditions.map((condition) =>
        INTAKE_ACORD_QUESTIONS.find(
          (parent) =>
            parent.definition.id === condition.questionId &&
            parent.definition.subjectKind === definition.subjectKind &&
            parent.definition.answerType === "boolean" &&
            parent.definition.conditions.length === 0,
        ),
      );
      if (
        definition.conditions.some(
          (condition, index) =>
            condition.operator !== "eq" ||
            typeof condition.value !== "boolean" ||
            !conditionalParents[index] ||
            catalogAnswer(condition.questionId, context) !== undefined,
        )
      )
        return [];
      return [
        {
          ...candidate,
          question: {
            ...candidate.question,
            conditions: definition.conditions.map((condition, index) => ({
              questionId: conditionalParents[index]!.question.id,
              answer: condition.value ? "Yes" : "No",
            })),
          },
        },
      ];
    }
    return subjects(definition.subjectKind, context).flatMap((subject) => {
      const conditions = definition.conditions.map((condition) => ({
        questionId: scopedId(condition.questionId, subject.key),
        answer:
          condition.value === true
            ? "Yes"
            : condition.value === false
              ? "No"
              : String(condition.value),
      }));
      if (
        definition.conditions.some(
          (condition) =>
            condition.operator !== "eq" ||
            !INTAKE_ACORD_QUESTIONS.some(
              (parent) =>
                parent.definition.id === condition.questionId &&
                parent.definition.subjectKind === definition.subjectKind &&
                parent.definition.conditions.length === 0 &&
                parent.definition.answerType === "boolean",
            ),
        )
      )
        return [];
      // Scope is shown in the prompt, never demanded through an incompatible control.
      const label = `${subject.label}: ${candidate.question.label.replace(/ Identify each [^.]+ in your answer\./g, "")}`;
      if (label.length > 500) return [];
      return [
        {
          ...candidate,
          question: {
            ...candidate.question,
            id: scopedId(definition.id, subject.key),
            label,
            ...(conditions.length ? { conditions } : {}),
          },
        },
      ];
    });
  });
}

/** Selected parent owns its catalog-authored conditional details, shown only on Yes. */
export function withCatalogConditionalQuestions(
  selected: IntakeFollowupQuestion[],
  eligible: ReturnType<typeof intakeAcordCandidates>,
) {
  const output: IntakeFollowupQuestion[] = [];
  for (const question of selected) {
    if (
      question.conditions?.length ||
      output.some((row) => row.id === question.id)
    )
      continue;
    output.push(question);
    for (const child of eligible.filter((row) =>
      row.question.conditions?.some(
        (condition) => condition.questionId === question.id,
      ),
    )) {
      if (!output.some((row) => row.id === child.question.id))
        output.push(child.question);
    }
  }
  return output;
}
