import pack from "../docs/procurement/acord-intake/quote-question-reference.json";
import type { IntakeAnswers } from "./insurance-intake";
import type { IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";

export const INTAKE_QUESTION_REFERENCE_VERSION = `${pack.version}:single-pass-v1`;

export function normalizeIntakeQuestion(label: string) {
  return label.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The CSV is an offline source, never a runtime upload or another model call.
 * Coverage membership is reviewed here, not inferred from dirty source labels.
 * Use round-robin selection so one line cannot crowd out another line's hints.
 */
export function intakeQuestionReferences(
  answers: IntakeAnswers,
  details: Pick<IntakeDetails, "coverages" | "locations" | "drivers">,
  priorQuestions: IntakeFollowupQuestion[],
) {
  const reserved = new Set(priorQuestions.flatMap(row => [row.id, normalizeIntakeQuestion(row.label)]));
  const catalogSources = priorQuestions.map(row => row.source?.split(" · ")[1]).filter((id): id is string => !!id);
  const coverageIds = [...new Set(details.coverages.map(row => row.coverage))];
  const hasLocations = details.locations.length > 0 || details.coverages.some(line => (line.properties?.length ?? 0) > 0);
  const eligible = pack.references.filter(row =>
    row.coverageIds.some(id => coverageIds.includes(id as typeof coverageIds[number])) &&
    !reserved.has(row.id) && !reserved.has(normalizeIntakeQuestion(row.question)) &&
    !priorQuestions.some(question => question.source === `single-pass-v1:quote-reference:${row.id}`) &&
    !catalogSources.some(id => id === row.id || id.startsWith(`${row.id}_part_`)) &&
    (row.subject !== "building" || hasLocations) &&
    (row.subject !== "location" || hasLocations) &&
    (row.subject !== "vehicle" || details.coverages.some(line => (line.vehicles?.length ?? 0) > 0)) &&
    (row.subject !== "driver" || (details.drivers?.length ?? 0) > 0) &&
    // Fixed questions own both revenue periods even if blank or skipped.
    !["shared.operations.annual_revenue", "shared.operations.projected_revenue"].includes(row.id),
  );
  const keywords = new Set(normalizeIntakeQuestion(`${answers.description ?? ""} ${answers.industry ?? ""}`).split(" ").filter(word => word.length > 3));
  const score = (row: typeof eligible[number]) => normalizeIntakeQuestion(row.question).split(" ").reduce((total, word) => total + Number(keywords.has(word)), 0);
  const queues = coverageIds.map(coverage => eligible.filter(row => row.coverageIds.includes(coverage)).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)));
  const selected = new Map<string, typeof eligible[number]>();
  for (let index = 0; selected.size < 50 && queues.some(queue => index < queue.length); index++) {
    for (const queue of queues) {
      const row = queue[index];
      if (row) selected.set(row.id, row);
      if (selected.size >= 50) break;
    }
  }
  let characters = 0;
  return [...selected.values()].flatMap(({ matchPattern: _pattern, ...reference }) => {
    const length = JSON.stringify(reference).length;
    if (characters + length > 12000) return [];
    characters += length;
    return [reference];
  });
}
