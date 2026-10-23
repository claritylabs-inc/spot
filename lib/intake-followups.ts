import { isIntakePercentageQuestion } from "./intake-percentages";
import { isWorkforceProviderSource, parseWorkforceProvider, formatWorkforceProvider } from "./intake-workforce-provider";
import { parseWorkJurisdictions, formatWorkJurisdictions } from "./intake-jurisdictions";
import { parsePayrollAnswer, formatPayrollAnswer } from "./intake-payroll";
import { intakeApplicantQuestion } from "./intake-applicant-wording";
import { parseRouteValue, formatRouteValue } from "./route-input";
import { formatDisplayDate } from "./date-format";
import { formatIntakeMoney } from "./intake-money";
/** Bounded, declarative questions. Model output never contains executable UI. */
export type IntakeFollowupQuestion = {
  id: string;
  section: "acord" | "additional";
  label: string;
  kind:
    | "yes_no"
    | "short_text"
    | "long_text"
    | "number"
    | "currency"
    | "date"
    | "dropdown"
    | "routes";
  options: string[];
  source?: string;
  conditions?: { questionId: string; answer: string }[];
};
export type IntakeFollowupAnswer = IntakeFollowupQuestion & {
  answer: string;
  skipped?: boolean;
  prefilled?: { confidence: number; contextHash: string };
};
export const MAX_INTAKE_FOLLOWUPS = 160;
export const MAX_INTAKE_CATALOG_QUESTIONS = 120;

/** Reserve capacity for saved history and the other section before offering new
 * questions. Parent/details groups fit together; saved history is never pruned.
 */
export function boundIntakeFollowupQuestions(
  questions: IntakeFollowupQuestion[],
  history: IntakeFollowupQuestion[] = [],
  reservedQuestions: IntakeFollowupQuestion[] = [],
  maxQuestions = 40,
): IntakeFollowupQuestion[] {
  const occupied = new Set(
    [...history, ...reservedQuestions].map((row) => row.id),
  );
  const candidates = [
    ...new Map(questions.map((row) => [row.id, row])).values(),
  ];
  const output: IntakeFollowupQuestion[] = [];
  const included = new Set<string>();
  const appendGroup = (root: IntakeFollowupQuestion) => {
    const group: IntakeFollowupQuestion[] = [];
    const groupIds = new Set<string>();
    const add = (question: IntakeFollowupQuestion) => {
      if (included.has(question.id) || groupIds.has(question.id)) return;
      // Every condition must reference an available parent, never an orphan.
      if (
        (question.conditions ?? []).some(
          (condition) =>
            !occupied.has(condition.questionId) &&
            !included.has(condition.questionId) &&
            !groupIds.has(condition.questionId),
        )
      )
        return;
      groupIds.add(question.id);
      group.push(question);
      for (const child of candidates) {
        if (
          child.conditions?.some(
            (condition) => condition.questionId === question.id,
          )
        )
          add(child);
      }
    };
    add(root);
    const newCount = group.filter((row) => !occupied.has(row.id)).length;
    if (
      occupied.size + newCount > MAX_INTAKE_FOLLOWUPS ||
      output.length + group.length > maxQuestions
    )
      return;
    for (const question of group) {
      output.push(question);
      included.add(question.id);
      occupied.add(question.id);
    }
  };
  for (const question of candidates) appendGroup(question);
  return output;
}

export const FOLLOWUP_STEPS = { acord: 29, additional: 30 } as const;
// Shared form validation checks probability shape; server writers and provenance
// checks own the configurable confidence gate for accepting new inferences.
export function validateFollowupAnswers(rows: IntakeFollowupAnswer[] = []) {
  if (
    rows.length > MAX_INTAKE_FOLLOWUPS ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Invalid follow-up answers");
  for (const row of rows) {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) ||
      !row.label.trim() ||
      (row.skipped !== undefined && typeof row.skipped !== "boolean") ||
      (row.skipped === true && !!row.answer.trim()) ||
      (row.prefilled !== undefined && ((!row.prefilled.contextHash.startsWith("cyber:") && !row.prefilled.contextHash.startsWith("workforce:") && (row.kind !== "yes_no" || !["Yes", "No"].includes(row.answer))) || !Number.isFinite(row.prefilled.confidence) || row.prefilled.confidence < 0 || row.prefilled.confidence > 1 || !row.prefilled.contextHash || row.prefilled.contextHash.length > 200)) ||
      (isWorkforceProviderSource(row.source) && row.answer.trim().startsWith("{") && !parseWorkforceProvider(row.answer)) ||
      (row.source?.endsWith(" · shared.operations.annual_payroll") && row.answer.trim().startsWith("{") && !parsePayrollAnswer(row.answer)) ||
      (row.source?.endsWith(" · wc.terms.covered_jurisdictions") && row.answer.trim().startsWith("{") && !parseWorkJurisdictions(row.answer)) ||
      row.label.length > 500 ||
      (row.conditions?.length ?? 0) > 5 ||
      (row.conditions ?? []).some(
        (condition) =>
          !condition.questionId ||
          condition.questionId === row.id ||
          !["Yes", "No"].includes(condition.answer),
      ) ||
      row.answer.length > (row.kind === "routes" ? 16000 : (row.source?.endsWith(" · shared.operations.annual_payroll") || row.source?.endsWith(" · wc.terms.covered_jurisdictions")) ? 12000 : 2000) ||
      (row.kind === "routes" && !!row.answer && row.answer !== "I'm not sure" && !parseRouteValue(row.answer)) ||
      row.options.length > 12 ||
      new Set(row.options).size !== row.options.length ||
      row.options.some((option) => !option.trim() || option.length > 150) ||
      (row.source?.length ?? 0) > 200 ||
      (row.kind !== "dropdown" && row.options.length > 0) ||
      (row.kind === "dropdown" &&
        (row.options.length < 2 ||
          (row.answer && row.answer !== "I'm not sure" && !row.options.includes(row.answer)))) ||
      (row.kind === "yes_no" &&
        row.answer &&
        !["Yes", "No", "I'm not sure"].includes(row.answer)) ||
      (row.kind === "currency" &&
        row.answer && row.answer !== "I'm not sure" &&
        (!/^(?:\d[\d,]*(?:\.\d{0,2})?|\.\d{1,2})$/.test(row.answer) ||
          !Number.isFinite(Number(row.answer.replaceAll(",", ""))))) ||
      (row.kind === "number" &&
        row.answer && row.answer !== "I'm not sure" &&
        !Number.isFinite(Number(row.answer)))
    )
      throw new Error("Invalid follow-up answer");
  }
}

/** Keep catalog values stable while using the intake's uncertainty wording. */
export function intakeFollowupOptionLabel(value: string): string {
  return value === "Need advice" ? "I'm not sure" : value;
}

/** Replace only the retired, compound starter prompt; never reinterpret saved prose. */
export function expandIntakeFollowupQuestion(
  question: IntakeFollowupQuestion,
): IntakeFollowupQuestion[] {
  if (question.source?.endsWith(" · eo.services.credentials")) {
    const parentId = "catalog1_eo_services_has_credentials";
    return [{
      ...question, id:parentId, kind:"yes_no", options:[],
      label:"Do you have any licenses, certifications, or professional qualifications for the services you provide?",
      source:question.source.replace(/eo\.services\.credentials$/, "eo.services.has_credentials"),
    }, {
      ...question, id:"catalog1_eo_services_credentials_list", kind:"long_text", options:[],
      label:"List your licenses, certifications, or professional qualifications.",
      source:question.source.replace(/eo\.services\.credentials$/, "eo.services.credentials_list"),
      conditions:[{questionId:parentId,answer:"Yes"}],
    }];
  }
  if (question.id !== "acord126_subcontracted_work") return [question];
  return [
    {
      ...question,
      id: "subcontracted_work_description_v1",
      label: "What work do you subcontract?",
      kind: "long_text",
      source: "Spot intake · subcontracted work",
    },
    {
      ...question,
      id: "subcontracted_work_annual_cost_v1",
      label: "How much do you spend on subcontractors each year?",
      kind: "currency",
      source: "Spot intake · annual subcontractor spending",
    },
  ];
}
export function formatIntakeFollowupAnswer(row: IntakeFollowupAnswer, currency = "USD"): string {
  if (!row.answer) return "";
  if (row.answer === "I'm not sure") return row.answer;
  if (row.source?.endsWith(" · eo.services.credentials_list")) return row.answer.split("\n").map(item=>item.trim()).filter(Boolean).join("; ");
  if (row.source?.endsWith(" · wc.terms.covered_jurisdictions")) return formatWorkJurisdictions(row.answer);
  if (isWorkforceProviderSource(row.source)) return formatWorkforceProvider(row.answer);
  if (row.source?.endsWith(" · shared.operations.annual_payroll")) return formatPayrollAnswer(row.answer);
  if (isIntakePercentageQuestion(row)) return `${row.answer}%`;
  return row.kind === "routes"
    ? formatRouteValue(row.answer)
    : row.kind === "date"
      ? formatDisplayDate(row.answer, row.answer)
    : row.kind === "currency"
      ? formatIntakeMoney(row.answer, currency)
      : row.kind === "dropdown"
        ? intakeFollowupOptionLabel(row.answer)
        : row.answer;
}

/** Missing, skipped and unsure parent answers never satisfy a condition. */
export function isRetiredIntakeFollowup(question: IntakeFollowupQuestion): boolean {
  const sourceId = question.source?.split(" · ").at(-1);
  return sourceId === "auto.terms.filings" || sourceId === "auto.terms.filing_details" ||
    sourceId?.startsWith("auto.terms.transportation_permit") === true ||
    /^catalog[12]_auto_terms_(?:transportation_permit|filings(?:_|$)|filing_details(?:_|$))/.test(question.id) ||
    question.source?.endsWith(" · eo.terms.extended_reporting") === true ||
    /^catalog[12]_eo_terms_extended_reporting(?:_|$)/.test(question.id);
}

export function followupQuestionVisible(
  question: IntakeFollowupQuestion,
  answers: IntakeFollowupAnswer[] = [],
): boolean {
  const visit = (
    candidate: IntakeFollowupQuestion,
    path: Set<string>,
  ): boolean => {
    if (isRetiredIntakeFollowup(candidate)) return false;
    if (path.has(candidate.id)) return false;
    const nextPath = new Set(path).add(candidate.id);
    return (candidate.conditions ?? []).every((condition) => {
      const parent = answers.find((row) => row.id === condition.questionId);
      return (
        !!parent &&
        !parent.skipped &&
        parent.answer === condition.answer &&
        visit(parent, nextPath)
      );
    });
  };
  return visit(question, new Set());
}

/** Presentation only: retain server-approved definitions and saved answer identity. */
export function personalizeIntakeQuestion(
  label: string | undefined,
  businessName?: string,
): string {
  if (!label) return "";
  if (!businessName?.trim()) return label;
  const name = businessName.trim();
  const possessive = /[’']s$|[’']$/.test(name) ? name : `${name}’s`;
  // Preserve explicit possession and common noun phrases even when the source
  // omits its apostrophe (for example, "your company DBA name"). Subject/verb
  // phrases such as "does your company subcontract" keep the plain name.
  const ownedFact = /^\s+(?:(?:annual|projected|estimated|total|gross|net|current|previous|registered|legal|trading|primary|full-time|part-time)\s+)*(?:DBA|name|address|website|revenue|turnover|payroll|income|sales|profit|expenses|operations|activities|employees|staff|workers|owners|directors|officers|customers|clients|contracts|equipment|vehicles|premises|locations|policies|coverage|insurance|records|procedures|process|processes|number|headcount|registration|tax|safety|security|training|data|systems|business hours)\b/i;
  return label.replace(
    /\b(?:the|your|this) (?:business|company)\b([’']s\b)?/gi,
    (match: string, suffix: string | undefined, offset: number) =>
      suffix || ownedFact.test(label.slice(offset + match.length))
        ? possessive
        : name,
  );
}

/** Vehicle catalog facts share a page, while their approved answer IDs stay separate. */
export function intakeFollowupPages(
  questions: IntakeFollowupQuestion[],
): IntakeFollowupQuestion[][] {
  const pages: IntakeFollowupQuestion[][] = [];
  const vehicles = new Map<string, IntakeFollowupQuestion[]>();
  for (const question of questions) {
    const subject = question.id.startsWith("vehicle_base_") ? undefined : intakeVehicleQuestionSubject(question);
    if (!subject) {
      pages.push([question]);
      continue;
    }
    const existing = vehicles.get(subject);
    if (existing) existing.push(question);
    else {
      const page = [question];
      vehicles.set(subject, page);
      pages.push(page);
    }
  }
  return pages;
}

export function intakeVehicleQuestionSubject(
  question?: IntakeFollowupQuestion,
): string | undefined {
  if (
    question?.section !== "acord" ||
    !question.id.startsWith("catalog2_auto_vehicle_")
  )
    return;
  return question.label.match(/^(Vehicle \d+ \(.+\)): /)?.[1];
}

export function intakeLocationQuestionSubject(question?: IntakeFollowupQuestion): string | undefined {
  if (question?.section !== "acord") return;
  return question.label.match(/^((?:Location|Property) \d+ \(.+\)):\s*/)?.[1];
}

export function intakeFollowupPageTitle(
  question: IntakeFollowupQuestion,
  answers?: IntakeFollowupAnswer[],
): string {
  const subject = question.id.startsWith("vehicle_base_") ? undefined : intakeVehicleQuestionSubject(question);
  return subject
    ? `More about ${subject.replace(/^Vehicle \d+ \((.+)\)$/, "$1")}`
    : intakeApplicantQuestion(question, undefined, answers).title;
}

/** Persist the first question index of the last page for reverse navigation. */
export function intakeFollowupLastPageIndex(
  questions: IntakeFollowupQuestion[],
): number {
  const last = intakeFollowupPages(questions).at(-1)?.[0];
  return Math.max(
    0,
    questions.findIndex((question) => question.id === last?.id),
  );
}

/** Save one approved answer and skip children whose parent no longer matches. */
export function withIntakeFollowupAnswer(
  rows: IntakeFollowupAnswer[],
  question: IntakeFollowupQuestion,
  answer: string,
): IntakeFollowupAnswer[] {
  const { prefilled: _prefilled, ...definition } = question as IntakeFollowupAnswer;
  const updatedRows = rows.some((row) => row.id === definition.id)
    ? rows.map((row) =>
        row.id === definition.id ? { ...definition, answer, skipped: false } : row,
      )
    : [...rows, { ...definition, answer, skipped: false }];
  return updatedRows.map((row) => {
    if (followupQuestionVisible(row, updatedRows)) return row;
    const { prefilled: _prefilled, ...inactive } = row;
    return { ...inactive, answer: "", skipped: true };
  });
}
