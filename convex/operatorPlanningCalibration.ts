import { v } from "convex/values";
import dayjs from "dayjs";
import type { Doc } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import {
  EXPAND_TOOLS_NAME,
  expandOperatorToolsSpec,
  normalizeOperatorToolFamilies,
  OPERATOR_TOOL_FAMILY_CATALOG,
  operatorToolFamiliesOf,
  type OperatorToolFamily,
} from "./lib/operatorAgentToolRegistry";
import { operatorPlanningLevel } from "./lib/operatorRunPlan";

const MAX_RUNS = 200;
const ALL_FAMILIES = Object.keys(
  OPERATOR_TOOL_FAMILY_CATALOG,
) as OperatorToolFamily[];
const parseExpandInput = expandOperatorToolsSpec(ALL_FAMILIES).inputSchema;

function parseJson(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replays a turn's calls in order to show which expand_tools requests asked
 * for families already loaded. The starting set is the selecting_tools stage
 * outcome (null when the turn had none, e.g. a starter intent or resume);
 * newer results state `alreadyLoaded` directly, older ones are inferred.
 */
function expandToolsUsage(message: Doc<"operatorAgentMessages"> | null) {
  const stage = message?.activity?.stages?.find(
    (entry) => entry.stage === "selecting_tools" && entry.status !== "running",
  );
  const initialFamilies = !stage?.detail
    ? null
    : stage.status === "failed"
      ? ALL_FAMILIES
      : normalizeOperatorToolFamilies(
          stage.detail.split(", ").map((label) => label.replaceAll(" ", "_")),
        );
  const loaded = new Set<OperatorToolFamily>(initialFamilies ?? []);
  const requests: {
    requested: OperatorToolFamily[];
    alreadyLoaded: OperatorToolFamily[];
    newlyLoaded: OperatorToolFamily[];
  }[] = [];
  for (const call of message?.toolCalls ?? []) {
    if (call.name !== EXPAND_TOOLS_NAME) {
      const families = operatorToolFamiliesOf([call.name]);
      if (!families.some((family) => loaded.has(family)) && families[0])
        loaded.add(families[0]);
      continue;
    }
    const parsed = parseExpandInput.safeParse(parseJson(call.input));
    const requested = parsed.success ? parsed.data.families : [];
    const output = parseJson(call.output) as
      | { alreadyLoaded?: unknown[] }
      | undefined;
    const alreadyLoaded = Array.isArray(output?.alreadyLoaded)
      ? normalizeOperatorToolFamilies(output.alreadyLoaded)
      : requested.filter((family) => loaded.has(family));
    const newlyLoaded = requested.filter(
      (family) => !alreadyLoaded.includes(family),
    );
    for (const family of newlyLoaded) loaded.add(family);
    requests.push({ requested, alreadyLoaded, newlyLoaded });
  }
  return {
    calls: requests.length,
    callsWithNothingNew: requests.filter(
      (request) => request.newlyLoaded.length === 0,
    ).length,
    initialFamilies,
    requests,
  };
}

/**
 * Read-only calibration view: recent operator runs with their stored planning
 * assessment, tool families, expand_tools usage and page-context prefetch
 * beside the outcome, for
 * checking planning and family-loading thresholds against history. Failed tool calls approximate recovery attempts; exact recovery
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
        // Iteration 0 segments (retries and resumes add rows); null when the
        // run predates timing rows.
        const firstStepTimings = await ctx.db
          .query("operatorRunTimings")
          .withIndex("by_runId_and_iteration", (q) =>
            q.eq("runId", run._id).eq("iteration", 0),
          )
          .take(20);
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
          finalFamilies: run.checkpoint?.families ?? [],
          expandTools: {
            ...expandToolsUsage(message),
            withheldOnFirstStep: firstStepTimings.length
              ? firstStepTimings.some((row) => row.expandToolsWithheld === true)
              : null,
          },
          // Whether the attached page's record was prefetched before the
          // first step, and each declared read's outcome or skip reason;
          // null when no page entry applied or the run predates it.
          pageContextPrefetch:
            firstStepTimings.find((row) => row.pageContextPrefetch)
              ?.pageContextPrefetch ?? null,
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
