import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import {
  isOperatorSuggestionRankingStale,
  isOperatorSuggestionRefreshPending,
  listRecentOperatorThreadTitles,
  loadOperatorSuggestionRanking,
  loadOperatorSuggestionState,
  operatorSuggestionPageContextValidator,
  orderOperatorSuggestions,
} from "./lib/operatorSuggestionRanking";
import type { OperatorSuggestionList } from "./lib/operatorSuggestionTypes";
import { normalizeOperatorPageContext } from "./operatorAgent";

export const list = query({
  args: { pageContext: v.optional(operatorSuggestionPageContextValidator) },
  handler: async (ctx, args): Promise<OperatorSuggestionList> => {
    const operator = await requireOperator(ctx);
    const pageContext = normalizeOperatorPageContext(args.pageContext);
    const now = dayjs().valueOf();
    const { candidates, ranking } = await loadOperatorSuggestionState(ctx, {
      operatorUserId: operator.userId,
      pageContext,
      now,
    });
    return {
      suggestions: orderOperatorSuggestions({ candidates, ranking, pageContext }),
      stale: isOperatorSuggestionRankingStale(ranking, candidates, now),
    };
  },
});

/** Schedules one ranking per operator and page while the cached one is stale. */
export const refresh = mutation({
  args: { pageContext: v.optional(operatorSuggestionPageContextValidator) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const pageContext = normalizeOperatorPageContext(args.pageContext);
    const now = dayjs().valueOf();
    const { contextKey, candidates, ranking } =
      await loadOperatorSuggestionState(ctx, {
        operatorUserId: operator.userId,
        pageContext,
        now,
      });
    if (
      !isOperatorSuggestionRankingStale(ranking, candidates, now) ||
      isOperatorSuggestionRefreshPending(ranking, now)
    )
      return null;
    if (ranking) {
      await ctx.db.patch(ranking._id, { refreshRequestedAt: now });
    } else {
      await ctx.db.insert("operatorSuggestionRankings", {
        operatorUserId: operator.userId,
        contextKey,
        scores: [],
        refreshRequestedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.actions.operatorSuggestions.rank, {
      operatorUserId: operator.userId,
      ...(pageContext ? { pageContext } : {}),
    });
    return null;
  },
});

export const rankingInputInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    pageContext: v.optional(operatorSuggestionPageContextValidator),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const [{ contextKey, candidates }, recentThreads] = await Promise.all([
      loadOperatorSuggestionState(ctx, { ...args, now }),
      listRecentOperatorThreadTitles(ctx, args.operatorUserId),
    ]);
    return { contextKey, candidates, recentThreads, now };
  },
});

export const saveRankingInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    contextKey: v.string(),
    candidateKeys: v.array(v.string()),
    scores: v.array(v.object({ key: v.string(), score: v.number() })),
  },
  handler: async (ctx, args) => {
    const ranking = {
      scores: args.scores,
      candidateKeys: args.candidateKeys,
      rankedAt: dayjs().valueOf(),
      refreshRequestedAt: undefined,
    };
    const existing = await loadOperatorSuggestionRanking(
      ctx,
      args.operatorUserId,
      args.contextKey,
    );
    if (existing) {
      await ctx.db.patch(existing._id, ranking);
    } else {
      await ctx.db.insert("operatorSuggestionRankings", {
        operatorUserId: args.operatorUserId,
        contextKey: args.contextKey,
        ...ranking,
      });
    }
    return null;
  },
});

/** Keeps the previous scores; ordering falls back to urgency for new keys. */
export const releaseRefreshInternal = internalMutation({
  args: { operatorUserId: v.id("users"), contextKey: v.string() },
  handler: async (ctx, args) => {
    const existing = await loadOperatorSuggestionRanking(
      ctx,
      args.operatorUserId,
      args.contextKey,
    );
    if (existing?.refreshRequestedAt)
      await ctx.db.patch(existing._id, { refreshRequestedAt: undefined });
    return null;
  },
});
