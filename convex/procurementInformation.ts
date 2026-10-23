import {
  informationApplicability,
  informationFormTitle,
  neededInformationQuestions,
  orderInformationQuestions,
} from "../lib/procurement-information";
import { internal } from "./_generated/api";
import dayjs from "dayjs";
import { intakeCurrency } from "../lib/intake-money";
import { COVERAGE_OPTIONS } from "../lib/insurance-intake-details";
import { v, type Infer } from "convex/values";
import { orgBrandFields } from "./lib/orgBranding";
import { clientRecipientOptions } from "./lib/clientOutreach";
import { normalizeProcurementEmail } from "./lib/procurement";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  requireDirectOperatorWrite,
  requireRequest,
} from "./procurementRequests";
import { attachClientRequestFile } from "./clientProcurementRequests";
import { getOrgAccess } from "./lib/access";
import { ownedRequest } from "./requestIntake";
import { getSessionUserId } from "./lib/sessionIdentity";
import { recordImpersonatedWrite } from "./lib/operatorIdentity";
import {
  informationScopeValidator,
  informationExtractionQuestionValidator,
  informationRequirementStatus,
  informationResponseValidator,
  informationEmailAnswerValidator,
} from "./lib/procurementInformationSchema";
import { followupQuestionValidator } from "./lib/intakeFollowupSchema";
import {
  validateFollowupAnswers,
  formatIntakeFollowupAnswer,
  followupQuestionVisible,
} from "../lib/intake-followups";
import { normalizeIntakeQuestion } from "../lib/intake-question-reference";

type Ctx = QueryCtx | MutationCtx;
const MAX = 200;
function text(value: string, max = 500) {
  const result = value.trim();
  if (!result || result.length > max)
    throw new Error(`Enter between 1 and ${max} characters`);
  return result;
}
async function bounded<T>(promise: Promise<T[]>) {
  const rows = await promise;
  if (rows.length > MAX)
    throw new Error(
      "This request has reached its information tracking limit (200). Contact Spot.",
    );
  return rows;
}
async function operatorWrite(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const operator = await requireOperator(ctx);
  await requireDirectOperatorWrite(ctx, operator.user._id);
  const request = await requireRequest(ctx, requestId);
  if (request.deletedAt) throw new Error("Request not found");
  return { operator, request };
}
async function clientAccess(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  write = false,
) {
  const userId = await getSessionUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || user.serviceAccountKind) throw new Error("Sign in to continue");
  const request = await ctx.db.get(requestId);
  if (!request || request.deletedAt) throw new Error("Request not found");
  if (user.intakeRestricted || !request.clientVisible || !request.clientOrgId) {
    if (request.ownerUserId !== user._id || user.accountKind === "operator")
      throw new Error("Request not found");
    return { ...(await ownedRequest(ctx, requestId)), impersonated: false };
  }
  const access = await getOrgAccess(ctx, request.clientOrgId);
  if (
    access.orgType !== "client" ||
    access.accessType !== "member" ||
    (write && access.role !== "admin" && request.ownerUserId !== user._id)
  )
    throw new Error("Client request access required");
  return { request, user, impersonated: access.impersonated ?? false };
}
async function audit(
  ctx: MutationCtx,
  userId: Id<"users">,
  request: Doc<"procurementRequests">,
  summary: string,
) {
  await writeOperatorAudit(ctx, {
    operatorUserId: userId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary,
    metadata: { requestId: request._id },
  });
}
async function question(
  ctx: Ctx,
  id: Id<"procurementInformationQuestions">,
  requestId: Id<"procurementRequests">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.archivedAt || row.requestId !== requestId)
    throw new Error("Question not found");
  return row;
}
async function requestFacts(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const rows = await bounded(
    ctx.db
      .query("procurementInformationQuestions")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  return Promise.all(
    rows
      .filter((q) => !q.archivedAt)
      .map(async (q) => ({
        ...q,
        answer: q.answerId ? await ctx.db.get(q.answerId) : null,
      })),
  );
}
async function sourceMessage(
  ctx: Ctx,
  id: Id<"teamEmailMessages">,
  requestId: Id<"procurementRequests">,
  outreachId?: Id<"procurementBrokerOutreaches">,
) {
  const message = await ctx.db.get(id);
  const thread = message ? await ctx.db.get(message.threadId) : null;
  if (
    !message ||
    !thread ||
    thread.deletedAt ||
    thread.requestId !== requestId ||
    (outreachId && thread.outreachId && thread.outreachId !== outreachId)
  )
    throw new Error("Choose an email linked to this provider and request");
  if (outreachId && !thread.outreachId) {
    const outreach = await ctx.db.get(outreachId);
    const email =
      outreach?.contactEmail &&
      normalizeProcurementEmail(outreach.contactEmail);
    if (
      !outreach ||
      outreach.requestId !== requestId ||
      !email ||
      (message.direction === "inbound"
        ? normalizeProcurementEmail(message.fromEmail) !== email
        : !message.toAddresses
            .concat(message.ccAddresses)
            .some((value) => normalizeProcurementEmail(value) === email))
    )
      throw new Error("Email does not match this provider contact");
  }
  return message;
}
async function filesForClient(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const items = await bounded(
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  const result = [];
  for (const item of items) {
    if (!item.clientVisible || item.removedAt || !item.clientFileId) continue;
    const file = await ctx.db.get(item.clientFileId);
    if (!file || file.deletedAt || file.archivedAt) continue;
    result.push({
      id: item._id,
      clientFileId: file._id,
      contentType: file.contentType,
      name: item.label || file.name,
      size: file.size,
    });
  }
  return result;
}

async function businessNameForRequest(
  ctx: Ctx,
  request: Doc<"procurementRequests">,
) {
  return (
    request.intakeSubmittedApplication?.answers.dba?.trim() ||
    request.intakeAnswers?.dba?.trim() ||
    request.intakeSubmittedApplication?.answers.legalName?.trim() ||
    request.intakeAnswers?.legalName?.trim() ||
    (request.clientOrgId
      ? (await ctx.db.get(request.clientOrgId))?.name
      : undefined)
  );
}

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

const requirementArgs = {
  requestId: v.id("procurementRequests"),
  outreachId: v.id("procurementBrokerOutreaches"),
  questionId: v.optional(v.id("procurementInformationQuestions")),
  question: followupQuestionValidator,
  scope: informationScopeValidator,
  carrier: v.optional(v.string()),
  sourceMessageId: v.optional(v.id("teamEmailMessages")),
  sourceQuote: v.optional(v.string()),
};

async function addRequirementForRequest(
  ctx: MutationCtx,
  args: Infer<typeof _requirementArgsValidator>,
  request: Doc<"procurementRequests">,
  operatorUserId: Id<"users">,
) {
  const outreach = await ctx.db.get(args.outreachId);
  if (!outreach || outreach.requestId !== request._id)
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
    await question(ctx, questionId, request._id);
  } else {
    for (const condition of args.question.conditions ?? []) {
      const parentId = ctx.db.normalizeId(
        "procurementInformationQuestions",
        condition.questionId,
      );
      if (!parentId) throw new Error("Choose a valid prerequisite question");
      const parent = await question(ctx, parentId, request._id);
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
    "Added provider information requirement",
  );
  return id;
}
const _requirementArgsValidator = v.object(requirementArgs);

export const addRequirement = mutation({
  args: requirementArgs,
  handler: async (ctx, args) => {
    const { operator, request } = await operatorWrite(ctx, args.requestId);
    return addRequirementForRequest(ctx, args, request, operator.userId);
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
    const q = await question(ctx, row.questionId, row.requestId);
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

export const publishForm = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    title: v.optional(v.string()),
    questionIds: v.optional(v.array(v.id("procurementInformationQuestions"))),
  },
  handler: async (ctx, args) => {
    const { operator, request } = await operatorWrite(ctx, args.requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
        .take(MAX + 1),
    );
    if (forms.length >= MAX) throw new Error("Maximum 200 forms per request");
    const facts = await requestFacts(ctx, request._id);
    const requirements = await bounded(
      ctx.db
        .query("procurementInformationRequirements")
        .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
        .take(MAX + 1),
    );
    const available = neededInformationQuestions(facts, requirements);
    const ids =
      args.questionIds ??
      available
        .filter(
          (q) =>
            !forms.some(
              (form) =>
                form.status === "open" &&
                form.questions.some((item) => item.questionId === q._id),
            ),
        )
        .map((q) => q._id);
    if (!ids.length || ids.length > 40 || new Set(ids).size !== ids.length)
      throw new Error("Choose 1 to 40 unanswered questions");
    const selected = new Set<string>();
    const collect = (id: string) => {
      if (selected.has(id)) return;
      const q = available.find((q) => q._id === id);
      if (!q)
        throw new Error(
          "A selected question is answered, unavailable or belongs to another request. Refresh the batch.",
        );
      selected.add(id);
      for (const condition of q.question.conditions ?? []) {
        const parent = facts.find((q) => q._id === condition.questionId);
        if (!parent?.answer || parent.answer.unsure)
          collect(condition.questionId);
      }
    };
    ids.forEach(collect);
    const needed = available.filter((q) => selected.has(q._id));
    if (!needed.length)
      throw new Error("Choose unanswered questions for this batch.");
    if (needed.length > 40)
      throw new Error(
        "This batch has more than 40 questions including prerequisites. Choose a smaller batch.",
      );
    const neededIds = new Set(needed.map((q) => String(q._id)));
    const ancestorIds = new Set<string>();
    const visitAncestors = (id: string) => {
      if (ancestorIds.has(id)) return;
      ancestorIds.add(id);
      for (const condition of facts.find((q) => q._id === id)?.question
        .conditions ?? [])
        visitAncestors(condition.questionId);
    };
    for (const q of needed)
      for (const condition of q.question.conditions ?? [])
        visitAncestors(condition.questionId);
    const prerequisites = facts
      .filter(
        (q) => !neededIds.has(q._id) && q.answerId && ancestorIds.has(q._id),
      )
      .map((q) => ({ questionId: q._id, answerId: q.answerId! }));
    const questions = needed.map((q) => ({
      questionId: q._id,
      answerIdAtPublish: q.answerId,
      question: {
        ...q.question,
        id: String(q._id),
        conditions: q.question.conditions?.filter((c) =>
          neededIds.has(c.questionId),
        ),
      },
      scope: q.scope,
    }));
    const matching = forms.find(
      (form) =>
        form.status === "open" &&
        form.questions.length === questions.length &&
        form.questions.every((item) =>
          questions.some(
            (q) =>
              q.questionId === item.questionId &&
              q.answerIdAtPublish === item.answerIdAtPublish,
          ),
        ) &&
        (form.prerequisites ?? []).every((parent) =>
          facts.some(
            (q) =>
              q._id === parent.questionId && q.answerId === parent.answerId,
          ),
        ),
    );
    if (matching) return matching._id;
    if (
      forms.some(
        (form) =>
          form.status === "open" &&
          form.questions.some((q) => neededIds.has(q.questionId)),
      )
    )
      throw new Error(
        "A selected question or its prerequisite is already in an open form. Finish or cancel that batch first.",
      );
    const createdAt = dayjs().valueOf();
    const id = await ctx.db.insert("procurementInformationForms", {
      requestId: request._id,
      title: informationFormTitle({ _id: "new", createdAt }, forms),
      questions: orderInformationQuestions(questions),
      prerequisites,
      responses: [],
      revision: 0,
      status: "open",
      createdByUserId: operator.user._id,
      createdAt,
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Published supplementary information form",
    );
    return id;
  },
});

export const cancelForm = mutation({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (!form) throw new Error("Form not found");
    const { operator, request } = await operatorWrite(ctx, form.requestId);
    if (form.status !== "open")
      throw new Error("Only open forms can be cancelled");
    await ctx.db.patch(formId, {
      status: "cancelled",
      revision: form.revision + 1,
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Cancelled supplementary information form",
    );
  },
});

export const clientForms = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await clientAccess(ctx, requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    );
    return forms
      .filter((f) => f.status !== "cancelled")
      .map((f) => ({
        id: f._id,
        title: informationFormTitle(f, forms),
        status: f.status,
      }));
  },
});

export const clientForm = query({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (!form) throw new Error("Form not found");
    const { request } = await clientAccess(ctx, form.requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", form.requestId))
        .take(MAX + 1),
    );
    // Allowlist: provider identities, source email and operator notes never reach clients.
    return {
      id: form._id,
      requestId: form.requestId,
      title: informationFormTitle(form, forms),
      status: form.status,
      revision: form.revision,
      questions: form.questions,
      responses: form.responses,
      editDraft: form.editDraft,
      currency: intakeCurrency(
        request.intakeSubmittedApplication?.details.registrationCountry ??
          request.intakeDetails?.registrationCountry,
      ),
      businessName: await businessNameForRequest(ctx, request),
      files: await filesForClient(ctx, form.requestId),
    };
  },
});

/** Stage revisions separately from the accepted submission and canonical answers. */
export const editForm = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    revision: v.number(),
    discard: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form) throw new Error("Form not found");
    const { impersonated } = await clientAccess(ctx, form.requestId, true);
    if (form.status !== "submitted" || form.revision !== args.revision)
      throw new Error("This form changed. Reload before editing.");
    if (args.discard) {
      await ctx.db.patch(form._id, {
        editDraft: undefined,
        revision: form.revision + 1,
      });
    } else if (!form.editDraft) {
      const facts = await Promise.all(
        form.questions.map((q) => question(ctx, q.questionId, form.requestId)),
      );
      const responses = await Promise.all(
        facts.map(async (fact) => {
          const answer = fact.answerId ? await ctx.db.get(fact.answerId) : null;
          return answer
            ? {
                questionId: fact._id,
                answer: answer.answer,
                unsure: answer.unsure,
                fileItemIds: answer.fileItemIds,
              }
            : (form.responses.find((r) => r.questionId === fact._id) ?? {
                questionId: fact._id,
                answer: "",
                unsure: false,
                fileItemIds: [],
              });
        }),
      );
      await ctx.db.patch(form._id, {
        editDraft: {
          responses,
          answerVersions: facts.map((fact) => ({
            questionId: fact._id,
            answerId: fact.answerId,
          })),
        },
        revision: form.revision + 1,
      });
    }
    if (impersonated) await recordImpersonatedWrite(ctx);
  },
});

export const saveForm = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    revision: v.number(),
    responses: v.array(informationResponseValidator),
    submit: v.boolean(),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form) throw new Error("Form not found");
    const { user, request, impersonated } = await clientAccess(
      ctx,
      form.requestId,
      true,
    );
    if (
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft)) ||
      form.revision !== args.revision
    )
      throw new Error(
        "This form changed. Reload before continuing; your edits remain visible",
      );
    if (
      args.responses.length > 40 ||
      new Set(args.responses.map((r) => r.questionId)).size !==
        args.responses.length
    )
      throw new Error("Invalid answers");
    const allowedFiles = new Set(
      (await filesForClient(ctx, request._id)).map((f) => f.id),
    );
    for (const response of args.responses) {
      const item = form.questions.find(
        (q) => q.questionId === response.questionId,
      );
      if (
        !item ||
        response.fileItemIds.length > 10 ||
        new Set(response.fileItemIds).size !== response.fileItemIds.length ||
        response.fileItemIds.some((id) => !allowedFiles.has(id))
      )
        throw new Error("Invalid question or supporting file");
      if (response.unsure && response.answer.trim())
        throw new Error("Choose unsure or provide an answer");
      validateFollowupAnswers([
        {
          ...item.question,
          answer: response.unsure ? "I'm not sure" : response.answer,
        },
      ]);
      if (
        item.question.kind === "date" &&
        response.answer &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(response.answer) ||
          !dayjs(response.answer).isValid() ||
          dayjs(response.answer).format("YYYY-MM-DD") !== response.answer)
      )
        throw new Error("Enter a valid calendar date");
    }
    const history = form.questions.map((q) => ({
      ...q.question,
      answer:
        args.responses.find((r) => r.questionId === q.questionId)?.answer ?? "",
    }));
    const visible = form.questions.filter((q) =>
      followupQuestionVisible(q.question, history),
    );
    const responses = args.responses.filter((r) =>
      visible.some((q) => q.questionId === r.questionId),
    );
    if (args.submit) {
      for (const prerequisite of form.prerequisites ?? []) {
        const current = await question(
          ctx,
          prerequisite.questionId,
          form.requestId,
        );
        if (current.answerId !== prerequisite.answerId)
          throw new Error(
            "A prerequisite answer changed. Ask Spot to issue an updated form; your edits remain visible.",
          );
      }
      if (!args.confirmed)
        throw new Error(
          "Confirm the accuracy of your answers before submitting",
        );
      if (
        visible.some((q) => {
          const r = responses.find((r) => r.questionId === q.questionId);
          return !r || (!r.answer.trim() && !r.unsure && !r.fileItemIds.length);
        })
      )
        throw new Error("Answer each question or choose I'm not sure");
      for (const response of responses) {
        const current = await question(
          ctx,
          response.questionId,
          form.requestId,
        );
        const published = form.questions.find(
          (q) => q.questionId === response.questionId,
        )!;
        const expectedAnswerId = form.editDraft
          ? form.editDraft.answerVersions.find(
              (item) => item.questionId === response.questionId,
            )?.answerId
          : published.answerIdAtPublish;
        if (current.answerId !== expectedAnswerId)
          throw new Error(
            form.editDraft
              ? "An answer changed while you were editing. Cancel these edits and reopen Edit answers to use the latest values."
              : "An answer changed after this form was published. Ask Spot to issue an updated form; your edits remain visible.",
          );
        const answerId = await ctx.db.insert("procurementInformationAnswers", {
          ...response,
          requestId: request._id,
          formId: form._id,
          suppliedByUserId: user._id,
          provenance: "Client supplementary form submission",
          createdAt: dayjs().valueOf(),
        });
        await ctx.db.patch(response.questionId, { answerId });
      }
    }
    await ctx.db.patch(form._id, {
      ...(form.editDraft && !args.submit
        ? { editDraft: { ...form.editDraft, responses } }
        : { responses, editDraft: undefined }),
      revision: form.revision + 1,
      ...(args.submit
        ? {
            status: "submitted" as const,
            submittedAt: dayjs().valueOf(),
            submittedByUserId: user._id,
          }
        : {}),
    });
    if (impersonated && request.clientOrgId) await recordImpersonatedWrite(ctx);
    return form.revision + 1;
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
      suppliedByUserId: operator.user._id,
      provenance: text(args.provenance, 1000),
      createdAt: dayjs().valueOf(),
    });
    await ctx.db.patch(q._id, { answerId });
    await cancelSupersededForms(ctx, q.requestId, q._id);
    await audit(
      ctx,
      operator.user._id,
      request,
      "Recorded supplementary answer with provenance",
    );
    return answerId;
  },
});

export const recordDelivery = mutation({
  args: {
    requirementId: v.id("procurementInformationRequirements"),
    answerId: v.id("procurementInformationAnswers"),
    messageId: v.id("teamEmailMessages"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requirementId);
    if (!row) throw new Error("Requirement not found");
    const { operator, request } = await operatorWrite(ctx, row.requestId);
    const answer = await ctx.db.get(args.answerId);
    const q = await question(ctx, row.questionId, row.requestId);
    if (
      informationApplicability(q, await requestFacts(ctx, row.requestId)) !==
      "applies"
    )
      throw new Error("This question does not apply to the current answers");
    if (
      !answer ||
      answer.questionId !== row.questionId ||
      answer.requestId !== row.requestId ||
      answer._id !== q.answerId ||
      answer.unsure
    )
      throw new Error("Choose the current confirmed answer");
    const message = await sourceMessage(
      ctx,
      args.messageId,
      request._id,
      row.outreachId,
    );
    const outreach = await ctx.db.get(row.outreachId);
    const recipients = [...message.toAddresses, ...message.ccAddresses].map(
      (value) => value.toLowerCase(),
    );
    if (!outreach?.contactEmail)
      throw new Error(
        "Add the provider contact email before recording delivery",
      );
    if (!recipients.includes(outreach.contactEmail.toLowerCase()))
      throw new Error(
        "The provider contact must be a recipient of the sent message",
      );
    if (message.direction !== "outbound")
      throw new Error("Choose the sent provider response");
    const formattedAnswer = formatIntakeFollowupAnswer(
      { ...q.question, answer: answer.answer },
      q.scope.currency ??
        intakeCurrency(
          request.intakeSubmittedApplication?.details.registrationCountry ??
            request.intakeDetails?.registrationCountry,
        ),
    );
    // Match a complete response block, so "No" cannot match "Notes" and
    // "60000" cannot establish delivery of an answer that actually says "600000".
    const responseText = `\n${message.currentText.replace(/\r\n/g, "\n").trim()}\n`;
    const includesAnswer = (value: string) =>
      value.trim().length > 0 &&
      responseText.includes(`\n${value.replace(/\r\n/g, "\n").trim()}\n`);
    if (
      !message.currentText.includes(q.question.label) ||
      (!includesAnswer(answer.answer) && !includesAnswer(formattedAnswer)) ||
      (q.scope.period !== "current" &&
        !message.currentText
          .toLowerCase()
          .includes(q.scope.period.toLowerCase()))
    )
      throw new Error(
        "The sent message must include this question, reporting period and answer. Use Copy reply to include them together.",
      );
    for (const id of answer.fileItemIds) {
      const item = await ctx.db.get(id);
      if (
        !item ||
        item.requestId !== row.requestId ||
        !item.clientFileId ||
        !message.clientFileIds.includes(item.clientFileId)
      )
        throw new Error(
          "The sent email does not include every supporting file",
        );
    }
    const prior = await ctx.db
      .query("procurementInformationDeliveries")
      .withIndex("by_requestId", (q) => q.eq("requestId", row.requestId))
      .order("desc")
      .take(500);
    if (
      prior.some(
        (d) =>
          d.requirementId === row._id &&
          d.answerId === answer._id &&
          d.messageId === message._id,
      )
    )
      return;
    await ctx.db.insert("procurementInformationDeliveries", {
      ...args,
      requestId: row.requestId,
      recordedByUserId: operator.user._id,
      createdAt: dayjs().valueOf(),
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Recorded provider delivery of supplementary answer",
    );
  },
});

export const uploadUrl = mutation({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (
      !form ||
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft))
    )
      throw new Error("Editable form required");
    const { user, request } = await clientAccess(ctx, form.requestId, true);
    if (!request.clientOrgId)
      throw new Error("Company attachment required before uploading");
    const intentId = await ctx.db.insert("requestIntakeUploadIntents", {
      requestId: request._id,
      ownerUserId: user._id,
      createdAt: dayjs().valueOf(),
      expiresAt: dayjs().add(30, "minute").valueOf(),
    });
    return { url: await ctx.storage.generateUploadUrl(), intentId };
  },
});

export const attachFile = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    intentId: v.id("requestIntakeUploadIntents"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (
      !form ||
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft))
    )
      throw new Error("Editable form required");
    const { user, request, impersonated } = await clientAccess(
      ctx,
      form.requestId,
      true,
    );
    if (!request.clientOrgId) throw new Error("Company attachment required");
    const intent = await ctx.db.get(args.intentId);
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !intent ||
      intent.requestId !== request._id ||
      intent.ownerUserId !== user._id ||
      intent.expiresAt < dayjs().valueOf() ||
      intent.fileId
    )
      throw new Error("Upload authorization expired or already used");
    if (
      !metadata ||
      metadata._creationTime < intent.createdAt - 1000 ||
      metadata.size > 20 * 1024 * 1024 ||
      ![
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(metadata.contentType ?? "")
    )
      throw new Error("Choose a PDF, PNG, JPEG or DOCX up to 20 MB");
    const existing = await filesForClient(ctx, request._id);
    if (
      existing.reduce((total, file) => total + file.size, 0) + metadata.size >
      100 * 1024 * 1024
    )
      throw new Error("Request supporting files exceed 100 MB");
    if (existing.length >= MAX) throw new Error("Request file limit reached");
    const result = await attachClientRequestFile(
      ctx,
      {
        storageId: args.storageId,
        fileName: text(args.fileName, 200),
        contentType: metadata.contentType!,
        size: metadata.size,
      },
      { ...request, clientOrgId: request.clientOrgId },
      user._id,
    );
    await ctx.db.patch(intent._id, { fileId: args.storageId });
    if (impersonated) await recordImpersonatedWrite(ctx);
    return result;
  },
});

export const startExtraction = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    messageId: v.id("teamEmailMessages"),
  },
  handler: async (ctx, args) => {
    const { operator } = await operatorWrite(ctx, args.requestId);
    const message = await sourceMessage(ctx, args.messageId, args.requestId);
    if (message.direction !== "inbound")
      throw new Error("Choose an inbound provider email");
    const existing = await ctx.db
      .query("procurementInformationExtractions")
      .withIndex("by_requestId_and_messageId", (q) =>
        q.eq("requestId", args.requestId).eq("messageId", args.messageId),
      )
      .unique();
    if (existing) return existing._id;
    const rows = await ctx.db
      .query("procurementInformationExtractions")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .take(MAX);
    if (rows.length === MAX)
      throw new Error("Extraction limit reached; add the questions manually");
    const id = await ctx.db.insert("procurementInformationExtractions", {
      ...args,
      operatorUserId: operator.userId,
      startedAt: dayjs().valueOf(),
      status: "running",
      questions: [],
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.procurementInformation.extractInternal,
      { extractionId: id },
    );
    await ctx.scheduler.runAfter(
      15 * 60 * 1000,
      internal.procurementInformation.expireExtraction,
      { extractionId: id },
    );
    return id;
  },
});
export const extraction = query({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }) => {
    await requireOperator(ctx);
    const row = await ctx.db.get(extractionId);
    if (!row) throw new Error("Extraction not found");
    const request = await requireRequest(ctx, row.requestId);
    if (request.deletedAt) throw new Error("Request not found");
    await sourceMessage(ctx, row.messageId, row.requestId);
    return { status: row.status, questions: row.questions };
  },
});
export const extractionContext = internalQuery({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }) => {
    const row = await ctx.db.get(extractionId);
    if (!row || row.status !== "running") return null;
    await requireOperatorForUser(ctx, row.operatorUserId);
    const request = await requireRequest(ctx, row.requestId);
    if (request.deletedAt) throw new Error("Request not found");
    const message = await sourceMessage(ctx, row.messageId, row.requestId);
    const route = row.automatic
      ? await informationEmailRoute(ctx, row.messageId)
      : null;
    if (
      row.automatic &&
      (!route ||
        route.audience !== row.audience ||
        route.outreach?._id !== row.outreachId)
    )
      return null;
    const facts = await requestFacts(ctx, row.requestId);
    return {
      automatic: row.automatic ?? false,
      audience: row.audience ?? "provider",
      knownQuestions: facts.map((q) => ({
        id: q._id,
        question: q.question,
        scope: q.scope,
        answer: q.answer?.answer ?? null,
        unsure: q.answer?.unsure ?? false,
      })),
      answerTargets: row.answerTargets ?? [],
      body: message.currentText,
      application: request.intakeSubmittedApplication ?? null,
      requestId: row.requestId,
    };
  },
});
export const finishExtraction = internalMutation({
  args: {
    extractionId: v.id("procurementInformationExtractions"),
    failed: v.boolean(),
    questions: v.array(informationExtractionQuestionValidator),
    emailAnswers: v.optional(v.array(informationEmailAnswerValidator)),
    reviewReasons: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.extractionId);
    if (!row || row.status !== "running") return;
    let valid = !args.failed;
    let request: Doc<"procurementRequests"> | null = null;
    try {
      await requireOperatorForUser(ctx, row.operatorUserId);
      request = await requireRequest(ctx, row.requestId);
      if (request.deletedAt) valid = false;
      await sourceMessage(ctx, row.messageId, row.requestId);
    } catch {
      valid = false;
    }
    const message = await ctx.db.get(row.messageId);
    const questions = valid
      ? args.questions
          .slice(0, 80)
          .filter((q) => message?.currentText.includes(q.quote))
      : [];
    const emailAnswers = valid
      ? (args.emailAnswers ?? [])
          .slice(0, 40)
          .filter((answer) => message?.currentText.includes(answer.quote))
      : [];
    const reviewReasons = [...(args.reviewReasons ?? [])];
    if (args.questions.length > 80)
      reviewReasons.push(
        "Question limit reached; review the remaining email requests.",
      );
    let unappliedCount = valid ? args.questions.length - questions.length : 0;
    if (valid && row.automatic && request && message) {
      const route = await informationEmailRoute(ctx, row.messageId);
      if (
        !route ||
        route.audience !== row.audience ||
        route.outreach?._id !== row.outreachId
      )
        valid = false;
      else if (row.audience === "provider" && row.outreachId) {
        const proposalIds = new Map<
          string,
          Id<"procurementInformationQuestions">
        >();
        const keys = questions.map((q) => q.key).filter(Boolean);
        const duplicateKeys = new Set(
          keys.filter((key, index) => keys.indexOf(key) !== index),
        );
        for (const proposal of questions) {
          if (proposal.key && duplicateKeys.has(proposal.key)) {
            unappliedCount++;
            continue;
          }
          if (!proposal.confirmed) {
            unappliedCount++;
            continue;
          }
          if (
            !COVERAGE_OPTIONS.some((c) => c.id === proposal.coverage) ||
            ["unspecified", ""].includes(
              proposal.subject.trim().toLowerCase(),
            ) ||
            ["unspecified", ""].includes(proposal.period.trim().toLowerCase())
          ) {
            unappliedCount++;
            continue;
          }
          const conditions: { questionId: string; answer: string }[] = [];
          for (const condition of proposal.conditions ?? []) {
            const parentId =
              proposalIds.get(condition.questionId) ??
              ctx.db.normalizeId(
                "procurementInformationQuestions",
                condition.questionId,
              );
            const parent = parentId ? await ctx.db.get(parentId) : null;
            if (
              !parent ||
              parent.archivedAt ||
              parent.requestId !== row.requestId ||
              parent.question.kind !== "yes_no" ||
              !["Yes", "No"].includes(condition.answer)
            )
              break;
            conditions.push({
              questionId: String(parent._id),
              answer: condition.answer,
            });
          }
          if (conditions.length !== (proposal.conditions ?? []).length) {
            unappliedCount++;
            continue;
          }
          const existingId = proposal.existingQuestionId
            ? ctx.db.normalizeId(
                "procurementInformationQuestions",
                proposal.existingQuestionId,
              )
            : null;
          const existing = existingId ? await ctx.db.get(existingId) : null;
          const canReuse =
            existing &&
            !existing.archivedAt &&
            existing.requestId === row.requestId &&
            (existing.question.conditions ?? []).length === conditions.length &&
            conditions.every((condition) =>
              existing.question.conditions?.some(
                (c) =>
                  c.questionId === condition.questionId &&
                  c.answer === condition.answer,
              ),
            ) &&
            existing.question.kind === proposal.kind &&
            ["subject", "period", "coverage"].every(
              (key) =>
                normalizeIntakeQuestion(
                  existing.scope[key as "subject" | "period" | "coverage"],
                ) ===
                normalizeIntakeQuestion(
                  proposal[key as "subject" | "period" | "coverage"],
                ),
            ) &&
            (proposal.kind !== "currency" ||
              !proposal.currency ||
              (existing.scope.currency ??
                intakeCurrency(request.intakeDetails?.registrationCountry)) ===
                proposal.currency);
          if (proposal.existingQuestionId && !canReuse) {
            unappliedCount++;
            continue;
          }
          const questionDefinition = {
            id: "provider_question",
            conditions: conditions.length ? conditions : undefined,
            label: proposal.label,
            section: "additional" as const,
            kind: proposal.kind,
            options: proposal.options,
          };
          try {
            validateFollowupAnswers([{ ...questionDefinition, answer: "" }]);
          } catch {
            unappliedCount++;
            continue;
          }
          // Capacity is checked before any writes. Invalid or uncertain proposals remain reviewable.
          const facts = await requestFacts(ctx, row.requestId);
          const requirements = await bounded(
            ctx.db
              .query("procurementInformationRequirements")
              .withIndex("by_requestId", (q) =>
                q.eq("requestId", row.requestId),
              )
              .take(MAX + 1),
          );
          if (facts.length >= MAX || requirements.length >= MAX) {
            unappliedCount++;
            continue;
          }
          const requirementId = await addRequirementForRequest(
            ctx,
            {
              requestId: row.requestId,
              outreachId: row.outreachId,
              questionId: canReuse ? existing._id : undefined,
              question: questionDefinition,
              scope: {
                subject: proposal.subject,
                period: proposal.period,
                coverage: proposal.coverage,
                currency: proposal.currency ?? undefined,
              },
              sourceMessageId: row.messageId,
              sourceQuote: proposal.quote,
            },
            request,
            row.operatorUserId,
          );
          if (proposal.key) {
            const requirement = await ctx.db.get(requirementId);
            if (requirement)
              proposalIds.set(proposal.key, requirement.questionId);
          }
        }
      } else if (row.audience === "client") {
        const factsForOrder = await requestFacts(ctx, row.requestId);
        const orderedIds = orderInformationQuestions(
          factsForOrder.map((q) => ({
            questionId: q._id,
            question: q.question,
          })),
        ).map((q) => q.questionId);
        for (const proposed of [...emailAnswers].sort(
          (a, b) =>
            orderedIds.indexOf(a.questionId) - orderedIds.indexOf(b.questionId),
        )) {
          if (!proposed.confirmed) {
            unappliedCount++;
            continue;
          }
          const target = row.answerTargets?.find(
            (target) => target.questionId === proposed.questionId,
          );
          const q = await ctx.db.get(proposed.questionId);
          if (
            !target ||
            !q ||
            q.archivedAt ||
            q.requestId !== row.requestId ||
            q.answerId !== target.answerId
          )
            continue;
          const facts = await requestFacts(ctx, row.requestId);
          if (informationApplicability(q, facts) !== "applies") continue;
          try {
            validateFollowupAnswers([
              { ...q.question, answer: proposed.answer },
            ]);
          } catch {
            continue;
          }
          const normalizedQuote = proposed.quote.toLowerCase();
          const normalizedAnswer = proposed.answer.trim().toLowerCase();
          const grounded = ["number", "currency"].includes(q.question.kind)
            ? (proposed.quote.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).some(
                (token) =>
                  token.replaceAll(",", "") ===
                  proposed.answer.replaceAll(",", ""),
              )
            : q.question.kind === "yes_no"
              ? normalizedQuote.split(/[^a-z]+/).includes(normalizedAnswer)
              : normalizedQuote.includes(normalizedAnswer);
          if (
            !normalizedAnswer ||
            !grounded ||
            normalizedAnswer === "i'm not sure"
          )
            continue;
          if (
            q.question.kind === "date" &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(proposed.answer) ||
              !dayjs(proposed.answer).isValid() ||
              dayjs(proposed.answer).format("YYYY-MM-DD") !== proposed.answer)
          )
            continue;
          const answerId = await ctx.db.insert(
            "procurementInformationAnswers",
            {
              requestId: row.requestId,
              questionId: q._id,
              answer: proposed.answer,
              unsure: false,
              fileItemIds: [],
              suppliedByUserId:
                "clientUserId" in route ? route.clientUserId : undefined,
              sourceMessageId: row.messageId,
              sourceQuote: proposed.quote,
              provenance: `Client email from ${message.fromEmail} (cl-router extraction)`,
              createdAt: dayjs().valueOf(),
            },
          );
          await ctx.db.patch(q._id, { answerId });
          await cancelSupersededForms(ctx, row.requestId, q._id);
        }
      }
    }
    await ctx.db.patch(row._id, {
      status: valid ? "complete" : "failed",
      questions: valid ? questions : [],
      emailAnswers: valid ? emailAnswers : [],
      unappliedCount,
      reviewReasons,
      finishedAt: dayjs().valueOf(),
    });
  },
});
export const expireExtraction = internalMutation({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }) => {
    const row = await ctx.db.get(extractionId);
    if (row?.status === "running")
      await ctx.db.patch(row._id, {
        status: "failed",
        finishedAt: dayjs().valueOf(),
      });
  },
});
export const archiveQuestion = mutation({
  args: {
    questionId: v.id("procurementInformationQuestions"),
    archive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.questionId);
    if (!row) throw new Error("Question not found");
    const { operator, request } = await operatorWrite(ctx, row.requestId);
    if (
      args.archive &&
      (await requestFacts(ctx, row.requestId)).some((q) =>
        q.question.conditions?.some(
          (condition) => condition.questionId === row._id,
        ),
      )
    )
      throw new Error(
        "Remove dependent questions before removing their prerequisite",
      );
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", row.requestId))
        .take(MAX + 1),
    );
    if (
      args.archive &&
      forms.some(
        (f) =>
          f.status === "open" &&
          f.questions.some((q) => q.questionId === row._id),
      )
    )
      throw new Error(
        "Cancel the open client form before removing this question",
      );
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
async function informationEmailRoute(
  ctx: Ctx,
  messageId: Id<"teamEmailMessages">,
) {
  const message = await ctx.db.get(messageId);
  const thread = message ? await ctx.db.get(message.threadId) : null;
  if (
    !message ||
    message.direction !== "inbound" ||
    !message.currentText.trim() ||
    !thread?.requestId ||
    thread.deletedAt
  )
    return null;
  const request = await ctx.db.get(thread.requestId);
  if (
    !request ||
    request.deletedAt ||
    ["completed", "cancelled"].includes(request.status)
  )
    return null;
  const sender = normalizeProcurementEmail(message.fromEmail);
  const outreaches = await ctx.db
    .query("procurementBrokerOutreaches")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .take(MAX + 1);
  if (outreaches.length > MAX) return null;
  const providers = outreaches.filter(
    (o) =>
      o.contactEmail &&
      normalizeProcurementEmail(o.contactEmail) === sender &&
      (!thread.outreachId || thread.outreachId === o._id),
  );
  if (providers.length === 1)
    return {
      request,
      thread,
      message,
      audience: "provider" as const,
      outreach: providers[0],
    };
  if (
    thread.category !== "client" ||
    thread.outreachId ||
    message.forwarded ||
    !request.clientOrgId
  )
    return null;
  const recipient = (
    await clientRecipientOptions(ctx, request, request.clientOrgId)
  ).find((contact) => contact.email === sender);
  if (!recipient) return null;
  return {
    request,
    thread,
    message,
    audience: "client" as const,
    outreach: null,
    clientUserId: recipient.userId ?? undefined,
    responsibleUserId: outreaches[0]?.createdByUserId,
  };
}

export const queueEmail = internalMutation({
  args: { messageId: v.id("teamEmailMessages") },
  handler: async (ctx, { messageId }) => {
    const route = await informationEmailRoute(ctx, messageId);
    if (!route) return null;
    const existing = await ctx.db
      .query("procurementInformationExtractions")
      .withIndex("by_requestId_and_messageId", (q) =>
        q.eq("requestId", route.request._id).eq("messageId", messageId),
      )
      .unique();
    if (existing) return existing._id;
    const prior = await ctx.db
      .query("procurementInformationExtractions")
      .withIndex("by_requestId", (q) => q.eq("requestId", route.request._id))
      .take(MAX);
    if (prior.length >= MAX) return null;
    let actor: Id<"users"> | undefined;
    const candidates = [
      route.thread.ownerUserId,
      route.thread.linkedByUserId,
      route.outreach?.createdByUserId,
      "responsibleUserId" in route ? route.responsibleUserId : undefined,
      route.request.updatedByUserId,
      route.request.createdByUserId,
    ];
    for (const candidate of candidates)
      if (candidate) {
        try {
          await requireOperatorForUser(ctx, candidate);
          actor = candidate;
          break;
        } catch {
          /* Try another staff member already associated with this request. */
        }
      }
    if (!actor) return null;
    const facts =
      route.audience === "client"
        ? await requestFacts(ctx, route.request._id)
        : [];
    const targets = facts.filter(
      (q) =>
        (!q.answer || q.answer.unsure) &&
        informationApplicability(q, facts) !== "not_applicable",
    );
    if (route.audience === "client" && !targets.length) return null;
    const extractionId = await ctx.db.insert(
      "procurementInformationExtractions",
      {
        requestId: route.request._id,
        messageId,
        operatorUserId: actor,
        automatic: true,
        audience: route.audience,
        outreachId: route.outreach?._id,
        answerTargets: targets.map((q) => ({
          questionId: q._id,
          answerId: q.answerId,
        })),
        startedAt: dayjs().valueOf(),
        status: "running",
        questions: [],
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.procurementInformation.extractInternal,
      { extractionId },
    );
    await ctx.scheduler.runAfter(
      15 * 60 * 1000,
      internal.procurementInformation.expireExtraction,
      { extractionId },
    );
    return extractionId;
  },
});

/** Catch up the latest linked mail using the same deduplicated ingress as live mail. */
export const syncInbox = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await operatorWrite(ctx, requestId);
    const threads = await ctx.db
      .query("teamEmailThreads")
      .withIndex("by_requestId_and_latestMessageAt", (q) =>
        q.eq("requestId", requestId),
      )
      .order("desc")
      .take(50);
    const messages = (
      await Promise.all(
        threads
          .filter((t) => !t.deletedAt)
          .map((t) =>
            ctx.db
              .query("teamEmailMessages")
              .withIndex("by_threadId_and_receivedAt", (q) =>
                q.eq("threadId", t._id),
              )
              .order("desc")
              .take(10),
          ),
      )
    )
      .flat()
      .filter((m) => m.direction === "inbound")
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, 50);
    for (const message of messages)
      await ctx.scheduler.runAfter(
        0,
        internal.procurementInformation.queueEmail,
        { messageId: message._id },
      );
    return { checked: messages.length };
  },
});

async function cancelSupersededForms(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  questionId: Id<"procurementInformationQuestions">,
) {
  const forms = await bounded(
    ctx.db
      .query("procurementInformationForms")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .take(MAX + 1),
  );
  for (const form of forms)
    if (
      form.status === "open" &&
      (form.questions.some((q) => q.questionId === questionId) ||
        form.prerequisites?.some((q) => q.questionId === questionId))
    )
      await ctx.db.patch(form._id, {
        status: "cancelled",
        revision: form.revision + 1,
      });
}
