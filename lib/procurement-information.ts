import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { COVERAGE_OPTIONS } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";

dayjs.extend(utc);
dayjs.extend(timezone);

type DatedInformationForm = { _id: string; createdAt: number };

/** Request-local creation order keeps names consistent on every surface. */
export function informationFormTitle(
  form: DatedInformationForm,
  forms: DatedInformationForm[],
): string {
  const date = dayjs(form.createdAt).tz("America/Toronto");
  const day = date.format("YYYY-MM-DD");
  const earlier = forms.filter(
    (other) =>
      other._id !== form._id &&
      dayjs(other.createdAt).tz("America/Toronto").format("YYYY-MM-DD") ===
        day &&
      (other.createdAt < form.createdAt ||
        (other.createdAt === form.createdAt && other._id < form._id)),
  );
  return `${date.format("MMM D, YYYY")}${earlier.length ? ` (${earlier.length + 1})` : ""}`;
}

type InformationFact = {
  _id: string;
  question: Pick<IntakeFollowupQuestion, "conditions">;
  answer?: { answer: string; unsure: boolean } | null;
};

/** The client is asked only for unresolved facts, once across all providers. */
export function neededInformationQuestions<T extends InformationFact>(
  questions: T[],
  requirements: {
    questionId: string;
    status: string;
    acceptedAnswerId?: string;
  }[],
): T[] {
  const unresolved = (q: T) => !q.answer || q.answer.unsure;
  const wanted = new Set<string>();
  const collect = (q: T, path = new Set<string>()): boolean => {
    if (path.has(q._id)) return false;
    const next = new Set(path).add(q._id);
    for (const condition of q.question.conditions ?? []) {
      const parent = questions.find(
        (item) => item._id === condition.questionId,
      );
      if (!parent || (unresolved(parent) && !collect(parent, next)))
        return false;
    }
    if (unresolved(q)) wanted.add(q._id);
    return true;
  };
  for (const q of questions) {
    if (
      unresolved(q) &&
      informationApplicability(q, questions) !== "not_applicable" &&
      requirements.some(
        (r) =>
          r.questionId === q._id && !["waived", "withdrawn"].includes(r.status),
      )
    )
      collect(q);
  }
  return questions.filter((q) => wanted.has(q._id));
}
/** Unknown prerequisites remain unresolved; only a conclusive mismatch hides a fact. */
export function informationApplicability(
  question: InformationFact,
  facts: InformationFact[],
  path = new Set<string>(),
): "applies" | "pending" | "not_applicable" {
  if (path.has(question._id)) return "pending";
  const visited = new Set(path).add(question._id);
  let pending = false;
  for (const condition of question.question.conditions ?? []) {
    const parent = facts.find((f) => f._id === condition.questionId);
    if (!parent) {
      pending = true;
      continue;
    }
    const parentState = informationApplicability(parent, facts, visited);
    if (parentState === "not_applicable") return "not_applicable";
    if (
      parentState === "pending" ||
      !parent.answer ||
      parent.answer.unsure ||
      !parent.answer.answer.trim()
    ) {
      pending = true;
      continue;
    }
    if (parent.answer.answer !== condition.answer) return "not_applicable";
  }
  return pending ? "pending" : "applies";
}

/** Stable prerequisite-first order, independent of checkbox selection order. */
export function orderInformationQuestions<
  T extends {
    questionId: string;
    scope?: { coverage: string };
    question: Pick<IntakeFollowupQuestion, "conditions">;
  },
>(questions: T[]): T[] {
  const result: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (question: T) => {
    if (visited.has(question.questionId)) return;
    if (visiting.has(question.questionId))
      throw new Error("Question prerequisites contain a cycle");
    visiting.add(question.questionId);
    for (const condition of question.question.conditions ?? []) {
      const parent = questions.find(
        (q) => q.questionId === condition.questionId,
      );
      if (!parent) throw new Error("Include the prerequisite questions");
      visit(parent);
    }
    visiting.delete(question.questionId);
    visited.add(question.questionId);
    result.push(question);
  };
  const ordered = questions.every((q) => q.scope)
    ? informationCoverageGroups(
        questions as (T & { scope: { coverage: string } })[],
      ).flatMap((group) => group.questions)
    : questions;
  ordered.forEach(visit);
  return result;
}

/** Keep each coverage together in the same catalog order as initial intake. */
export function informationCoverageGroups<
  T extends { scope: { coverage: string } },
>(questions: T[]) {
  const groups = new Map<string, T[]>();
  for (const question of questions) {
    const rows = groups.get(question.scope.coverage) ?? [];
    rows.push(question);
    groups.set(question.scope.coverage, rows);
  }
  const rank = (coverage: string) => {
    const index = COVERAGE_OPTIONS.findIndex(
      (option) => option.id === coverage,
    );
    return index < 0 ? COVERAGE_OPTIONS.length : index;
  };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([coverage, questions]) => ({ coverage, questions }));
}
