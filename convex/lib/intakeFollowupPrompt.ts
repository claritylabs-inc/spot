import type { FunctionReturnType } from "convex/server";
import type { internal } from "../_generated/api";
import { DRIVER_FIELDS } from "../../lib/intake-drivers";
import { normalizeIntakeQuestion, type intakeQuestionReferences } from "../../lib/intake-question-reference";

export type IntakeFollowupContext = NonNullable<FunctionReturnType<typeof internal.requestIntake.followupContext>>;
type QuestionReference = ReturnType<typeof intakeQuestionReferences>[number];

/** UTF-8 bytes never undercount characters, so this also stays below the
 * bounded local transport's 100,000-character prompt limit.
 */
export const INTAKE_FOLLOWUP_PROMPT_BYTE_BUDGET = 96_000;

export class IntakeFollowupPromptTooLarge extends Error {
  constructor(readonly bytes: number, readonly budget: number) {
    super(`Application context needs ${bytes} bytes; the prompt budget is ${budget}`);
  }
}

// UI bookkeeping and identifiers that carry no application fact.
const BOOKKEEPING = new Set([
  "id", "reservedForBaseIntake", "longitude", "latitude", "activitiesPrefilled", "termsAcceptedVersion",
  "subsectionIntroductions", "sectionIntroductions", "driverIndex", "autoVehicleIndex", "payrollPage",
  "followupProgress", "coverageIndex", "dateInput", "dateParts", "revenueStep", "mailingAddressStep",
  "prefillSourceIds", "operatingLocationPrefilled", "collectSensitiveDriverDetails",
]);
const present = (value: unknown) =>
  value !== undefined && value !== null && value !== "" &&
  !(typeof value === "object" && !Object.keys(value).length);

/** Removes bookkeeping and empty values only; no populated answer is changed.
 * Blank/skipped history is carried by an explicit status, so empties are safe to drop.
 */
function compact(value: unknown, omitAnswered = false): unknown {
  if (Array.isArray(value)) return value.map(row => compact(row, omitAnswered)).filter(present);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => !BOOKKEEPING.has(key) && !(omitAnswered && key === "status" && entry === "answered"))
      .map(([key, entry]) => [key, compact(entry, omitAnswered)] as const)
      .filter(([, entry]) => present(entry)),
  );
}

/** Builds the single generation prompt once from the existing follow-up context.
 * Each fact appears once: hashes, reserved/prior definitions, per-driver history and
 * vehicle values already present in typed history are omitted. Only reference hints
 * are trimmed to fit; if the application itself cannot fit, this throws before any
 * model call rather than dropping an answer.
 */
export function buildIntakeFollowupPrompt(
  context: IntakeFollowupContext,
  references: QuestionReference[],
  budget = INTAKE_FOLLOWUP_PROMPT_BYTE_BUDGET,
) {
  const history = context.questionHistory;
  const baseFields = history.baseQuestions.flatMap((step): { question: string; answer?: string; status: string }[] => step.fields.length
    ? step.fields.map(field => ({ question: field.question, answer: field.answer, status: field.status }))
    : step.skipped ? [{ question: step.question, status: "skipped" }] : []);
  const shown = new Set<string>(history.baseQuestions.flatMap(step => step.fields.map(field => field.id)));
  const askedIds = new Set(history.followupQuestions.map(row => row.id));
  const askedLabels = new Set(history.followupQuestions.map(row => normalizeIntakeQuestion(row.question)));
  const alsoAsked = new Set<string>();
  for (const row of context.priorQuestions) {
    if (!askedIds.has(row.id) && !askedLabels.has(normalizeIntakeQuestion(row.label))) alsoAsked.add(row.label);
  }
  const { followups: _followups, drivers, coverages, ...details } = context.details;
  const application = compact({
    questionHistory: {
      baseQuestions: baseFields,
      driverQuestions: history.driverQuestions.map((row, index) => ({ field: DRIVER_FIELDS[index], question: row.question })),
      propertyQuestions: history.propertyQuestions,
      cyberDocumentQuestions: history.cyberDocumentQuestions,
      autoQuoteQuestions: history.autoQuoteQuestions,
      vehicleQuestions: history.vehicleQuestions,
      scheduledDriverCount: history.scheduledDriverCount,
      followupQuestions: history.followupQuestions.map(row => ({
        question: row.question, answer: row.answer, status: row.status, ...(row.applicable ? {} : { applicable: false }),
      })),
      rule: history.rule,
    },
    additionalAnswers: Object.fromEntries(Object.entries(context.answers).filter(([field]) => !shown.has(field))),
    alsoAskedQuestions: [...alsoAsked],
    details: {
      ...details,
      // Vehicle underwriting and values are already question/answer rows above.
      coverages: coverages.map(({ vehicles, ...line }) => ({
        ...line,
        vehicles: vehicles?.map(({ underwriting, estimatedValue: _value, estimatedValueSkipped: _skipped, ...vehicle }) => ({
          ...vehicle, ...(underwriting?.radius ? { underwriting: { radius: underwriting.radius } } : {}),
        })),
      })),
      drivers,
    },
    files: context.files,
  }, true);
  const encoder = new TextEncoder();
  const bytes = (text: string) => encoder.encode(text).byteLength;
  // Reference hints are lowest priority: keep the highest-ranked prefix that fits.
  let used = bytes(JSON.stringify({ application, quoteQuestionReferences: [] }));
  if (used > budget) throw new IntakeFollowupPromptTooLarge(used, budget);
  const offered: QuestionReference[] = [];
  for (const reference of references) {
    const size = bytes(JSON.stringify(reference)) + (offered.length ? 1 : 0);
    if (used + size > budget) break;
    used += size;
    offered.push(reference);
  }
  const prompt = JSON.stringify({ application, quoteQuestionReferences: offered });
  const total = bytes(prompt);
  if (total > budget) throw new IntakeFollowupPromptTooLarge(total, budget);
  return { prompt, references: offered, bytes: total, trimmedReferences: references.length - offered.length };
}
