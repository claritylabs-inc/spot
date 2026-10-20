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
    | "dropdown";
  options: string[];
  source?: string;
  conditions?: { questionId: string; answer: string }[];
};
export type IntakeFollowupAnswer = IntakeFollowupQuestion & {
  answer: string;
  skipped?: boolean;
};
export const FOLLOWUP_STEPS = { acord: 29, additional: 30 } as const;
export function validateFollowupAnswers(rows: IntakeFollowupAnswer[] = []) {
  if (
    rows.length > 60 ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Invalid follow-up answers");
  for (const row of rows) {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) ||
      !row.label.trim() ||
      (row.skipped !== undefined && typeof row.skipped !== "boolean") ||
      (row.skipped === true && !!row.answer.trim()) ||
      row.label.length > 500 ||
      (row.conditions?.length ?? 0) > 5 ||
      (row.conditions ?? []).some(
        (condition) =>
          !condition.questionId ||
          condition.questionId === row.id ||
          !["Yes", "No"].includes(condition.answer),
      ) ||
      row.answer.length > 2000 ||
      row.options.length > 12 ||
      new Set(row.options).size !== row.options.length ||
      row.options.some((option) => !option.trim() || option.length > 150) ||
      (row.source?.length ?? 0) > 200 ||
      (row.kind !== "dropdown" && row.options.length > 0) ||
      (row.kind === "dropdown" &&
        (row.options.length < 2 ||
          (row.answer && !row.options.includes(row.answer)))) ||
      (row.kind === "yes_no" &&
        row.answer &&
        !["Yes", "No", "I'm not sure"].includes(row.answer)) ||
      (row.kind === "currency" &&
        row.answer &&
        (!/^(?:\d[\d,]*(?:\.\d{0,2})?|\.\d{1,2})$/.test(row.answer) ||
          !Number.isFinite(Number(row.answer.replaceAll(",", ""))))) ||
      (row.kind === "number" &&
        row.answer &&
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
export function formatIntakeFollowupAnswer(row: IntakeFollowupAnswer): string {
  if (!row.answer) return "";
  return row.kind === "currency"
    ? `$ ${row.answer}`
    : row.kind === "dropdown"
      ? intakeFollowupOptionLabel(row.answer)
      : row.answer;
}

/** Missing, skipped and unsure parent answers never satisfy a condition. */
export function followupQuestionVisible(
  question: IntakeFollowupQuestion,
  answers: IntakeFollowupAnswer[] = [],
): boolean {
  return (question.conditions ?? []).every((condition) =>
    answers.some(
      (row) =>
        row.id === condition.questionId && row.answer === condition.answer,
    ),
  );
}

/** Presentation only: retain server-approved definitions and saved answer identity. */
export function personalizeIntakeQuestion(
  label: string | undefined,
  businessName?: string,
): string {
  if (!label) return "";
  if (!businessName?.trim()) return label;
  return label.replace(/\b(?:the|your|this) (?:business|company)\b/gi, () =>
    businessName.trim(),
  );
}
