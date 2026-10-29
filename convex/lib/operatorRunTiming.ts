import dayjs from "dayjs";
import { v, type Infer } from "convex/values";

import type { AgentModelCallTiming } from "./models";

// Per-step timing for operator runs: metadata only (phase names, durations,
// counts, byte sizes, tool names, router ids), never prompts, inputs or
// outputs. One record per runner segment rides the existing checkpoint,
// continue, wait, retry or fail mutation; get_operator_run summarizes them.

const MAX_TOOLS = 64;
const MAX_MODEL_CALLS = 8;
// Detailed segments returned by get_operator_run; the summary covers all.
const MAX_VIEW_SEGMENTS = 50;
export const OPERATOR_RUN_TIMING_RETENTION_DAYS = 14;

const phaseValidator = v.object({
  phase: v.string(),
  ms: v.number(),
  count: v.optional(v.number()),
  bytes: v.optional(v.number()),
});

const toolTimingValidator = v.object({
  toolName: v.string(),
  toolCallId: v.optional(v.string()),
  // A starter intent's read executed in code before the first model step.
  prefetch: v.optional(v.boolean()),
  // Called while an earlier call of the same step still held `toolQueue`.
  serial: v.boolean(),
  queuedMs: v.number(),
  startedAt: v.number(),
  endedAt: v.number(),
  executeMs: v.number(),
  bookkeepingMs: v.optional(v.number()),
  status: v.string(),
});

const modelCallTimingValidator = v.object({
  kind: v.union(v.literal("planner"), v.literal("step")),
  invocationKey: v.optional(v.string()),
  routerJobId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  startedAt: v.number(),
  wallMs: v.number(),
  submitMs: v.number(),
  waitMs: v.number(),
  polls: v.number(),
  readMs: v.number(),
  // Where the succeeded result was read from: the job row or storage.
  result: v.optional(v.union(v.literal("inline"), v.literal("storage"))),
  telemetryMs: v.number(),
  sdkMs: v.number(),
  outcome: v.union(
    v.literal("succeeded"),
    v.literal("pending"),
    v.literal("failed"),
  ),
});

export const operatorRunTimingValidator = v.object({
  iteration: v.number(),
  runnerAttempt: v.number(),
  routerRetryCount: v.optional(v.number()),
  startedAt: v.number(),
  endedAt: v.number(),
  wallMs: v.number(),
  unattributedMs: v.number(),
  phases: v.array(phaseValidator),
  tools: v.array(toolTimingValidator),
  modelCalls: v.array(modelCallTimingValidator),
  // The mutation that ended the previous segment in this action; its own
  // duration is only known once it returns.
  previousCheckpointMs: v.optional(v.number()),
});

export const operatorRunTimingEndValidator = v.union(
  v.literal("continue"),
  v.literal("complete"),
  v.literal("wait_router"),
  v.literal("retry_router"),
  v.literal("fail"),
);

export type OperatorRunTiming = Infer<typeof operatorRunTimingValidator>;
export type OperatorToolTiming = Infer<typeof toolTimingValidator>;
type ModelCallTiming = Infer<typeof modelCallTimingValidator>;

/**
 * Accumulates one runner segment. Phases record self time: a phase timed
 * inside another is subtracted from the outer one, so phases plus
 * `unattributedMs` add up to the segment's wall time. Concurrent work must
 * be timed as one enclosing phase.
 */
export class OperatorStepTimer {
  readonly startedAt = dayjs().valueOf();
  runnerAttempt = 0;
  iteration = 0;
  routerRetryCount = 0;
  readonly tools: OperatorToolTiming[] = [];
  private readonly modelCalls: ModelCallTiming[] = [];
  private readonly phases = new Map<
    string,
    { ms: number; count: number; bytes?: number }
  >();
  private attributedMs = 0;
  private taken = false;

  constructor(readonly previousCheckpointMs?: number) {}

  private add(phase: string, ms: number, extra: { bytes?: number } = {}) {
    const total = this.phases.get(phase) ?? { ms: 0, count: 0 };
    total.ms += ms;
    total.count += 1;
    if (extra.bytes !== undefined) total.bytes = (total.bytes ?? 0) + extra.bytes;
    this.phases.set(phase, total);
    this.attributedMs += ms;
  }

  /** Starts a phase; the returned function ends it once and returns its ms. */
  begin(phase: string) {
    const started = dayjs();
    const nested = this.attributedMs;
    let ms: number | undefined;
    return (extra?: { bytes?: number }) => {
      if (ms === undefined) {
        ms = Math.max(
          0,
          dayjs().diff(started) - (this.attributedMs - nested),
        );
        this.add(phase, ms, extra);
      }
      return ms;
    };
  }

  async time<T>(
    phase: string,
    run: () => Promise<T> | T,
    extra?: { bytes?: number },
  ): Promise<T> {
    const end = this.begin(phase);
    try {
      return await run();
    } finally {
      end(extra);
    }
  }

  /** Times one model call, split into router phases, telemetry and SDK time. */
  async modelCall<T>(
    kind: ModelCallTiming["kind"],
    run: (timing: AgentModelCallTiming) => Promise<T>,
    requestId: (result: T) => string | undefined,
  ): Promise<T> {
    const prefix = kind === "planner" ? "planner" : "model";
    const call: ModelCallTiming = {
      kind,
      startedAt: dayjs().valueOf(),
      wallMs: 0,
      submitMs: 0,
      waitMs: 0,
      polls: 0,
      readMs: 0,
      telemetryMs: 0,
      sdkMs: 0,
      outcome: "failed",
    };
    this.modelCalls.push(call);
    const timing: AgentModelCallTiming = {
      phase: (name, ms, polls) => {
        this.add(`${prefix}.${name}`, ms);
        if (name === "wait") call.waitMs += ms;
        else if (name === "read") call.readMs += ms;
        else call.submitMs += ms;
        call.polls += polls ?? 0;
      },
      job: (invocationKey, routerJobId, result) => {
        call.invocationKey = invocationKey;
        if (routerJobId) call.routerJobId = routerJobId;
        if (result) call.result = result;
      },
      telemetry: (ms) => {
        this.add(`${prefix}.telemetry`, ms);
        call.telemetryMs += ms;
      },
    };
    const before = this.phases.get(`${prefix}.sdk`)?.ms ?? 0;
    try {
      const result = await this.time(`${prefix}.sdk`, () => run(timing));
      call.outcome = "succeeded";
      const id = requestId(result);
      if (id) call.requestId = id;
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "RouterJobPending")
        call.outcome = "pending";
      throw error;
    } finally {
      call.wallMs = dayjs().valueOf() - call.startedAt;
      call.sdkMs = (this.phases.get(`${prefix}.sdk`)?.ms ?? 0) - before;
    }
  }

  /** The segment's record, once; later calls return undefined. */
  take(): OperatorRunTiming | undefined {
    if (this.taken) return undefined;
    this.taken = true;
    return this.record();
  }

  private record(): OperatorRunTiming {
    const endedAt = dayjs().valueOf();
    const wallMs = endedAt - this.startedAt;
    return {
      iteration: this.iteration,
      runnerAttempt: this.runnerAttempt,
      ...(this.routerRetryCount
        ? { routerRetryCount: this.routerRetryCount }
        : {}),
      startedAt: this.startedAt,
      endedAt,
      wallMs,
      unattributedMs: Math.max(0, wallMs - this.attributedMs),
      phases: [...this.phases].map(([phase, total]) => ({
        phase,
        ms: total.ms,
        ...(total.count > 1 ? { count: total.count } : {}),
        ...(total.bytes !== undefined ? { bytes: total.bytes } : {}),
      })),
      tools: this.tools.slice(0, MAX_TOOLS),
      modelCalls: this.modelCalls.slice(0, MAX_MODEL_CALLS),
      ...(this.previousCheckpointMs !== undefined
        ? { previousCheckpointMs: this.previousCheckpointMs }
        : {}),
    };
  }
}

const TOOL_PHASES = new Set(["tool.execute", "intent_prefetch"]);
const DECISION_PHASES = new Set([
  "family_selection",
  "workflow_assessment",
  "context_compaction",
]);
// Router and SDK time of model calls, including every `submit.*` sub-step;
// `.telemetry` stays bookkeeping.
const MODEL_PHASE = /^(model|planner)\.(submit(\.\w+)?|status|wait|read|sdk)$/;

type OperatorRunTimingRow = OperatorRunTiming & {
  endedBy: Infer<typeof operatorRunTimingEndValidator>;
  inline?: boolean;
};

/**
 * The get_operator_run `timing` section: each segment in start order (the
 * latest MAX_VIEW_SEGMENTS) with the checkpoint write that ended it and the
 * gap to the next segment, plus run totals per phase and per category.
 */
export function operatorRunTimingView(rows: OperatorRunTimingRow[]) {
  const sorted = [...rows].sort((a, b) => a.startedAt - b.startedAt);
  const byPhase: Record<string, number> = {};
  const totals = {
    wallMs: 0,
    toolMs: 0,
    modelMs: 0,
    decisionMs: 0,
    bookkeepingMs: 0,
    unattributedMs: 0,
    checkpointWriteMs: 0,
    handoffMs: 0,
  };
  const iterations = sorted.map((row, index) => {
    const next = sorted[index + 1];
    const checkpointWriteMs = next?.previousCheckpointMs;
    const handoffMs = next ? next.startedAt - row.endedAt : undefined;
    totals.wallMs += row.wallMs;
    totals.unattributedMs += row.unattributedMs;
    totals.checkpointWriteMs += checkpointWriteMs ?? 0;
    totals.bookkeepingMs += checkpointWriteMs ?? 0;
    totals.handoffMs += handoffMs ?? 0;
    for (const { phase, ms } of row.phases) {
      byPhase[phase] = (byPhase[phase] ?? 0) + ms;
      if (TOOL_PHASES.has(phase)) totals.toolMs += ms;
      else if (MODEL_PHASE.test(phase)) totals.modelMs += ms;
      else if (DECISION_PHASES.has(phase)) totals.decisionMs += ms;
      else totals.bookkeepingMs += ms;
    }
    return {
      iteration: row.iteration,
      endedBy: row.endedBy,
      ...(row.inline !== undefined ? { inline: row.inline } : {}),
      runnerAttempt: row.runnerAttempt,
      ...(row.routerRetryCount
        ? { routerRetryCount: row.routerRetryCount }
        : {}),
      startedAt: dayjs(row.startedAt).toISOString(),
      wallMs: row.wallMs,
      phases: row.phases,
      unattributedMs: row.unattributedMs,
      ...(checkpointWriteMs !== undefined ? { checkpointWriteMs } : {}),
      ...(handoffMs !== undefined ? { handoffMs } : {}),
      modelCalls: row.modelCalls,
      tools: row.tools,
    };
  });
  return {
    summary: {
      segments: sorted.length,
      iterations: new Set(sorted.map((row) => row.iteration)).size,
      ...totals,
      byPhase,
    },
    iterations: iterations.slice(-MAX_VIEW_SEGMENTS),
    ...(iterations.length > MAX_VIEW_SEGMENTS
      ? { omittedSegments: iterations.length - MAX_VIEW_SEGMENTS }
      : {}),
  };
}
