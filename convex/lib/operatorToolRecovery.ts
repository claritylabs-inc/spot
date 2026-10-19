import { InvalidToolInputError, NoSuchToolError } from "ai";
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
/** Consecutive replies without a tool call before the run reports the blocker. */
const MAX_DECLINED = 2;
const MAX_TEXT = 600;

export type RecoveryFailure = {
  toolName: string;
  code: string;
  guidance: string;
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
  /** Exhausted-tool capacity was reached: no further business tool dispatch. */
  stopped: boolean;
  /** Consecutive corrective iterations that made no tool call. */
  declined: number;
};

export const EMPTY_RECOVERY: OperatorRecoveryState = {
  pending: [],
  attemptsLeft: 0,
  exhausted: [],
  stopped: false,
  declined: 0,
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
    exhausted: list(record.exhausted, MAX_EXHAUSTED),
    stopped: record.stopped === true,
    declined:
      Number.isInteger(record.declined) &&
      (record.declined as number) >= 0 &&
      (record.declined as number) <= MAX_DECLINED
        ? (record.declined as number)
        : 0,
  };
}

type ToolCallRecord = { toolName: string; input: unknown; output: unknown };

/** The SDK refused the call before dispatch, so nothing ran. */
const UNAVAILABLE_TOOL_OUTPUT = {
  status: "failed",
  error: "Tool call was rejected before it ran",
  failure: {
    code: "tool_unavailable",
    phase: "preflight",
    recoverable: true,
    writeState: "not_started",
    guidance:
      "That tool call was rejected before it ran: the tool was not offered in this step or its input was malformed. Nothing ran. Load its family with expand_tools or use an offered tool, and send input that matches its schema.",
  },
};

/** Any other tool-error is not known to be pre-dispatch, so it is terminal. */
const UNKNOWN_TOOL_ERROR_OUTPUT = {
  status: "failed",
  error: "Tool call ended with an unclassified error",
  failure: {
    code: "execution_outcome_unknown",
    phase: "execution",
    recoverable: false,
    writeState: "unknown",
    guidance:
      "Do not replay this call automatically. Read authoritative state before deciding whether a new action is needed.",
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
    // An invalid call keeps its real error on the step's tool call; the
    // content part only carries a message string.
    const callErrors = new Map<string, unknown>();
    const calls = (step as { toolCalls?: unknown })?.toolCalls;
    for (const call of Array.isArray(calls) ? calls : []) {
      const { toolCallId, invalid, error } = (call ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof toolCallId === "string" && invalid === true)
        callErrors.set(toolCallId, error);
    }
    const content = (step as { content?: unknown })?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const { type, toolName, toolCallId, input } = (part ?? {}) as Record<
        string,
        unknown
      >;
      const error =
        typeof toolCallId === "string" ? callErrors.get(toolCallId) : undefined;
      if (
        type === "tool-error" &&
        typeof toolName === "string" &&
        !(typeof toolCallId === "string" && answered.has(toolCallId))
      )
        records.push({
          toolName,
          input,
          output:
            NoSuchToolError.isInstance(error) ||
            InvalidToolInputError.isInstance(error)
              ? UNAVAILABLE_TOOL_OUTPUT
              : UNKNOWN_TOOL_ERROR_OUTPUT,
        });
    }
  }
  return records;
}

function failureStatus(output: unknown) {
  return (output as { status?: unknown } | null)?.status;
}

/**
 * Folds one model iteration's tool outcomes into the recovery state.
 * Recoverable failures join the episode; a success, a pending approval, or a
 * terminal failure of the same tool resolves it (terminal detail is in that
 * result). Failures group by tool, not target: a bogus identifier makes target
 * keys unreliable, so a corrected call of the same tool must be able to
 * resolve it, and the plan and prompt keep the model accountable for each
 * target. A blocked call executed nothing and changes nothing. The iteration
 * following a failure always consumes one attempt.
 */
export function advanceRecovery(
  previous: OperatorRecoveryState,
  calls: readonly ToolCallRecord[],
): OperatorRecoveryState {
  let pending = previous.pending.map((entry) => ({ ...entry }));
  for (const { toolName, output } of calls) {
    // An exhausted tool is already disabled; further calls change nothing.
    if (isDisabledTool(previous, toolName)) continue;
    if (isRecoverableOperatorToolFailure(output)) {
      const entry: RecoveryFailure = {
        toolName,
        code: text(output.failure.code, 100),
        guidance: text(output.failure.guidance),
      };
      const index = pending.findIndex((item) => item.toolName === toolName);
      if (index >= 0) pending[index] = entry;
      else if (pending.length < MAX_PENDING) pending.push(entry);
    } else if (failureStatus(output) !== "blocked_by_confirmation") {
      pending = pending.filter((item) => item.toolName !== toolName);
    }
  }
  const carried = previous.pending.some((entry) =>
    pending.some((item) => item.toolName === entry.toolName),
  );
  let attemptsLeft =
    pending.length === 0
      ? 0
      : carried
        ? previous.attemptsLeft - 1
        : MAX_CORRECTIVE_ITERATIONS;
  let exhausted = previous.exhausted;
  let stopped = previous.stopped;
  if (pending.length > 0 && attemptsLeft <= 0) {
    const additions = pending
      .filter((item) => !exhausted.some((e) => e.toolName === item.toolName))
      .map(({ toolName, code, guidance }) => ({ toolName, code, guidance }));
    // Never evict a disabled tool; at capacity the run stops dispatching.
    if (exhausted.length + additions.length > MAX_EXHAUSTED) stopped = true;
    else exhausted = [...exhausted, ...additions];
    pending = [];
    attemptsLeft = 0;
  }
  // Replies without a tool call while a failure is unresolved count as
  // declines; any tool call, or a resolved episode, starts over.
  const declined =
    pending.length > 0 && calls.length === 0 ? previous.declined + 1 : 0;
  return { pending, attemptsLeft, exhausted, stopped, declined };
}

function isDisabledTool(state: OperatorRecoveryState, toolName: string) {
  return (
    state.stopped ||
    state.exhausted.some((entry) => entry.toolName === toolName)
  );
}

/**
 * True when the step called tools and every call targeted a disabled tool, so
 * it made no valid progress and the run must end rather than continue.
 */
export function stepCalledOnlyDisabledTools(
  result: unknown,
  state: OperatorRecoveryState,
): boolean {
  const steps = (result as { steps?: unknown })?.steps;
  const names: string[] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const calls = (step as { toolCalls?: unknown })?.toolCalls;
    for (const call of Array.isArray(calls) ? calls : []) {
      const name = (call as { toolName?: unknown })?.toolName;
      if (typeof name === "string") names.push(name);
    }
  }
  return names.length > 0 && names.every((name) => isDisabledTool(state, name));
}

/** Deterministic closing note naming what could not be completed. */
export function incompleteWorkNote(state: OperatorRecoveryState): string {
  const tools = state.exhausted
    .map((item) => `${item.toolName} (${item.code || "unknown error"})`)
    .join(", ");
  return `Some tool calls could not be completed after three corrective attempts. ${tools ? `Stopped calls: ${tools}.` : "Further calls were stopped after repeated failures."} Any work without a successful result remains unverified.`;
}

/**
 * A reply without a tool call is held back while a recoverable failure has
 * attempts left, but at most twice in a row: a model that twice declines to
 * call a tool has no correction to make, and further prompting only coerces
 * guesses.
 */
export function recoveryRequiresAnotherIteration(
  state: OperatorRecoveryState,
): boolean {
  return (
    state.pending.length > 0 &&
    state.attemptsLeft > 0 &&
    state.declined < MAX_DECLINED
  );
}

export const RECOVERY_NOTICE_MESSAGE =
  "[Spot runtime notice, not from the operator] An earlier tool call failed before any write started and is unresolved. Your last reply was not delivered. If the failure can be corrected, call the tool again with corrected input taken from authoritative tool results, refreshing the record with a read-only tool if needed. If the authoritative identifier or input is missing and the available read-only tools cannot find it, do not guess or invent calls: say exactly what is missing. Make tool calls only through the tool interface, never as written text.";

/** Grounded closing report from the structured failures, not from model prose. */
export function recoveryBlockerReport(
  unresolved: readonly RecoveryFailure[],
): string {
  const lines = unresolved
    .map(
      (item) =>
        `- ${item.toolName} (${item.code || "unknown error"}): ${item.guidance}`,
    )
    .join("\n");
  return `I couldn't verify part of this request. These calls failed before any change was made, and the missing or incorrect input was not found with the available tools:\n${lines}\nNothing was guessed or changed for them. Send the missing authoritative identifier or name, or use Retry. Other tool results from this run are unaffected.`;
}

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
        )}\nCorrect the input using authoritative tool results, refresh the referenced records, or use a read-only alternative, then call the tool again. A rejected or invalid search or lookup proves nothing about whether a match exists; never say a target has no match unless a valid search returned none. Do not claim these targets are done. Do not retry authorization failures, denied approvals, or outcomes with unknown side effects. If the authoritative identifier or input is missing and cannot be found with read-only tools, do not guess: say exactly what is missing. A reply without a tool call is held back and you are asked again, and after a second such reply the run ends with a summary of the blocked calls.`,
    );
  }
  if (state.stopped) {
    parts.push(
      "ALL TOOLS DISABLED: too many tools failed repeatedly in this run. No tools are offered. Report which targets are incomplete and the error codes; do not claim they were handled.",
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
