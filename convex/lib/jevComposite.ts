import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";

const MAX_QUESTIONS_PER_REQUEST = 128;

type NoulInstructions = { question: string; note?: string; inspect?: string[] };
type DecideTrace = NonNullable<Parameters<typeof clRouterDecide>[0]["trace"]>;

export type CompositeSignal = {
  instructions: NoulInstructions;
  /** Relative weight for weighted_mean; default 1. */
  weight?: number;
  /** Count 1 − P(yes), for signals that argue against the outcome. */
  negate?: boolean;
};

export type CompositeGroup = {
  signals: Record<string, CompositeSignal>;
  aggregate?: "weighted_mean" | "all" | "any" | "min" | "max";
  thresholds: { low: number; high: number };
};

export type CompositeResult = {
  composite: number;
  verdict: "low" | "uncertain" | "high";
  probabilities: Record<string, number>;
};

function aggregate(
  group: CompositeGroup,
  values: Array<{ p: number; weight: number }>,
) {
  switch (group.aggregate ?? "weighted_mean") {
    case "all":
      return values.reduce((product, { p }) => product * p, 1);
    case "any":
      return 1 - values.reduce((product, { p }) => product * (1 - p), 1);
    case "min":
      return Math.min(...values.map(({ p }) => p));
    case "max":
      return Math.max(...values.map(({ p }) => p));
    case "weighted_mean": {
      const total = values.reduce((sum, { weight }) => sum + weight, 0);
      return values.reduce((sum, { p, weight }) => sum + p * weight, 0) / total;
    }
  }
}

/**
 * TypeSafe composite scoring over /v1/decide: many atomic Noul signals per group, answered in
 * parallel against shared state, then combined in code with explicit weights and verdict bands.
 * Several groups share one batch; a group with any unanswered signal is "uncertain".
 */
export async function decideComposite<K extends string>(
  ctx: Pick<ActionCtx, "runMutation">,
  request: {
    task: string;
    trace: DecideTrace;
    orgId?: string;
    state: Parameters<typeof clRouterDecide>[0]["state"];
    groups: Record<K, CompositeGroup>;
    executionBudgetMs?: number;
  },
): Promise<Record<K, CompositeResult>> {
  const entries = (
    Object.entries(request.groups) as Array<[K, CompositeGroup]>
  ).flatMap(([groupKey, group]) =>
    Object.entries(group.signals).map(([signalKey, signal]) => ({
      id: `${groupKey}__${signalKey}`,
      groupKey,
      signalKey,
      signal,
    })),
  );
  const chunks: (typeof entries)[] = [];
  for (
    let index = 0;
    index < entries.length;
    index += MAX_QUESTIONS_PER_REQUEST
  )
    chunks.push(entries.slice(index, index + MAX_QUESTIONS_PER_REQUEST));
  const answers = Object.assign(
    {},
    ...(await Promise.all(
      chunks.map(
        async (chunk) =>
          (
            await clRouterDecide(
              {
                task: request.task,
                trace: request.trace,
                ...(request.orgId ? { orgId: request.orgId } : {}),
                state: request.state,
                questions: Object.fromEntries(
                  chunk.map(({ id, signal }) => [
                    id,
                    {
                      type: "noul" as const,
                      instructions: signal.instructions,
                    },
                  ]),
                ),
                executionBudgetMs: request.executionBudgetMs ?? 60_000,
              },
              { telemetry: ctx },
            )
          ).answers,
      ),
    )),
  ) as Awaited<ReturnType<typeof clRouterDecide>>["answers"];
  return Object.fromEntries(
    (Object.entries(request.groups) as Array<[K, CompositeGroup]>).map(
      ([groupKey, group]) => {
        const probabilities: Record<string, number> = {};
        const values = entries
          .filter((entry) => entry.groupKey === groupKey)
          .flatMap(({ id, signalKey, signal }) => {
            const answer = answers[id];
            if (answer?.type !== "noul") return [];
            probabilities[signalKey] = answer.noul;
            return [
              {
                p: signal.negate ? 1 - answer.noul : answer.noul,
                weight: signal.weight ?? 1,
              },
            ];
          });
        const complete =
          values.length === Object.keys(group.signals).length &&
          values.length > 0;
        const composite = complete ? aggregate(group, values) : 0;
        const verdict = !complete
          ? "uncertain"
          : composite >= group.thresholds.high
            ? "high"
            : composite <= group.thresholds.low
              ? "low"
              : "uncertain";
        return [groupKey, { composite, verdict, probabilities }];
      },
    ),
  ) as Record<K, CompositeResult>;
}
