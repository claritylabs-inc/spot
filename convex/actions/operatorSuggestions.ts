"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { decideComposite } from "../lib/jevComposite";
import {
  operatorSuggestionPageContextValidator,
  operatorSuggestionRankingRequest,
  operatorSuggestionScores,
} from "../lib/operatorSuggestionRanking";

/** Ranks live operator suggestions with one Jev composite call and caches the scores. */
export const rank = internalAction({
  args: {
    operatorUserId: v.id("users"),
    pageContext: v.optional(operatorSuggestionPageContextValidator),
  },
  handler: async (ctx, args): Promise<null> => {
    const input = await ctx.runQuery(
      internal.operatorSuggestions.rankingInputInternal,
      args,
    );
    const { contextKey, candidates } = input;
    const release = () =>
      ctx.runMutation(internal.operatorSuggestions.releaseRefreshInternal, {
        operatorUserId: args.operatorUserId,
        contextKey,
      });
    if (candidates.length < 2) {
      await release();
      return null;
    }
    const { state, groups } = operatorSuggestionRankingRequest({
      candidates,
      pageContext: args.pageContext,
      recentThreads: input.recentThreads,
      now: input.now,
    });
    let scores;
    try {
      const results = await decideComposite(ctx, {
        task: "operator_suggestion_ranking",
        trace: {
          traceId: `operator-suggestions:${args.operatorUserId}:${contextKey}:${input.now}`,
          channel: "web",
        },
        state,
        groups,
        executionBudgetMs: 20_000,
      });
      scores = operatorSuggestionScores(candidates, groups, results);
    } catch (error) {
      console.warn("Operator suggestion ranking failed", error);
      await release();
      return null;
    }
    await ctx.runMutation(internal.operatorSuggestions.saveRankingInternal, {
      operatorUserId: args.operatorUserId,
      contextKey,
      candidateKeys: candidates.map(({ key }) => key),
      scores,
    });
    return null;
  },
});
