import {
  informationApplicability,
  informationFormTitle,
  neededInformationQuestions,
} from "../../lib/procurement-information";
import type { IntakeFollowupQuestion } from "../../lib/intake-followups";
import { submittedIntakeApplication } from "../../lib/intake-application";
import { intakeQuestionHistory } from "../../lib/intake-question-history";
import { detailsAnswers } from "../../lib/insurance-intake-details";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { NoWriteInputError } from "./noWriteInputError";
import {
  requireDirectOperatorWrite,
  requireRequest,
} from "../procurementRequests";
import {
  cancelInformationForm,
  informationFormUrl,
  publishInformationForm,
} from "../procurementInformationForms";
import { MAX, bounded, requestFacts } from "./procurementInformationAccess";
import { addRequirementForRequest } from "./procurementInformationRequirements";
import {
  latestResearchRuns,
  pendingSuggestionsByQuestion,
  queueAutomaticInformationResearch,
  researchRunStatus,
} from "./procurementInformationResearch";

/**
 * Agent and MCP access to supplementary client information: the same question,
 * requirement and form primitives as the request Information workspace.
 */

export type OperatorInformationQuestionInput = {
  label: string;
  kind: IntakeFollowupQuestion["kind"];
  options?: string[];
  coverage: string;
  subject?: string;
  period?: string;
  currency?: string;
  carrier?: string;
  condition?: {
    questionId: Id<"procurementInformationQuestions">;
    answer: "Yes" | "No";
  };
};

async function liveRequest(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await requireRequest(ctx, requestId);
  if (request.deletedAt) throw new Error("Request not found");
  return request;
}

// Bookkeeping fields are never client questions.
const NON_QUESTION_FIELDS = new Set([
  "intakeGoal",
  "timingUnknown",
  "companyConfirmed",
]);

/** Accepted-application questions still blank, so operators can ask the client for just those. */
export function unansweredApplicationQuestions(
  request: Doc<"procurementRequests">,
) {
  const application = submittedIntakeApplication(request);
  if (!application) return null;
  // Typed details are authoritative where their derived answer text is blank.
  const derived = Object.entries(detailsAnswers(application.details)).filter(
    ([, value]) => value?.trim(),
  );
  const history = intakeQuestionHistory(
    { ...application.answers, ...Object.fromEntries(derived) },
    application.details,
    request.intakeSkippedSteps ?? [],
  );
  const canada = application.details.registrationCountry === "Canada";
  return [
    ...history.baseQuestions.flatMap((step) =>
      step.fields
        .filter(
          (field) =>
            field.status !== "answered" &&
            !NON_QUESTION_FIELDS.has(field.id) &&
            field.id !== (canada ? "fein" : "businessNumber"),
        )
        .map((field) => ({
          field: field.id as string,
          question: field.question,
          status: field.status,
        })),
    ),
    ...[
      ...history.propertyQuestions,
      ...history.cyberDocumentQuestions,
      ...history.followupQuestions.filter((row) => row.applicable),
    ]
      .filter((row) => row.status !== "answered")
      .map((row) => ({
        field: row.id,
        question: row.question,
        status: row.status,
      })),
  ];
}

export async function procurementInformationOverview(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const request = await liveRequest(ctx, requestId);
  const [facts, requirements, forms, outreaches, runs] = await Promise.all([
    requestFacts(ctx, requestId),
    bounded(
      ctx.db
        .query("procurementInformationRequirements")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    ),
    bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    ),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(MAX),
    latestResearchRuns(ctx, requestId),
  ]);
  const suggestions = await pendingSuggestionsByQuestion(ctx, requestId, facts);
  const needed = new Set(
    neededInformationQuestions(facts, requirements).map((q) => q._id),
  );
  const openFormQuestions = new Set(
    forms
      .filter((f) => f.status === "open")
      .flatMap((f) => f.questions.map((q) => q.questionId)),
  );
  return {
    providers: outreaches.map((o) => ({
      procurementOutreachId: o._id,
      providerName: o.brokerName,
      status: o.status,
    })),
    questions: facts.map((q) => ({
      questionId: q._id,
      label: q.question.label,
      kind: q.question.kind,
      options: q.question.options,
      conditions: q.question.conditions ?? [],
      scope: q.scope,
      applicability: informationApplicability(q, facts),
      answer: q.answer
        ? { text: q.answer.answer, unsure: q.answer.unsure }
        : null,
      suggestion: compactSuggestion(suggestions.get(q._id)),
      readyForForm: needed.has(q._id) && !openFormQuestions.has(q._id),
      inOpenForm: openFormQuestions.has(q._id),
      requirements: requirements
        .filter((r) => r.questionId === q._id)
        .map((r) => ({
          procurementOutreachId: r.outreachId ?? null,
          carrier: r.carrier ?? null,
          status: r.status,
        })),
    })),
    forms: forms.map((f) => ({
      informationFormId: f._id,
      title: informationFormTitle(f, forms),
      status: f.status,
      url: f.status === "cancelled" ? null : informationFormUrl(f._id),
      questionIds: f.questions.map((q) => q.questionId),
      emailed: !!f.outreachSequenceId,
      submittedAt: f.submittedAt ?? null,
    })),
    unansweredApplicationQuestions: unansweredApplicationQuestions(request),
    research: runs[0] ? researchRunStatus(runs[0]) : null,
  };
}

/** A pending public-research answer for operator review; never an answer itself. */
function compactSuggestion(
  suggestion: Doc<"procurementInformationSuggestions"> | undefined,
) {
  if (!suggestion) return null;
  const [source] = suggestion.citations;
  return {
    suggestionId: suggestion._id,
    answer: suggestion.answer,
    confidence: suggestion.confidence,
    sourceUrl: source.url,
    // The full stored excerpt (at most 600 characters) is the verified support.
    excerpt: source.excerpt ?? null,
  };
}

export async function addInformationQuestionsByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId?: Id<"procurementBrokerOutreaches">;
    questions: OperatorInformationQuestionInput[];
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await liveRequest(ctx, args.requestId);
  const outreach = args.outreachId ? await ctx.db.get(args.outreachId) : null;
  if (args.outreachId && (!outreach || outreach.requestId !== request._id))
    throw new NoWriteInputError(
      "invalid_identifier",
      "procurementOutreachId does not belong to this request. Use an ID from list_procurement_information outreaches. Nothing was saved.",
    );
  const added = [];
  for (const [index, q] of args.questions.entries()) {
    // The mutation rolls back as a whole, so a rejected question saves nothing.
    const requirementId = await addRequirementForRequest(
      ctx,
      {
        requestId: request._id,
        outreachId: args.outreachId,
        question: {
          id: "provider_question",
          section: "additional",
          label: q.label,
          kind: q.kind,
          options: q.kind === "dropdown" ? (q.options ?? []) : [],
          conditions: q.condition ? [q.condition] : undefined,
        },
        scope: {
          subject: q.subject ?? "company",
          period: q.period ?? "current",
          coverage: q.coverage,
          currency: q.kind === "currency" ? q.currency : undefined,
        },
        carrier: q.carrier,
      },
      request,
      args.operatorUserId,
    ).catch((error: unknown) => {
      throw new NoWriteInputError(
        "invalid_question",
        `Question ${index + 1} (${JSON.stringify(q.label.slice(0, 60))}) was rejected: ${error instanceof Error ? error.message : String(error)}. Nothing was saved.`,
      );
    });
    const requirement = await ctx.db.get(requirementId);
    added.push({
      questionId: requirement!.questionId,
      label: q.label,
      requirementId,
    });
  }
  await queueAutomaticInformationResearch(ctx, request._id);
  return { added };
}

export async function createInformationFormByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    questionIds?: Id<"procurementInformationQuestions">[];
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await liveRequest(ctx, args.requestId);
  const formId = await publishInformationForm(
    ctx,
    request,
    args.operatorUserId,
    args.questionIds,
  );
  const form = (await ctx.db.get(formId))!;
  return {
    informationFormId: formId,
    title: form.title,
    url: informationFormUrl(formId),
    emailed: !!form.outreachSequenceId,
    questions: form.questions.map((q) => ({
      questionId: q.questionId,
      label: q.question.label,
    })),
  };
}

export async function cancelInformationFormByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    formId: Id<"procurementInformationForms">;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const form = await ctx.db.get(args.formId);
  if (!form) throw new Error("Form not found");
  const request = await liveRequest(ctx, form.requestId);
  await cancelInformationForm(ctx, form, request, args.operatorUserId);
  return { informationFormId: form._id, status: "cancelled" as const };
}
