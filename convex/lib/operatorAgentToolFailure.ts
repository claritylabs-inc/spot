import { z } from "zod";
import { NoWriteInputError } from "./noWriteInputError";
import {
  getOperatorAgentToolSpec,
  type OperatorAgentToolName,
} from "./operatorAgentToolRegistry";

export type OperatorToolFailureDetail = {
  code: string;
  phase: "preflight" | "execution";
  recoverable: boolean;
  writeState: "not_started" | "unknown";
  guidance: string;
  issues?: Array<{ path: string; code: string; message: string }>;
};
export type OperatorToolFailedOutcome = {
  status: "failed";
  failure: OperatorToolFailureDetail;
  error: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function operatorNoWriteCode(error: unknown): string | undefined {
  if (error instanceof NoWriteInputError) return error.code;
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (
      data &&
      typeof data === "object" &&
      "kind" in data &&
      data.kind === "no_write_input" &&
      "code" in data &&
      typeof data.code === "string"
    )
      return data.code;
  }
}

// These failures require a human or an existing approval, never model retries.
function terminalCode(error: unknown) {
  if (operatorNoWriteCode(error) === "spot_owned_broker_identity")
    return "spot_owned_broker_identity";
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data;
    if (
      data &&
      typeof data === "object" &&
      "category" in data &&
      (data.category === "authentication" || data.category === "permission")
    )
      return "not_authorized";
  }
  const message = errorMessage(error);
  if (
    /"category"\s*:\s*"(?:authentication|permission)"|session (?:has )?expired|stop impersonating/i.test(
      message,
    )
  )
    return "not_authorized";
  if (
    /access is disabled|credentials are unavailable|integration.*(?:disabled|not configured)|Approve all is no longer enabled/i.test(
      message,
    )
  )
    return "integration_unavailable";
  if (
    /not authorized|unauthorized|forbidden|access denied|permission denied|insufficient.*(?:role|permission)|operator access required|owner access required|requires an owner|requires? (?:an? )?operator|cannot.*impersonat|not allowed.*impersonat/i.test(
      message,
    )
  )
    return "not_authorized";
  if (
    /confirmation.*(?:denied|rejected|no longer active)|approval.*(?:denied|rejected)|action is (?:denied|rejected)/i.test(
      message,
    )
  )
    return "approval_required";
  if (
    /already in progress|run is no longer active|input changed before|idempotency key was already used/i.test(
      message,
    )
  )
    return "execution_state_conflict";
}

function preflightFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
  confirmed: boolean,
): OperatorToolFailedOutcome {
  const message = errorMessage(error);
  const terminal = terminalCode(error);
  const issues =
    error instanceof z.ZodError
      ? error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message.slice(0, 200),
        }))
      : undefined;
  return {
    status: "failed",
    failure: {
      code:
        terminal ??
        operatorNoWriteCode(error) ??
        (issues
          ? "invalid_tool_input"
          : /stale|revision|version changed/i.test(message)
            ? "stale_revision"
            : /exact.* ID|invalid.* ID/i.test(message)
              ? "invalid_identifier"
              : "invalid_or_stale_input"),
      phase: "preflight",
      recoverable: !terminal,
      writeState: "not_started",
      guidance: terminal
        ? "Do not retry or work around this restriction. Report the blocked action and use the existing authorization or approval flow."
        : `No write started. Correct ${toolName} using its schema and authoritative IDs. Search inputs accept one target unless batch syntax is explicitly supported; a rejected search is not evidence of absence.${confirmed ? " Changed input requires a fresh exact confirmation." : ""}`,
      ...(issues ? { issues } : {}),
    },
    error: message,
  };
}

export function preflightOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  return preflightFailure(toolName, error, false);
}
export function confirmedPreflightOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  return preflightFailure(toolName, error, true);
}

export function executionOperatorToolFailure(
  toolName: OperatorAgentToolName,
  error: unknown,
): OperatorToolFailedOutcome {
  const message = errorMessage(error);
  const terminal = terminalCode(error);
  const knownNoWrite = operatorNoWriteCode(error);
  // Attachment retrieval is catalogued as read but stages a file in the thread.
  const readOnly =
    getOperatorAgentToolSpec(toolName).effect === "read" &&
    toolName !== "get_company_email_attachment";
  const recoverable = !terminal && Boolean(knownNoWrite || readOnly);
  const code =
    terminal ??
    knownNoWrite ??
    (readOnly
      ? /invalid.*(?:ID|identifier)|(?:ID|identifier) is required/i.test(
          message,
        )
        ? "invalid_identifier"
        : /not found/i.test(message)
          ? "target_not_found"
          : /cursor|continuation/i.test(message)
            ? "invalid_continuation"
            : /same input already failed/i.test(message)
              ? "same_input_already_failed"
              : "read_failed"
      : "execution_outcome_unknown");
  return {
    status: "failed",
    failure: {
      code,
      phase: "execution",
      recoverable,
      writeState: knownNoWrite || readOnly ? "not_started" : "unknown",
      guidance: terminal
        ? "Do not retry or bypass this restriction. Report the blocked action; check authoritative state if an operation may already be running."
        : recoverable
          ? code === "invalid_continuation"
            ? "Restart the read without a cursor using the original filters. Do not invent or alter a continuation reference."
            : `Correct the ${toolName} input from authoritative results and retry. Refresh missing IDs, narrow the query, or use another supported read. A failed read is not evidence of absence. Changed write input requires fresh exact approval.`
          : "Do not replay this side effect automatically. Read authoritative state before deciding whether a new action is needed.",
    },
    error: message,
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
