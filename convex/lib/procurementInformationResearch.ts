import dayjs from "dayjs";
import {
  informationApplicability,
  neededInformationQuestions,
} from "../../lib/procurement-information";
import {
  validateFollowupAnswers,
  type IntakeFollowupQuestion,
} from "../../lib/intake-followups";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ClRouterResearchFieldType } from "./clRouterClient";
import { actionConfirmationFingerprint } from "./actionConfirmationFingerprint";
import { publicResearchUrl } from "./companyResearch";
import {
  MAX,
  bounded,
  requestFacts,
  type Ctx,
} from "./procurementInformationAccess";

/**
 * Public web research pre-answers unresolved procurement information questions
 * as cited suggestions. Suggestions are never answers: an operator accepts one
 * or the client confirms it in their form, through the existing answer writers.
 */

/** Long prose and route tables are never pre-answered from the web. */
const RESEARCHABLE_KINDS = new Set<IntakeFollowupQuestion["kind"]>([
  "yes_no",
  "short_text",
  "number",
  "currency",
  "date",
  "dropdown",
]);
// One eligibility decision holds every candidate (Jev allows 128 questions);
// verification asks two questions per researched answer.
export const MAX_ELIGIBILITY_QUESTIONS = 100;
export const MAX_RESEARCHED_QUESTIONS = 40;
export const MAX_RESEARCH_FIELDS = 10;
export const AUTOMATIC_RESEARCH_DELAY_MS = 60_000;
export const RESEARCH_RUN_TIMEOUT_MS = 15 * 60 * 1000;

export type ResearchEntity = {
  name: string;
  website?: string;
  location?: string;
};
export type SuggestionResolution = NonNullable<
  Doc<"procurementInformationSuggestions">["resolution"]
>;

type ResearchQuestion = Pick<
  Doc<"procurementInformationQuestions">,
  "question" | "scope"
>;

export function researchFieldType(
  kind: IntakeFollowupQuestion["kind"],
): ClRouterResearchFieldType {
  if (kind === "yes_no") return "boolean";
  if (kind === "number" || kind === "currency") return "number";
  if (kind === "date") return "date";
  if (kind === "dropdown") return "enum";
  return "string";
}

export function researchFieldDescription({
  question,
  scope,
}: ResearchQuestion) {
  return [
    question.label,
    scope.period !== "current" ? `Period: ${scope.period}.` : "",
    scope.coverage !== "unknown"
      ? `Insurance coverage: ${scope.coverage}.`
      : "",
    question.kind === "currency" && scope.currency
      ? `Amount in ${scope.currency}.`
      : "",
    question.kind === "dropdown"
      ? `Choose one of: ${question.options.join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

/** The value in the question's own answer format, or null when it does not fit. */
export function suggestionAnswer(
  { question }: ResearchQuestion,
  value: string | number | boolean | null,
): string | null {
  let answer: string | null = null;
  if (question.kind === "yes_no" && typeof value === "boolean")
    answer = value ? "Yes" : "No";
  else if (
    (question.kind === "number" || question.kind === "currency") &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    (question.kind === "number" || value >= 0)
  )
    answer = String(
      question.kind === "currency" ? Math.round(value * 100) / 100 : value,
    );
  else if (
    question.kind === "date" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayjs(value).isValid() &&
    dayjs(value).format("YYYY-MM-DD") === value
  )
    answer = value;
  else if (
    question.kind === "dropdown" &&
    typeof value === "string" &&
    question.options.includes(value)
  )
    answer = value;
  else if (question.kind === "short_text" && typeof value === "string")
    answer = value.trim().slice(0, 500) || null;
  if (!answer) return null;
  try {
    validateFollowupAnswers([{ ...question, answer }]);
  } catch {
    return null;
  }
  return answer;
}

/** Whether a submitted answer states the same fact as a suggestion. */
export function sameInformationAnswer(
  kind: IntakeFollowupQuestion["kind"],
  left: string,
  right: string,
) {
  if (kind === "number" || kind === "currency") {
    const a = Number(left.replaceAll(",", ""));
    const b = Number(right.replaceAll(",", ""));
    return Number.isFinite(a) && a === b;
  }
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(left) === normalize(right);
}

/** Only public identity facts reach providers: name, website and city/region. */
export async function researchEntity(
  ctx: Ctx,
  request: Doc<"procurementRequests">,
): Promise<ResearchEntity | null> {
  const org = request.clientOrgId
    ? await ctx.db.get(request.clientOrgId)
    : null;
  const answers =
    request.intakeSubmittedApplication?.answers ?? request.intakeAnswers;
  const name = (org?.name ?? answers?.legalName ?? answers?.dba)
    ?.trim()
    .slice(0, 200);
  if (!name) return null;
  const rawWebsite = (org?.website ?? answers?.website)?.trim();
  const website =
    rawWebsite &&
    publicResearchUrl(
      /^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`,
    );
  const details =
    org?.intakeBusinessProfile?.details ??
    request.intakeSubmittedApplication?.details;
  const address = details?.registrationAddress ?? details?.mailingAddress;
  const location = [address?.city, address?.state]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 200);
  return {
    name,
    ...(website ? { website } : {}),
    ...(location ? { location } : {}),
  };
}

const revisionKey = (questionId: string, answerId: string | undefined) =>
  `${questionId}:${answerId ?? ""}`;

/**
 * Unresolved, applicable questions research could pre-answer. A pending or
 * dismissed suggestion for the same answer revision excludes a question;
 * automatic runs also skip revisions an earlier run already assessed.
 * `fromProvider` marks questions whose wording may come from a provider: any
 * requirement links a provider outreach or source email. Catalog questions and
 * Spot's own (operator-authored, no outreach) questions are not.
 */
export async function researchableInformationQuestions(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  automatic: boolean,
) {
  const [facts, requirements, pending, dismissed] = await Promise.all([
    requestFacts(ctx, requestId),
    bounded(
      ctx.db
        .query("procurementInformationRequirements")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    ),
    suggestionsWithStatus(ctx, requestId, "pending"),
    suggestionsWithStatus(ctx, requestId, "dismissed"),
  ]);
  const excluded = new Set(
    [...pending, ...dismissed].map((s) =>
      revisionKey(s.questionId, s.answerIdAtSuggestion),
    ),
  );
  return neededInformationQuestions(facts, requirements)
    .filter(
      (q) =>
        RESEARCHABLE_KINDS.has(q.question.kind) &&
        // Other subjects (people, vehicles, sites) could disclose private details.
        q.scope.subject === "company" &&
        informationApplicability(q, facts) === "applies" &&
        !excluded.has(revisionKey(q._id, q.answerId)) &&
        !(
          automatic &&
          q.researchAssessedAt !== undefined &&
          q.researchAssessedAnswerId === q.answerId
        ),
    )
    .slice(0, MAX_ELIGIBILITY_QUESTIONS)
    .map((q) => ({
      ...q,
      fromProvider:
        !q.question.source?.trim() &&
        requirements.some(
          (r) => r.questionId === q._id && (r.outreachId || r.sourceMessageId),
        ),
    }));
}

function suggestionsWithStatus(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  status: Doc<"procurementInformationSuggestions">["status"],
) {
  return ctx.db
    .query("procurementInformationSuggestions")
    .withIndex("by_request_status", (q) =>
      q.eq("requestId", requestId).eq("status", status),
    )
    .take(500);
}

export function latestResearchRuns(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
) {
  return ctx.db
    .query("procurementInformationResearchRuns")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .take(50);
}

export function researchFingerprint(
  entity: ResearchEntity,
  questions: { _id: string; answerId?: string }[],
) {
  return actionConfirmationFingerprint({
    entity,
    questions: questions.map((q) => revisionKey(q._id, q.answerId)).sort(),
  });
}

export function researchRunStatus(
  run: Doc<"procurementInformationResearchRuns">,
) {
  return {
    researchRunId: run._id,
    status: run.status,
    automatic: run.automatic,
    questionCount: run.questionCount,
    suggestionCount: run.suggestionCount,
    ...(run.error ? { error: run.error } : {}),
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? null,
  };
}

/**
 * Queue research for the request's researchable questions. An active run or an
 * identical earlier one (same questions, answers and entity) is returned
 * instead; only a failed run is retried. Automatic runs wait so questions added
 * together share one run.
 */
export async function enqueueInformationResearch(
  ctx: MutationCtx,
  request: Doc<"procurementRequests">,
  automatic: boolean,
): Promise<{
  run: Doc<"procurementInformationResearchRuns"> | null;
  reused: boolean;
}> {
  const active = (await latestResearchRuns(ctx, request._id)).find(
    (run) => run.status === "queued" || run.status === "running",
  );
  if (active) return { run: active, reused: true };
  const [entity, questions] = await Promise.all([
    researchEntity(ctx, request),
    researchableInformationQuestions(ctx, request._id, automatic),
  ]);
  if (!entity || !questions.length) return { run: null, reused: false };
  const fingerprint = await researchFingerprint(entity, questions);
  const previous = await ctx.db
    .query("procurementInformationResearchRuns")
    .withIndex("by_request_and_fingerprint", (q) =>
      q.eq("requestId", request._id).eq("fingerprint", fingerprint),
    )
    .order("desc")
    .first();
  // A failed run, or one that found nothing to assess when it started, is not reused.
  if (previous && previous.status !== "failed" && previous.questionCount > 0)
    return { run: previous, reused: true };
  const runId = await ctx.db.insert("procurementInformationResearchRuns", {
    requestId: request._id,
    fingerprint,
    automatic,
    status: "queued",
    questions: questions.map((q) => ({
      questionId: q._id,
      answerId: q.answerId,
    })),
    questionCount: questions.length,
    suggestionCount: 0,
    createdAt: dayjs().valueOf(),
  });
  const delay = automatic ? AUTOMATIC_RESEARCH_DELAY_MS : 0;
  await ctx.scheduler.runAfter(
    delay,
    internal.actions.procurementInformationResearch.run,
    { runId },
  );
  // Fails the run if it never starts or its action is lost.
  await ctx.scheduler.runAfter(
    delay + RESEARCH_RUN_TIMEOUT_MS,
    internal.procurementInformationSuggestions.expireRun,
    { runId },
  );
  return { run: (await ctx.db.get(runId))!, reused: false };
}

/** Questions just added to a live request queue debounced automatic research. */
export async function queueAutomaticInformationResearch(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await ctx.db.get(requestId);
  if (!request || request.deletedAt) return;
  await enqueueInformationResearch(ctx, request, true);
}

/**
 * An answer from any writer resolves the question's pending suggestions.
 * Accept paths resolve their own suggestion first, so it is no longer pending.
 */
export async function resolvePendingSuggestions(
  ctx: MutationCtx,
  questionId: Id<"procurementInformationQuestions">,
  resolve: (suggestion: Doc<"procurementInformationSuggestions">) => {
    status: "accepted" | "superseded";
    resolution: SuggestionResolution;
  } = () => ({
    status: "superseded",
    resolution: "answered_elsewhere",
  }),
  resolvedByUserId?: Id<"users">,
) {
  const suggestions = await ctx.db
    .query("procurementInformationSuggestions")
    .withIndex("by_question", (q) => q.eq("questionId", questionId))
    .take(100);
  for (const suggestion of suggestions)
    if (suggestion.status === "pending")
      await ctx.db.patch(suggestion._id, {
        ...resolve(suggestion),
        resolvedAt: dayjs().valueOf(),
        resolvedByUserId,
      });
}

/** Each live question's pending suggestion for its current answer revision. */
export async function pendingSuggestionsByQuestion(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  questions: Doc<"procurementInformationQuestions">[],
) {
  const current = new Map(
    questions.filter((q) => !q.archivedAt).map((q) => [q._id, q]),
  );
  const result = new Map<
    Id<"procurementInformationQuestions">,
    Doc<"procurementInformationSuggestions">
  >();
  for (const suggestion of await suggestionsWithStatus(
    ctx,
    requestId,
    "pending",
  )) {
    const question = current.get(suggestion.questionId);
    if (question && suggestion.answerIdAtSuggestion === question.answerId)
      result.set(question._id, suggestion);
  }
  return result;
}

/** Pending suggestions still matching the question's current answer revision. */
export async function currentPendingSuggestions(
  ctx: Ctx,
  question: Doc<"procurementInformationQuestions">,
) {
  const suggestions = await ctx.db
    .query("procurementInformationSuggestions")
    .withIndex("by_question", (q) => q.eq("questionId", question._id))
    .take(100);
  return suggestions.filter(
    (s) =>
      s.status === "pending" &&
      s.requestId === question.requestId &&
      s.answerIdAtSuggestion === question.answerId &&
      !question.archivedAt,
  );
}

/** Clients see only a current high-confidence suggestion, with its cited sources. */
export async function clientFormSuggestion(
  ctx: Ctx,
  form: Doc<"procurementInformationForms">,
  item: Doc<"procurementInformationForms">["questions"][number],
) {
  if (form.status !== "open") return undefined;
  const question = await ctx.db.get(item.questionId);
  if (
    !question ||
    question.requestId !== form.requestId ||
    question.answerId !== item.answerIdAtPublish
  )
    return undefined;
  const suggestion = (await currentPendingSuggestions(ctx, question)).find(
    (s) => s.confidence === "high",
  );
  return suggestion
    ? {
        suggestionId: suggestion._id,
        answer: suggestion.answer,
        citations: suggestion.citations.map(({ url, title }) => ({
          url,
          ...(title ? { title } : {}),
        })),
      }
    : undefined;
}
