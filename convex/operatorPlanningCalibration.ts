import { v } from "convex/values";
import dayjs from "dayjs";
import { internalQuery } from "./_generated/server";
import { operatorPlanningLevel } from "./lib/operatorRunPlan";

const MAX_RUNS = 200;

/**
 * Read-only calibration view: recent operator runs with their stored planning
 * assessment beside the outcome, for checking level thresholds against
 * history. Failed tool calls approximate recovery attempts; exact recovery
 * state lives in the run's continuation blob.
 */
export const listRecentRunsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), MAX_RUNS);
    const runs = await ctx.db
      .query("operatorAgentRuns")
      .order("desc")
      .take(limit);
    return await Promise.all(
      runs.map(async (run) => {
        const message = await ctx.db.get(run.agentMessageId);
        const tools = message?.activity?.tools ?? [];
        const assessment = run.planningAssessment;
        return {
          runId: run._id,
          createdAt: dayjs(run.createdAt).toISOString(),
          objective: run.objective.slice(0, 160),
          executionKind: run.executionKind ?? "goal",
          assessment: assessment
            ? {
                level: operatorPlanningLevel(assessment),
                legacy: assessment.level === undefined,
                source: assessment.source,
                probabilities: assessment.probabilities,
                targetCount: assessment.targetCount ?? null,
                requestId: assessment.requestId ?? null,
                plannerFallback: assessment.plannerFallback ?? false,
              }
            : null,
          planSteps: run.executionPlan?.steps.length ?? 0,
          outcome: {
            status: run.status,
            iterations: run.checkpoint?.iteration ?? 0,
            toolCalls: tools.length,
            failedToolCalls: tools.filter((tool) => tool.status === "failed")
              .length,
            durationMs:
              run.startedAt && run.completedAt
                ? run.completedAt - run.startedAt
                : null,
            error: run.lastError?.slice(0, 200) ?? null,
          },
        };
      }),
    );
  },
});
