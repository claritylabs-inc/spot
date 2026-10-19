import { isRecoverableOperatorToolFailure } from "./operatorAgentToolFailure";

/**
 * Bounded corrective recovery for operator tool failures. State travels in the
 * durable model continuation, never in a schema checkpoint. A recoverable
 * failure that began no write grants this many corrective model iterations;
 * each following iteration consumes one whether or not it called a tool, and
 * unrelated successful reads never reset the budget. When it runs out, the
 * failing tools are disabled for the run so the agent can finish other work
 * and report the rest. The model chooses every corrected call; nothing is
 * replayed automatically.
 */
export const MAX_CORRECTIVE_ITERATIONS = 3;
const MAX_PENDING = 8;
const MAX_EXHAUSTED = 16;
const MAX_TEXT = 600;

export type RecoveryFailure = {
  toolName: string;
  code: string;
  guidance: string;
  /** Stable target ids from the input; empty means the whole tool. */
  target: string;
};

export type ExhaustedTool = {
  toolName: string;
  code: string;
  guidance: string;
};

export type OperatorRecoveryState = {
  pending: RecoveryFailure[];
  /** Corrective iterations left, including the one about to run. */
  attemptsLeft: number;
  exhausted: ExhaustedTool[];
};

export const EMPTY_RECOVERY: OperatorRecoveryState = {
  pending: [],
  attemptsLeft: 0,
  exhausted: [],
};

function text(value: unknown, limit = MAX_TEXT): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/** Defensive read of a stored state; anything malformed means no recovery. */
export function parseRecoveryState(value: unknown): OperatorRecoveryState {
  if (!value || typeof value !== "object") return EMPTY_RECOVERY;
  const record = value as Record<string, unknown>;
  const list = (entries: unknown, limit: number) =>
    (Array.isArray(entries) ? entries : []).slice(0, limit).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const toolName = text(item.toolName, 200);
      return toolName
        ? [
            {
              toolName,
              code: text(item.code, 100),
              guidance: text(item.guidance),
              target: text(item.target, 400),
            },
          ]
        : [];
    });
  const attempts = Number(record.attemptsLeft);
  return {
    pending: list(record.pending, MAX_PENDING),
    attemptsLeft:
      Number.isInteger(attempts) &&
      attempts >= 0 &&
      attempts <= MAX_CORRECTIVE_ITERATIONS
        ? attempts
        : 0,
    exhausted: list(record.exhausted, MAX_EXHAUSTED).map(
      ({ toolName, code, guidance }) => ({ toolName, code, guidance }),
    ),
  };
}

/** Identifier fields name the target; without any, the whole tool is the group. */
export function recoveryTarget(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return Object.entries(input as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        /(?:^|[a-z])Ids?$/.test(key) && typeof value === "string",
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value as string}`)
    .join("&")
    .slice(0, 400);
}

type ToolCallRecord = { toolName: string; input: unknown; output: unknown };

/** Outcome for a call the SDK rejected before execute, such as an unoffered tool. */
const UNAVAILABLE_TOOL_OUTPUT = {
  status: "failed",
  error: "Tool is not available in this step",
  failure: {
    code: "tool_unavailable",
    phase: "preflight",
    recoverable: true,
    writeState: "not_started",
    guidance:
      "That tool was not offered in this step and nothing ran. Load its family with expand_tools or use a tool that is offered; do not repeat the same call.",
  },
};

/** Tool calls with results, in order, from an AI SDK generation result. */
export function recoveryCallsFromResult(result: unknown): ToolCallRecord[] {
  const steps = (result as { steps?: unknown })?.steps;
  const records: ToolCallRecord[] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const answered = new Set<string>();
    const results = (step as { toolResults?: unknown })?.toolResults;
    for (const entry of Array.isArray(results) ? results : []) {
      const { toolName, toolCallId, input, output } = (entry ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof toolName !== "string") continue;
      if (typeof toolCallId === "string") answered.add(toolCallId);
      records.push({ toolName, input, output });
    }
    const content = (step as { content?: unknown })?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const { type, toolName, toolCallId, input } = (part ?? {}) as Record<
        string,
        unknown
      >;
      if (
        type === "tool-error" &&
        typeof toolName === "string" &&
        !(typeof toolCallId === "string" && answered.has(toolCallId))
      )
        records.push({ toolName, input, output: UNAVAILABLE_TOOL_OUTPUT });
    }
  }
  return records;
}

function failureStatus(output: unknown) {
  return (output as { status?: unknown } | null)?.status;
}

function same(
  entry: { toolName: string; target: string },
  toolName: string,
  target: string,
) {
  return (
    entry.toolName === toolName &&
    (entry.target === "" || target === "" || entry.target === target)
  );
}

/**
 * Folds one model iteration's tool outcomes into the recovery state.
 * Recoverable failures join the episode; a success or a terminal failure of
 * the same tool resolves it. A blocked call executed nothing and changes
 * nothing. The iteration following a failure always consumes one attempt.
 */
export function advanceRecovery(
  previous: OperatorRecoveryState,
  calls: readonly ToolCallRecord[],
): OperatorRecoveryState {
  let pending = previous.pending.map((entry) => ({ ...entry }));
  for (const { toolName, input, output } of calls) {
    // An exhausted tool is already disabled; further calls change nothing.
    if (previous.exhausted.some((entry) => entry.toolName === toolName))
      continue;
    const target = recoveryTarget(input);
    if (isRecoverableOperatorToolFailure(output)) {
      const entry: RecoveryFailure = {
        toolName,
        code: text(output.failure.code, 100),
        guidance: text(output.failure.guidance),
        target,
      };
      const index = pending.findIndex(
        (item) => item.toolName === toolName && item.target === target,
      );
      if (index >= 0) pending[index] = entry;
      else if (pending.length < MAX_PENDING) pending.push(entry);
    } else if (failureStatus(output) !== "blocked_by_confirmation") {
      // Success, a pending approval, or a terminal failure all end the
      // recoverable failure of that tool; terminal detail is in the result.
      pending = pending.filter((item) => !same(item, toolName, target));
    }
  }
  const carried = previous.pending.some((entry) =>
    pending.some(
      (item) =>
        item.toolName === entry.toolName && item.target === entry.target,
    ),
  );
  let attemptsLeft =
    pending.length === 0
      ? 0
      : carried
        ? previous.attemptsLeft - 1
        : MAX_CORRECTIVE_ITERATIONS;
  let exhausted = previous.exhausted;
  if (pending.length > 0 && attemptsLeft <= 0) {
    exhausted = [
      ...exhausted,
      ...pending
        .filter((item) => !exhausted.some((e) => e.toolName === item.toolName))
        .map(({ toolName, code, guidance }) => ({ toolName, code, guidance })),
    ].slice(-MAX_EXHAUSTED);
    pending = [];
    attemptsLeft = 0;
  }
  return { pending, attemptsLeft, exhausted };
}

/** A final answer is premature while recoverable failures still have attempts. */
export function recoveryRequiresAnotherIteration(
  state: OperatorRecoveryState,
): boolean {
  return state.pending.length > 0 && state.attemptsLeft > 0;
}

export const RECOVERY_NOTICE_MESSAGE =
  "[Spot runtime notice, not from the operator] A tool call failed before any write started and is not resolved yet. Do not give a final answer. Correct the input or refresh the referenced records, then call the tool again, or use a read-only alternative.";

export function recoveryPromptBlock(state: OperatorRecoveryState): string {
  const parts: string[] = [];
  if (state.pending.length > 0) {
    parts.push(
      `RECOVERY (${state.attemptsLeft} corrective attempt${state.attemptsLeft === 1 ? "" : "s"} left, including this step). These calls failed and no write started:\n${state.pending
        .map(
          (item) =>
            `- ${item.toolName} (code ${item.code || "unknown"}): ${item.guidance}`,
        )
        .join(
          "\n",
        )}\nCorrect the input using authoritative tool results, refresh the referenced records, or use a read-only alternative, then call the tool again. A rejected or invalid search or lookup proves nothing about whether a match exists; never say a target has no match unless a valid search returned none. Do not claim these targets are done. Do not retry authorization failures, denied approvals, or outcomes with unknown side effects. Do not finish with a final answer while attempts remain unless the failing work is complete.`,
    );
  }
  if (state.exhausted.length > 0) {
    parts.push(
      `DISABLED TOOLS (corrective attempts used up for this run): ${state.exhausted
        .map((item) => `${item.toolName} (last code ${item.code || "unknown"})`)
        .join(
          ", ",
        )}. They are no longer offered. Finish any unrelated work with other tools, then report which targets are incomplete and the error code. Do not claim those targets were handled.`,
    );
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

export function exhaustedToolFailure(toolName: string, entry?: ExhaustedTool) {
  return {
    status: "failed" as const,
    error: `${toolName} is disabled for this run after repeated failed corrections`,
    failure: {
      code: "tool_disabled_after_failed_corrections",
      phase: "preflight" as const,
      recoverable: false,
      writeState: "not_started" as const,
      guidance: `No action ran. Do not call ${toolName} again in this run${entry?.code ? ` (last failure ${entry.code})` : ""}; report the incomplete targets and the error.`,
    },
  };
}
