import dayjs from "dayjs";
import { v } from "convex/values";
import { informationApplicability } from "../lib/procurement-information";
import type { Id } from "./_generated/dataModel";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import { NoWriteInputError } from "./lib/noWriteInputError";
import {
  requireDirectOperatorWrite,
  requireRequest,
} from "./procurementRequests";
import { recordInformationAnswerByOperator } from "./procurementInformation";
import {
  MAX,
  audit,
  bounded,
  operatorWrite,
  requestFacts,
  requireInformationQuestion,
} from "./lib/procurementInformationAccess";
import {
  currentPendingSuggestions,
  enqueueInformationResearch,
  latestResearchRuns,
  pendingSuggestionsByQuestion,
  queueAutomaticInformationResearch,
  researchEntity,
  researchFingerprint,
  researchRunStatus,
  researchableInformationQuestions,
} from "./lib/procurementInformationResearch";

/**
 * Cited public-research suggestions for unresolved procurement information.
 * Operators accept or dismiss them here; clients confirm them only by
 * submitting their information form (procurementInformationForms.saveForm).
 */

const confidenceValidator = v.union(v.literal("high"), v.literal("medium"));
const citationValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  excerpt: v.optional(v.string()),
});

export const listForRequest = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await requireOperator(ctx);
    const request = await requireRequest(ctx, requestId);
    if (request.deletedAt) throw new Error("Request not found");
    const [questions, runs] = await Promise.all([
      bounded(
        ctx.db
          .query("procurementInformationQuestions")
          .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
          .take(MAX + 1),
      ),
      latestResearchRuns(ctx, requestId),
    ]);
    const suggestions = await pendingSuggestionsByQuestion(
      ctx,
      requestId,
      questions,
    );
    return {
      suggestions: [...suggestions.values()].map((suggestion) => ({
        suggestionId: suggestion._id,
        questionId: suggestion.questionId,
        label: questions.find((q) => q._id === suggestion.questionId)!.question
          .label,
        answer: suggestion.answer,
        confidence: suggestion.confidence,
        citations: suggestion.citations,
        provider: suggestion.provider,
        createdAt: suggestion.createdAt,
      })),
      research: runs[0] ? researchRunStatus(runs[0]) : null,
    };
  },
});

/** Accept writes the suggestion through the operator answer path; dismiss leaves the question open. */
export async function reviewInformationSuggestion(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  args: {
    suggestionId: Id<"procurementInformationSuggestions">;
    action: "accept" | "dismiss";
    previousAnswerId?: Id<"procurementInformationAnswers">;
  },
) {
  const suggestion = await ctx.db.get(args.suggestionId);
  if (!suggestion) throw new Error("Suggestion not found");
  const request = await requireRequest(ctx, suggestion.requestId);
  if (request.deletedAt) throw new Error("Request not found");
  if (suggestion.status !== "pending")
    throw new Error(`This suggestion was already ${suggestion.status}`);
  const question = await requireInformationQuestion(
    ctx,
    suggestion.questionId,
    suggestion.requestId,
  );
  if (question.answerId !== suggestion.answerIdAtSuggestion)
    throw new Error(
      "This question was answered after the research. Reload to see the current answer",
    );
  const resolvedAt = dayjs().valueOf();
  if (args.action === "dismiss") {
    await ctx.db.patch(suggestion._id, {
      status: "dismissed",
      resolution: "dismissed",
      resolvedAt,
      resolvedByUserId: operatorUserId,
    });
    await audit(ctx, operatorUserId, request, "Dismissed research suggestion");
    return {
      suggestionId: suggestion._id,
      questionId: question._id,
      status: "dismissed" as const,
    };
  }
  await ctx.db.patch(suggestion._id, {
    status: "accepted",
    resolution: "operator_accepted",
    resolvedAt,
    resolvedByUserId: operatorUserId,
  });
  const answerId = await recordInformationAnswerByOperator(
    ctx,
    operatorUserId,
    request,
    question,
    {
      previousAnswerId:
        args.previousAnswerId ?? suggestion.answerIdAtSuggestion,
      answer: suggestion.answer,
      provenance:
        `Public web research (${suggestion.provider}), accepted by operator: ${suggestion.citations[0].url}`.slice(
          0,
          1000,
        ),
      fileItemIds: [],
    },
  );
  return {
    suggestionId: suggestion._id,
    questionId: question._id,
    status: "accepted" as const,
    answerId,
  };
}

async function suggestionOperator(
  ctx: MutationCtx,
  suggestionId: Id<"procurementInformationSuggestions">,
) {
  const suggestion = await ctx.db.get(suggestionId);
  if (!suggestion) throw new Error("Suggestion not found");
  return (await operatorWrite(ctx, suggestion.requestId)).operator.user._id;
}

export const accept = mutation({
  args: {
    suggestionId: v.id("procurementInformationSuggestions"),
    previousAnswerId: v.optional(v.id("procurementInformationAnswers")),
  },
  handler: async (ctx, args) =>
    reviewInformationSuggestion(
      ctx,
      await suggestionOperator(ctx, args.suggestionId),
      { ...args, action: "accept" },
    ),
});

export const dismiss = mutation({
  args: { suggestionId: v.id("procurementInformationSuggestions") },
  handler: async (ctx, args) =>
    reviewInformationSuggestion(
      ctx,
      await suggestionOperator(ctx, args.suggestionId),
      { ...args, action: "dismiss" },
    ),
});

/** Operator agent batch review: every item applies or none does. */
export async function reviewInformationSuggestionsByOperator(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  items: {
    suggestionId: Id<"procurementInformationSuggestions">;
    action: "accept" | "dismiss";
  }[],
) {
  await requireDirectOperatorWrite(ctx, operatorUserId);
  if (new Set(items.map((item) => item.suggestionId)).size !== items.length)
    throw new Error("Review each suggestion once");
  const results = [];
  // The mutation rolls back as a whole, so a rejected item saves nothing.
  for (const [index, item] of items.entries())
    results.push(
      await reviewInformationSuggestion(ctx, operatorUserId, item).catch(
        (error: unknown) => {
          throw new NoWriteInputError(
            "invalid_suggestion",
            `Item ${index + 1} (${item.suggestionId}) was rejected: ${error instanceof Error ? error.message : String(error)}. Nothing was saved.`,
          );
        },
      ),
    );
  return { results };
}

/** Exact approval text: each question, the suggested answer and its source. */
export async function informationSuggestionReviewSummary(
  ctx: QueryCtx,
  items: { suggestionId: string; action: "accept" | "dismiss" }[],
) {
  const lines = [
    `Review ${items.length} public-research suggestion${items.length === 1 ? "" : "s"}`,
  ];
  for (const item of items) {
    const id = ctx.db.normalizeId(
      "procurementInformationSuggestions",
      item.suggestionId,
    );
    const suggestion = id ? await ctx.db.get(id) : null;
    const question = suggestion
      ? await ctx.db.get(suggestion.questionId)
      : null;
    if (!suggestion || !question) throw new Error("Suggestion not found");
    lines.push(
      item.action === "accept"
        ? `- Accept ${JSON.stringify(question.question.label)}: ${JSON.stringify(suggestion.answer)} (source: ${suggestion.citations[0].url})`
        : `- Dismiss ${JSON.stringify(question.question.label)} (suggested ${JSON.stringify(suggestion.answer)})`,
    );
  }
  const summary = lines.join("\n");
  if (summary.length > 20_000)
    throw new Error(
      "The full review exceeds 20,000 characters; split it into smaller batches",
    );
  return summary;
}

/** Operator agent trigger; returns the queued, active or identical earlier run. */
export async function researchInformationByOperator(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  requestId: Id<"procurementRequests">,
) {
  await requireDirectOperatorWrite(ctx, operatorUserId);
  const request = await requireRequest(ctx, requestId);
  if (request.deletedAt) throw new Error("Request not found");
  const { run, reused } = await enqueueInformationResearch(ctx, request, false);
  if (!run)
    return {
      status: "not_needed" as const,
      note: "No unresolved question can be researched: each is answered, not applicable, long-form, already has a suggestion, or the client has no company name.",
    };
  return { ...researchRunStatus(run), reused };
}

/** Acceptance and correction rates for measuring research quality. */
export const stats = internalQuery({
  args: { sinceMs: v.number() },
  handler: async (ctx, { sinceMs }) => {
    const rows = await ctx.db
      .query("procurementInformationSuggestions")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", sinceMs))
      .take(5001);
    const count = (values: (string | undefined)[]) => {
      const counts: Record<string, number> = {};
      for (const value of values)
        counts[value ?? "unresolved"] =
          (counts[value ?? "unresolved"] ?? 0) + 1;
      return counts;
    };
    const sample = rows.slice(0, 5000);
    return {
      total: sample.length,
      limited: rows.length > 5000,
      byStatus: count(sample.map((row) => row.status)),
      byResolution: count(sample.map((row) => row.resolution)),
      byConfidence: Object.fromEntries(
        (["high", "medium"] as const).map((confidence) => [
          confidence,
          count(
            sample
              .filter((row) => row.confidence === confidence)
              .map((row) => row.resolution),
          ),
        ]),
      ),
    };
  },
});

/** Recompute eligibility when the debounced run starts, so later questions join it. */
export const claimRun = internalMutation({
  args: { runId: v.id("procurementInformationResearchRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return null;
    try {
      const request = await ctx.db.get(run.requestId);
      const entity =
        request && !request.deletedAt
          ? await researchEntity(ctx, request)
          : null;
      const questions = entity
        ? await researchableInformationQuestions(
            ctx,
            run.requestId,
            run.automatic,
          )
        : [];
      if (!request || !entity || !questions.length) {
        await ctx.db.patch(run._id, {
          status: "completed",
          questions: [],
          questionCount: 0,
          completedAt: dayjs().valueOf(),
        });
        return null;
      }
      await ctx.db.patch(run._id, {
        status: "running",
        fingerprint: await researchFingerprint(entity, questions),
        questions: questions.map((q) => ({
          questionId: q._id,
          answerId: q.answerId,
        })),
        questionCount: questions.length,
      });
      return {
        requestId: run.requestId,
        orgId: request.clientOrgId,
        entity,
        questions: questions.map((q) => ({
          questionId: q._id,
          question: q.question,
          scope: q.scope,
          fromProvider: q.fromProvider,
        })),
      };
    } catch (error) {
      // A run that cannot start must end rather than block the request's research.
      console.warn("[procurementInformationResearch] claim failed", {
        runId,
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Unknown claim failure",
      });
      await ctx.db.patch(run._id, {
        status: "failed",
        error: "claim_failed",
        completedAt: dayjs().valueOf(),
      });
      return null;
    }
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("procurementInformationResearchRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    provider: v.optional(v.string()),
    researchedQuestionIds: v.array(v.id("procurementInformationQuestions")),
    suggestions: v.array(
      v.object({
        questionId: v.id("procurementInformationQuestions"),
        answer: v.string(),
        confidence: confidenceValidator,
        citations: v.array(citationValidator),
        provider: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return;
    // Automatic research is skipped, not failed, when the router cannot research.
    if (args.error === "research_unavailable" && run.automatic) {
      await ctx.db.delete(run._id);
      return;
    }
    const facts = await requestFacts(ctx, run.requestId);
    let inserted = 0;
    for (const suggestion of args.suggestions) {
      const claimed = run.questions.find(
        (q) => q.questionId === suggestion.questionId,
      );
      const question = facts.find((q) => q._id === suggestion.questionId);
      // The question must be unchanged since research started.
      if (
        !claimed ||
        !question ||
        question.answerId !== claimed.answerId ||
        informationApplicability(question, facts) !== "applies" ||
        (await currentPendingSuggestions(ctx, question)).length ||
        !suggestion.citations.length
      )
        continue;
      await ctx.db.insert("procurementInformationSuggestions", {
        ...suggestion,
        requestId: run.requestId,
        answerIdAtSuggestion: claimed.answerId,
        citations: suggestion.citations.slice(0, 5),
        researchRunId: run._id,
        status: "pending",
        createdAt: dayjs().valueOf(),
      });
      inserted++;
    }
    const researched = new Set<string>(args.researchedQuestionIds);
    const assessed = run.questions.filter((q) => researched.has(q.questionId));
    const now = dayjs().valueOf();
    await ctx.db.patch(run._id, {
      status: args.status,
      error: args.error?.slice(0, 100),
      provider: args.provider,
      suggestionCount: inserted,
      questions: assessed,
      completedAt: now,
    });
    // Automatic runs skip these revisions for good, beyond any run history window.
    for (const q of assessed)
      if (facts.some((fact) => fact._id === q.questionId))
        await ctx.db.patch(q.questionId, {
          researchAssessedAnswerId: q.answerId,
          researchAssessedAt: now,
        });
    // Questions added while this run was active, or beyond its cap, get their own run.
    if (args.status !== "failed")
      await queueAutomaticInformationResearch(ctx, run.requestId);
  },
});

/** A run that never started or whose action was lost stops counting as active. */
export const expireRun = internalMutation({
  args: { runId: v.id("procurementInformationResearchRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run?.status === "queued" || run?.status === "running")
      await ctx.db.patch(run._id, {
        status: "failed",
        error: "timed_out",
        completedAt: dayjs().valueOf(),
      });
  },
});
