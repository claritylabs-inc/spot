import packs from "../docs/procurement/acord-intake/coverage-question-packs.json";
import { INTAKE_ACORD_CATALOG_VERSION, ATOMIC_CATALOG_PROMPTS, intakeAcordCandidates, withCatalogConditionalQuestions, type CatalogContext } from "./intake-acord-questions";
import { boundIntakeFollowupQuestions, MAX_INTAKE_CATALOG_QUESTIONS } from "./intake-followups";
import { INDUSTRIES } from "./insurance-intake-industries";

export const BAKED_COVERAGE_QUESTIONS_VERSION = `coverage-packs-v${packs.version}:${INTAKE_ACORD_CATALOG_VERSION}`;

/** Typed applicability, not runtime inference or guesses from prose. */
function applies(id: string, context: CatalogContext) {
  const industry = INDUSTRIES.find(row => row.label === context.answers.industry || row.value === context.answers.industry)?.value;
  const inIndustry = (...values: string[]) => !!industry && values.includes(industry);
  if (["property.contents.flammable_storage", "property.contents.refrigerated_stock"].includes(id))
    return inIndustry("agriculture", "manufacturing", "wholesale_distribution", "retail", "hospitality_entertainment");
  if (id === "gl.exposure.products") return !industry || inIndustry("agriculture", "manufacturing", "wholesale_distribution", "retail");
  if (id === "gl.exposure.recreation") return inIndustry("hospitality_entertainment", "education", "personal_consumer_services");
  if (id === "gl.exposure.pollutants") return inIndustry("agriculture", "mining_oil_gas", "utilities", "construction", "manufacturing", "transportation_logistics");
  if (["wc.safety.hazardous_work", "wc.safety.has_hazardous_work"].includes(id)) return inIndustry("agriculture", "mining_oil_gas", "utilities", "construction", "manufacturing", "transportation_logistics", "wholesale_distribution");
  if (id === "auto.fleet.passengers_for_hire") return inIndustry("transportation_logistics", "healthcare", "education", "hospitality_entertainment");
  if (id === "auto.fleet.hazardous_cargo") return inIndustry("transportation_logistics", "manufacturing", "mining_oil_gas", "agriculture");
  return true;
}

/** Reviewed packs are local data. Child controls are all prepared up front. */
export function bakedCoverageQuestions(context: CatalogContext) {
  const coverageIds = context.details.coverages.map(line => line.coverage);
  const eligible = intakeAcordCandidates(coverageIds, context);
  const selected = coverageIds.flatMap(coverage => {
    const ids = ((packs.coverages as Record<string, string[]>)[coverage] ?? []).flatMap(id=>ATOMIC_CATALOG_PROMPTS[id] ? ATOMIC_CATALOG_PROMPTS[id].map((_,index)=>`${id}_part_${index+1}`) : id === "eo.services.credentials" ? ["eo.services.has_credentials"] : id === "auto.terms.filings" ? ["auto.terms.insurance_filings"] : [id === "umbrella.exposure.large_loss_potential" ? "umbrella.exposure.has_large_loss_potential" : id === "wc.safety.hazardous_work" ? "wc.safety.has_hazardous_work" : id]);
    return ids.flatMap(id => applies(id, context) ? eligible.filter(row => row.definition.id === id).map(row => row.question) : []);
  });
  const questions = withCatalogConditionalQuestions(selected, eligible);
  return boundIntakeFollowupQuestions(questions, (context.details.followups ?? []).filter(row => row.section === "acord"), [], MAX_INTAKE_CATALOG_QUESTIONS);
}
