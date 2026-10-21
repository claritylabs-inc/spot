import type { IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";
import { vehicleUnderwritingValues } from "./intake-vehicle-underwriting";
import { vehicleSubsectionQuestions } from "./intake-vehicle-subsections";
import { bakedCoverageQuestions, BAKED_COVERAGE_QUESTIONS_VERSION } from "./intake-coverage-questions";

export function vehicleRelevanceEvidence(answers: Record<string, unknown>, details: IntakeDetails) {
  return {
    businessDescription: String(answers.description ?? "").slice(0, 8000),
    industry: String(answers.industry ?? ""),
    vehicles: details.coverages.flatMap((line, coverageIndex) => line.coverage !== "commercial_auto" ? [] :
      (line.vehicles ?? []).map((vehicle, vehicleIndex) => {
        const values = vehicleUnderwritingValues(vehicle, vehicleIndex, details.followups);
        return {coverageIndex, vehicleIndex, year:vehicle.year, make:vehicle.make, model:vehicle.model, use:values.use ?? "", bodyType:values.body_type ?? ""};
      })),
  };
}

/** Exact evidence matching prevents decisions surviving changed uses or reordered vehicles. */
export function vehicleRelevanceKey(answers: Record<string, unknown>, details: IntakeDetails) {
  return JSON.stringify(["vehicle-relevance-v1", BAKED_COVERAGE_QUESTIONS_VERSION, vehicleRelevanceEvidence(answers, details)]);
}

export function vehicleRelevanceCandidates(answers: Record<string, unknown>, details: IntakeDetails) {
  const typed = vehicleSubsectionQuestions(details).filter(row => ["gross_vehicle_weight", "seats"].includes(row.field))
    .map(row => ({id:row.question.id, label:row.question.label, coverageIndex:row.coverageIndex, vehicleIndex:row.vehicleIndex}));
  const catalog = bakedCoverageQuestions({answers, details}).filter(question => / · (auto\.|supplement\.transport\.)/.test(question.source ?? ""))
    .map(question => ({id:question.id, label:question.label, coverageIndex:-1, vehicleIndex:-1}));
  return [...typed, ...catalog, {id:"auto_freight",label:"What freight or goods do your commercial vehicles haul?",coverageIndex:-1,vehicleIndex:-1}].slice(0,100);
}

/** A hidden parent also hides its dependent pages; answers remain saved. */
export function filterVehicleRelevantQuestions(questions: IntakeFollowupQuestion[], excludedIds: readonly string[]) {
  const hidden = new Set(excludedIds);
  for (let index=0; index<questions.length; index++) {
    let changed=false;
    for (const question of questions) if (!hidden.has(question.id) && question.conditions?.some(condition=>hidden.has(condition.questionId))) {
      hidden.add(question.id); changed=true;
    }
    if(!changed)break;
  }
  return questions.filter(question=>!hidden.has(question.id));
}
