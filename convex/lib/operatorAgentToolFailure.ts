import { NoWriteInputError } from "./noWriteInputError";
import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";

export type OperatorToolFailureDetail = {
  code: string;
  phase: "preflight" | "execution";
  recoverable: boolean;
  writeState: "not_started" | "unknown";
  guidance: string;
};

export type OperatorToolFailedOutcome = {
  status: "failed";
  error: string;
  failure: OperatorToolFailureDetail;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function preflightOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  return {
    status: "failed",
    error: errorMessage(error),
    failure: {
      code: "invalid_or_stale_input",
      phase: "preflight",
      recoverable: true,
      writeState: "not_started",
      guidance: `No new confirmation was created and no write started. Correct the ${toolName} input from authoritative tool results, then call it again.`,
    },
  };
}

export function confirmedPreflightOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  return {
    status: "failed",
    error: errorMessage(error),
    failure: {
      code:
        error instanceof NoWriteInputError
          ? error.code
          : "invalid_or_stale_input",
      phase: "preflight",
      recoverable: true,
      writeState: "not_started",
      guidance: `The approved ${toolName} input was revalidated before execution and no write started. Correct or refresh it and request a fresh exact confirmation; the prior approval cannot authorize changed input.`,
    },
  };
}

export function executionOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  const message = errorMessage(error);
  if (error instanceof NoWriteInputError) {
    return {
      status: "failed",
      error: message,
      failure: {
        code: error.code,
        phase: "execution",
        recoverable: true,
        writeState: "not_started",
        guidance: `The confirmed ${toolName} action did not start writing. Correct the input and request a fresh confirmation; the prior approval cannot authorize changed input.`,
      },
    };
  }
  return {
    status: "failed",
    error: message,
    failure: {
      code: "execution_outcome_unknown",
      phase: "execution",
      recoverable: false,
      writeState: "unknown",
      guidance:
        "Do not replay this side effect automatically. Read authoritative state before deciding whether a new action is needed.",
    },
  };
}

export function isRecoverableOperatorToolFailure(
  value: unknown,
): value is OperatorToolFailedOutcome {
  if (!value || typeof value !== "object") return false;
  const failure = (value as { failure?: unknown }).failure;
  return (
    (value as { status?: unknown }).status === "failed" &&
    Boolean(failure) &&
    typeof failure === "object" &&
    (failure as { recoverable?: unknown }).recoverable === true &&
    (failure as { writeState?: unknown }).writeState === "not_started"
  );
}
