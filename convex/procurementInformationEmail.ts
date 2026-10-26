import {
  informationApplicability,
  orderInformationQuestions,
} from "../lib/procurement-information";
import { internal } from "./_generated/api";
import dayjs from "dayjs";
import { intakeCurrency } from "../lib/intake-money";
import { COVERAGE_OPTIONS } from "../lib/insurance-intake-details";
import { v } from "convex/values";
import { clientRecipientOptions } from "./lib/clientOutreach";
import { normalizeProcurementEmail } from "./lib/procurement";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { requireRequest } from "./procurementRequests";
import {
  informationExtractionQuestionValidator,
  informationEmailAnswerValidator,
} from "./lib/procurementInformationSchema";
import { validateFollowupAnswers } from "../lib/intake-followups";
import { normalizeIntakeQuestion } from "../lib/intake-question-reference";
import {
  MAX,
  bounded,
  operatorWrite,
  requestFacts,
  sourceMessage,
  cancelSupersededForms,
} from "./lib/procurementInformationAccess";
import type { Ctx } from "./lib/procurementInformationAccess";
import { addRequirementForRequest } from "./lib/procurementInformationRequirements";

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
      processingStartedAt: 0,
      questions: [],
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.procurementInformation.extractInternal,
      { extractionId: id },
    );
    await ctx.scheduler.runAfter(
      15 * 60 * 1000,
      internal.procurementInformationEmail.expireExtraction,
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
async function nextExtraction(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  return await ctx.db
    .query("procurementInformationExtractions")
    .withIndex("by_requestId_and_status", (q) =>
      q.eq("requestId", requestId).eq("status", "running"),
    )
    .first();
}

async function wakeNextExtraction(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
) {
  const next = await nextExtraction(ctx, requestId);
  if (next?.processingStartedAt === 0)
    await ctx.scheduler.runAfter(
      0,
      internal.actions.procurementInformation.extractInternal,
      { extractionId: next._id },
    );
}

/** Read the latest facts only after earlier mail on this request has finished. */
export const claimExtraction = internalMutation({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }) => {
    const row = await ctx.db.get(extractionId);
    if (!row || row.status !== "running" || row.processingStartedAt !== 0)
      return false;
    if ((await nextExtraction(ctx, row.requestId))?._id !== row._id)
      return false;
    await ctx.db.patch(row._id, { processingStartedAt: dayjs().valueOf() });
    await ctx.scheduler.runAfter(
      15 * 60 * 1000,
      internal.procurementInformationEmail.expireExtraction,
      { extractionId },
    );
    return true;
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
    await wakeNextExtraction(ctx, row.requestId);
  },
});
export const expireExtraction = internalMutation({
  args: { extractionId: v.id("procurementInformationExtractions") },
  handler: async (ctx, { extractionId }) => {
    const row = await ctx.db.get(extractionId);
    if (row?.status === "running") {
      if (row.processingStartedAt === 0) {
        await wakeNextExtraction(ctx, row.requestId);
        return;
      }
      const remaining =
        (row.processingStartedAt ?? row.startedAt) +
        15 * 60 * 1000 -
        dayjs().valueOf();
      if (remaining > 0) {
        await ctx.scheduler.runAfter(
          remaining,
          internal.procurementInformationEmail.expireExtraction,
          { extractionId },
        );
        return;
      }
      await ctx.db.patch(row._id, {
        status: "failed",
        finishedAt: dayjs().valueOf(),
      });
      await wakeNextExtraction(ctx, row.requestId);
    }
  },
});

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
        processingStartedAt: 0,
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
      internal.procurementInformationEmail.expireExtraction,
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
        internal.procurementInformationEmail.queueEmail,
        { messageId: message._id },
      );
    return { checked: messages.length };
  },
});
