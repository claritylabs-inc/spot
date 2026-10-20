import { addressText, type IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";
import { intakeApplicantQuestion } from "./intake-applicant-wording";

export function propertySubsectionQuestions(details: IntakeDetails) {
  return details.coverages.flatMap((line, coverageIndex) => line.coverage !== "property" ? [] :
    (line.properties ?? []).flatMap((property, propertyIndex) => {
      const address = addressText(property.address).trim();
      if (!address) return [];
      let hash = 2166136261;
      for (const char of address) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      const fields = [
        { field: "details" as const, label: "What activities take place at this location?", kind: "long_text" as const, options: [] },
        { field: "ownership" as const, label: "Do you own or lease this location?", kind: "dropdown" as const, options: ["Owned", "Leased"] },
        { field: "staff" as const, label: "How many people work at this location?", kind: "number" as const, options: [] },
      ];
      return fields.map(field => ({
        coverageIndex, propertyIndex, field: field.field,
        question: {
          id: `property_base_${coverageIndex}_${propertyIndex}_${(hash >>> 0).toString(36)}_${field.field}`,
          label: `Location ${propertyIndex + 1} (${address}): ${field.label}`,
          kind: field.kind, options: field.options, section: "acord" as const,
          source: "Base property details",
        } satisfies IntakeFollowupQuestion,
        answer: field.field === "ownership" ? property.ownership === "owned" ? "Owned" : property.ownership === "leased" ? "Leased" : property.ownership === "unknown" ? "I'm not sure" : "" : property[field.field] ?? "",
      }));
    }));
}
export function isPropertySubsectionQuestion(question: IntakeFollowupQuestion | undefined) {
  return !!question?.id.startsWith("property_base_");
}
export function withPropertySubsections(details: IntakeDetails, questions: IntakeFollowupQuestion[]) {
  const fixed = propertySubsectionQuestions(details);
  const remaining = questions.filter(question => ![
    "shared.location.activities", "shared.location.ownership", "shared.location.staff_count",
  ].some(id => question.source?.endsWith(` · ${id}`)));
  const result: IntakeFollowupQuestion[] = [];
  const subject = (question: IntakeFollowupQuestion) => intakeApplicantQuestion(question).context?.match(/\((.+)\)$/)?.[1];
  const included = new Set<string>();
  // Keep coverage terms in pack order, then introduce each location once with
  // its fixed facts followed by all of its scoped questions.
  for (const question of remaining) {
    if (included.has(question.id)) continue;
    const address = subject(question);
    const locationFields = address ? fixed.filter(row => subject(row.question) === address) : [];
    const group = locationFields.length
      ? [...locationFields.map(row => row.question), ...remaining.filter(row => subject(row) === address)]
      : [question];
    for (const row of group) if (!included.has(row.id)) {
      result.push(row);
      included.add(row.id);
    }
  }
  return [...result, ...fixed.filter(row => !included.has(row.question.id)).map(row => row.question)];
}
