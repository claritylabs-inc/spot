import {
  informationApplicability,
  informationFormTitle,
} from "../lib/procurement-information";
import dayjs from "dayjs";
import { intakeCurrency } from "../lib/intake-money";
import { v } from "convex/values";
import { orgBrandFields } from "./lib/orgBranding";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOperator } from "./lib/operatorIdentity";
import { requireRequest } from "./procurementRequests";
import { informationRequirementStatus } from "./lib/procurementInformationSchema";
import { validateFollowupAnswers } from "../lib/intake-followups";
import { normalizeIntakeQuestion } from "../lib/intake-question-reference";
import {
  MAX,
  text,
  bounded,
  operatorWrite,
  audit,
  requireInformationQuestion,
  requestFacts,
  filesForClient,
  businessNameForRequest,
  cancelSupersededForms,
  assertInformationQuestionsArchivable,
} from "./lib/procurementInformationAccess";
import {
  requirementArgs,
  addRequirementForRequest,
} from "./lib/procurementInformationRequirements";
import {
  queueAutomaticInformationResearch,
  resolvePendingSuggestions,
} from "./lib/procurementInformationResearch";

export const operatorForms = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await requireOperator(ctx);
    const request = await requireRequest(ctx, requestId);
    if (request.deletedAt) throw new Error("Request not found");
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    );
    return forms.map((form) => ({
      id: form._id,
      title: informationFormTitle(form, forms),
      status: form.status,
      questionCount: form.questions.length,
    }));
  },
});
export const panel = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await requireOperator(ctx);
    const request = await requireRequest(ctx, requestId);
    if (request.deletedAt) throw new Error("Request not found");
    const [
      questions,
      requirements,
      forms,
      deliveries,
      outreaches,
      threads,
      extractions,
    ] = await Promise.all([
      bounded(
        ctx.db
          .query("procurementInformationQuestions")
          .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
          .take(MAX + 1),
      ),
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
        .query("procurementInformationDeliveries")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .order("desc")
        .take(500),
      ctx.db
        .query("procurementBrokerOutreaches")
        .withIndex("request", (q) => q.eq("requestId", requestId))
        .take(MAX),
      ctx.db
        .query("teamEmailThreads")
        .withIndex("by_requestId_and_latestMessageAt", (q) =>
          q.eq("requestId", requestId),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("procurementInformationExtractions")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .order("desc")
        .take(50),
    ]);
    const questionViews = await Promise.all(
      questions
        .filter((q) => !q.archivedAt)
        .map(async (row) => ({
          ...row,
          answer: row.answerId ? await ctx.db.get(row.answerId) : null,
        })),
    );
    return {
      businessName: await businessNameForRequest(ctx, request),
      currency: intakeCurrency(
        request.intakeSubmittedApplication?.details.registrationCountry ??
          request.intakeDetails?.registrationCountry,
      ),
      emailActivity: {
        running: extractions.filter(
          (row) => row.automatic && row.status === "running",
        ).length,
        needsReview: extractions.filter(
          (row) =>
            row.automatic &&
            (row.status === "failed" ||
              (row.unappliedCount ?? 0) > 0 ||
              !!row.reviewReasons?.length) &&
            (row.audience !== "client" ||
              (row.answerTargets ?? []).some((target) => {
                const q = questionViews.find(
                  (q) => q._id === target.questionId,
                );
                return q && (!q.answer || q.answer.unsure);
              })) &&
            (!!row.reviewReasons?.length ||
              row.status === "failed" ||
              !row.questions.length ||
              row.questions.some(
                (proposal) =>
                  !questions.some(
                    (q) =>
                      !q.archivedAt &&
                      normalizeIntakeQuestion(q.question.label) ===
                        normalizeIntakeQuestion(proposal.label) &&
                      q.scope.coverage === proposal.coverage &&
                      normalizeIntakeQuestion(q.scope.subject) ===
                        normalizeIntakeQuestion(proposal.subject) &&
                      normalizeIntakeQuestion(q.scope.period) ===
                        normalizeIntakeQuestion(proposal.period) &&
                      requirements.some(
                        (r) =>
                          r.questionId === q._id &&
                          r.outreachId === row.outreachId,
                      ),
                  ),
              )),
        ).length,
      },
      questions: questionViews,
      requirements,
      forms: await Promise.all(
        forms.map(async (form) => {
          const sequence = form.outreachSequenceId
            ? await ctx.db.get(form.outreachSequenceId)
            : null;
          const firstStep = sequence
            ? await ctx.db
                .query("procurementOutreachSteps")
                .withIndex("by_sequenceId_and_index", (q) =>
                  q.eq("sequenceId", sequence._id),
                )
                .first()
            : null;
          return {
            ...form,
            title: informationFormTitle(form, forms),
            email:
              sequence &&
              sequence.requestId === requestId &&
              sequence.informationFormId === form._id
                ? {
                    sequenceId: sequence._id,
                    status: sequence.status,
                    deliveryStatus: firstStep?.status ?? null,
                    recipient: sequence.recipient.email,
                    subject: sequence.message?.subject ?? "",
                    threadId: sequence.teamEmailThreadId ?? null,
                    createdAt: sequence.createdAt,
                  }
                : null,
          };
        }),
      ),
      deliveries,
      deliveriesLimited: deliveries.length === 500,
      threadsLimited: threads.length === 50,
      outreaches: await Promise.all(
        outreaches.map(async (outreach) => ({
          ...outreach,
          ...(await orgBrandFields(
            ctx,
            outreach.brokerOrgId
              ? await ctx.db.get(outreach.brokerOrgId)
              : null,
          )),
        })),
      ),
      threads: threads
        .filter((t) => !t.deletedAt)
        .map((t) => ({
          id: t._id,
          outreachId: t.outreachId,
          subject: t.subject,
        })),
      files: await filesForClient(ctx, requestId),
    };
  },
});
export const messages = query({
  args: {
    requestId: v.id("procurementRequests"),
    threadId: v.id("teamEmailThreads"),
  },
  handler: async (ctx, { requestId, threadId }) => {
    await requireOperator(ctx);
    const request = await requireRequest(ctx, requestId);
    if (request.deletedAt) throw new Error("Request not found");
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.requestId !== requestId || thread.deletedAt)
      throw new Error("Thread not found");
    const messages = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) =>
        q.eq("threadId", threadId),
      )
      .order("desc")
      .take(50);
    return messages.map((m) => ({
      id: m._id,
      direction: m.direction,
      text: m.currentText?.slice(0, 30000) ?? "",
    }));
  },
});
export const addRequirement = mutation({
  args: requirementArgs,
  handler: async (ctx, args) => {
    const { operator, request } = await operatorWrite(ctx, args.requestId);
    const requirementId = await addRequirementForRequest(
      ctx,
      args,
      request,
      operator.userId,
    );
    await queueAutomaticInformationResearch(ctx, request._id);
    return requirementId;
  },
});
export const setRequirementStatus = mutation({
  args: {
    requirementId: v.id("procurementInformationRequirements"),
    revision: v.number(),
    status: informationRequirementStatus,
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requirementId);
    if (!row) throw new Error("Requirement not found");
    const { operator, request } = await operatorWrite(ctx, row.requestId);
    if (row.revision !== args.revision)
      throw new Error("Requirement changed. Reload and try again");
    const q = await requireInformationQuestion(
      ctx,
      row.questionId,
      row.requestId,
    );
    if (
      args.status === "accepted" &&
      informationApplicability(q, await requestFacts(ctx, row.requestId)) !==
        "applies"
    )
      throw new Error("Resolve the prerequisite before accepting this answer");
    if (
      args.status === "accepted" &&
      (!q.answerId || (await ctx.db.get(q.answerId))?.unsure)
    )
      throw new Error("An answer is required before acceptance");
    const note =
      args.status === "needs_information"
        ? args.note.trim().slice(0, 1000)
        : text(args.note, 1000);
    await ctx.db.patch(row._id, {
      status: args.status,
      resolutionNote: note,
      acceptedAnswerId: args.status === "accepted" ? q.answerId : undefined,
      revision: row.revision + 1,
      updatedAt: dayjs().valueOf(),
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      `Information requirement: ${args.status}`,
    );
  },
});
export const recordAnswer = mutation({
  args: {
    questionId: v.id("procurementInformationQuestions"),
    previousAnswerId: v.optional(v.id("procurementInformationAnswers")),
    answer: v.string(),
    provenance: v.string(),
    fileItemIds: v.array(v.id("procurementFileItems")),
  },
  handler: async (ctx, args) => {
    const q = await ctx.db.get(args.questionId);
    if (!q) throw new Error("Question not found");
    const { operator, request } = await operatorWrite(ctx, q.requestId);
    return recordInformationAnswerByOperator(
      ctx,
      operator.user._id,
      request,
      q,
      args,
    );
  },
});
/** The operator answer writer, shared with accepted research suggestions. */
export async function recordInformationAnswerByOperator(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  request: Doc<"procurementRequests">,
  q: Doc<"procurementInformationQuestions">,
  args: {
    previousAnswerId?: Id<"procurementInformationAnswers">;
    answer: string;
    provenance: string;
    fileItemIds: Id<"procurementFileItems">[];
  },
) {
  if (q.answerId !== args.previousAnswerId)
    throw new Error("Answer changed. Reload before saving");
  if (
    informationApplicability(q, await requestFacts(ctx, q.requestId)) !==
    "applies"
  )
    throw new Error("Resolve the prerequisite before recording this answer");
  const raw = args.answer.trim();
  const unsure = !raw || raw === "I'm not sure";
  const answer = unsure ? "" : text(raw, 2000);
  if (!unsure) validateFollowupAnswers([{ ...q.question, answer }]);
  if (
    !unsure &&
    q.question.kind === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(answer) ||
      !dayjs(answer).isValid() ||
      dayjs(answer).format("YYYY-MM-DD") !== answer)
  )
    throw new Error("Enter a valid calendar date");
  const allowed = new Set(
    (await filesForClient(ctx, q.requestId)).map((f) => f.id),
  );
  if (
    args.fileItemIds.length > 10 ||
    args.fileItemIds.some((id) => !allowed.has(id))
  )
    throw new Error("Invalid files");
  const answerId = await ctx.db.insert("procurementInformationAnswers", {
    requestId: q.requestId,
    questionId: q._id,
    answer,
    unsure,
    fileItemIds: args.fileItemIds,
    suppliedByUserId: operatorUserId,
    provenance: text(args.provenance, 1000),
    createdAt: dayjs().valueOf(),
  });
  await ctx.db.patch(q._id, { answerId });
  await cancelSupersededForms(ctx, q.requestId, q._id);
  await resolvePendingSuggestions(ctx, q._id);
  await audit(
    ctx,
    operatorUserId,
    request,
    "Recorded supplementary answer with provenance",
  );
  return answerId;
}
export const archiveQuestion = mutation({
  args: {
    questionId: v.id("procurementInformationQuestions"),
    archive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.questionId);
    if (!row) throw new Error("Question not found");
    const { operator, request } = await operatorWrite(ctx, row.requestId);
    if (args.archive)
      await assertInformationQuestionsArchivable(ctx, row.requestId, [row._id]);
    await ctx.db.patch(row._id, {
      archivedAt: args.archive ? dayjs().valueOf() : undefined,
    });
    await audit(
      ctx,
      operator.userId,
      request,
      args.archive
        ? "Archived supplementary question"
        : "Restored supplementary question",
    );
  },
});

/** Only known correspondents on a live linked request can populate facts. */
