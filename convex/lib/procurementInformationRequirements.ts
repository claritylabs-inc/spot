import dayjs from "dayjs";
import { intakeCurrency } from "../../lib/intake-money";
import { COVERAGE_OPTIONS } from "../../lib/insurance-intake-details";
import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { informationScopeValidator } from "./procurementInformationSchema";
import { followupQuestionValidator } from "./intakeFollowupSchema";
import { validateFollowupAnswers } from "../../lib/intake-followups";
import { normalizeIntakeQuestion } from "../../lib/intake-question-reference";
import {
  MAX,
  text,
  bounded,
  audit,
  sourceMessage,
  requireInformationQuestion,
} from "./procurementInformationAccess";

export const requirementArgs = {
  requestId: v.id("procurementRequests"),
  // Omitted when Spot itself needs an unanswered application fact.
  outreachId: v.optional(v.id("procurementBrokerOutreaches")),
  questionId: v.optional(v.id("procurementInformationQuestions")),
  question: followupQuestionValidator,
  scope: informationScopeValidator,
  carrier: v.optional(v.string()),
  sourceMessageId: v.optional(v.id("teamEmailMessages")),
  sourceQuote: v.optional(v.string()),
};
export async function addRequirementForRequest(
  ctx: MutationCtx,
  args: Infer<typeof _requirementArgsValidator>,
  request: Doc<"procurementRequests">,
  operatorUserId: Id<"users">,
) {
  const outreach = args.outreachId ? await ctx.db.get(args.outreachId) : null;
  if (args.outreachId && (!outreach || outreach.requestId !== request._id))
    throw new Error("Provider not found");
  const requirements = await bounded(
    ctx.db
      .query("procurementInformationRequirements")
      .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
      .take(MAX + 1),
  );
  if (requirements.length >= MAX)
    throw new Error("Maximum 200 requirements per request");
  if (args.sourceMessageId) {
    if (!outreach) throw new Error("A source email needs a provider");
    const message = await sourceMessage(
      ctx,
      args.sourceMessageId,
      request._id,
      outreach._id,
    );
    if (
      message.direction !== "inbound" ||
      !args.sourceQuote?.trim() ||
      !message.currentText?.includes(args.sourceQuote.trim())
    )
      throw new Error("Source quote must appear in the provider's email");
  } else if (args.sourceQuote)
    throw new Error("A source quote needs a linked email");
  const now = dayjs().valueOf();
  let questionId = args.questionId;
  if (questionId) {
    await requireInformationQuestion(ctx, questionId, request._id);
  } else {
    for (const condition of args.question.conditions ?? []) {
      const parentId = ctx.db.normalizeId(
        "procurementInformationQuestions",
        condition.questionId,
      );
      if (!parentId) throw new Error("Choose a valid prerequisite question");
      const parent = await requireInformationQuestion(
        ctx,
        parentId,
        request._id,
      );
      if (
        parent.question.kind !== "yes_no" ||
        !["Yes", "No"].includes(condition.answer)
      )
        throw new Error("Prerequisites must reference a Yes/No answer");
    }
    validateFollowupAnswers([{ ...args.question, answer: "" }]);
    if (!COVERAGE_OPTIONS.some((c) => c.id === args.scope.coverage))
      throw new Error("Choose a coverage line");
    const scope = {
      subject: text(args.scope.subject, 200),
      period: text(args.scope.period, 200),
      coverage: text(args.scope.coverage, 100),
      currency:
        args.question.kind === "currency"
          ? (args.scope.currency ??
            intakeCurrency(
              request.intakeSubmittedApplication?.details.registrationCountry ??
                request.intakeDetails?.registrationCountry,
            ))
          : undefined,
    };
    if (
      scope.currency &&
      !["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY"].includes(
        scope.currency,
      )
    )
      throw new Error("Choose a supported currency");
    const questions = await bounded(
      ctx.db
        .query("procurementInformationQuestions")
        .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
        .take(MAX + 1),
    );
    if (questions.length >= MAX)
      throw new Error("Maximum 200 questions per request");
    // Only exact meaning and scope matches are merged automatically. Semantic merges are explicit operator choices.
    const conditions = args.question.conditions ?? [];
    if (new Set(conditions.map((c) => c.questionId)).size !== conditions.length)
      throw new Error("Choose each prerequisite only once");
    const same = questions.find(
      (q) =>
        !q.archivedAt &&
        normalizeIntakeQuestion(q.question.label) ===
          normalizeIntakeQuestion(args.question.label) &&
        q.question.kind === args.question.kind &&
        JSON.stringify(q.question.options) ===
          JSON.stringify(args.question.options) &&
        q.scope.subject === scope.subject &&
        q.scope.period === scope.period &&
        q.scope.coverage === scope.coverage &&
        (q.question.kind === "currency"
          ? (q.scope.currency ??
            intakeCurrency(
              request.intakeSubmittedApplication?.details.registrationCountry ??
                request.intakeDetails?.registrationCountry,
            ))
          : undefined) === scope.currency &&
        (q.question.conditions ?? []).length === conditions.length &&
        conditions.every((c) =>
          (q.question.conditions ?? []).some(
            (other) =>
              other.questionId === c.questionId && other.answer === c.answer,
          ),
        ),
    );
    questionId =
      same?._id ??
      (await ctx.db.insert("procurementInformationQuestions", {
        requestId: request._id,
        question: {
          ...args.question,
          label: text(args.question.label),
          source: undefined,
        },
        scope,
        createdByUserId: operatorUserId,
        createdAt: now,
      }));
  }
  const duplicate = requirements.find(
    (r) =>
      r.questionId === questionId &&
      r.outreachId === args.outreachId &&
      r.carrier === args.carrier?.trim() &&
      !["withdrawn", "waived"].includes(r.status),
  );
  if (duplicate) return duplicate._id;
  const id = await ctx.db.insert("procurementInformationRequirements", {
    requestId: request._id,
    questionId,
    outreachId: args.outreachId,
    carrier: args.carrier?.trim().slice(0, 200),
    sourceMessageId: args.sourceMessageId,
    sourceQuote: args.sourceQuote?.trim(),
    status: "needs_information",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  await audit(
    ctx,
    operatorUserId,
    request,
    outreach
      ? "Added provider information requirement"
      : "Added application information requirement",
  );
  return id;
}
const _requirementArgsValidator = v.object(requirementArgs);
