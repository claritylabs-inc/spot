import {
  informationApplicability,
  informationFormTitle,
  neededInformationQuestions,
} from "../../lib/procurement-information";
import type { IntakeFollowupQuestion } from "../../lib/intake-followups";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
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

export async function procurementInformationOverview(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  await liveRequest(ctx, requestId);
  const [facts, requirements, forms, outreaches] = await Promise.all([
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
  ]);
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
      readyForForm: needed.has(q._id) && !openFormQuestions.has(q._id),
      inOpenForm: openFormQuestions.has(q._id),
      requirements: requirements
        .filter((r) => r.questionId === q._id)
        .map((r) => ({
          procurementOutreachId: r.outreachId,
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
  };
}

export async function addInformationQuestionsByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    questions: OperatorInformationQuestionInput[];
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await liveRequest(ctx, args.requestId);
  const added = [];
  for (const q of args.questions) {
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
    );
    const requirement = await ctx.db.get(requirementId);
    added.push({
      questionId: requirement!.questionId,
      label: q.label,
      requirementId,
    });
  }
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
