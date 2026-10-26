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
    /"category"\s*:\s*"(?:authentication|permission)"|session (?:has )?expired|stop impersonating|HTTP (?:401|403)/i.test(
      message,
    )
  )
    return "not_authorized";
  if (
    /access is disabled|credentials are unavailable|is not configured|integration.*(?:disabled|not configured)|Approve all is no longer enabled/i.test(
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
            : /timed out|temporarily unavailable|HTTP (?:429|5\d\d)/i.test(
                  message,
                )
              ? "provider_unavailable"
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

export type OperatorRunFailureReason = {
  code: string;
  message: string;
  nextStep: string;
};

/** Provider payloads remain in server logs; only fixed categories reach channels. */
export function operatorRunFailureReason(
  error: unknown,
): OperatorRunFailureReason {
  const detail = errorMessage(error);
  const record =
    error && typeof error === "object"
      ? (error as {
          failure?: { code?: string };
          routerCode?: string;
          name?: string;
        })
      : undefined;
  const code = record?.failure?.code ?? record?.routerCode ?? "";
  const match = `${code} ${detail}`;
  if (/\[context_compaction_failed\]/.test(match)) return {
    code: "context_compaction_failed",
    message: "The task's working context could not be compacted safely.",
    nextStep: "Check completed actions, then continue the remaining items in a smaller request.",
  };
  if (
    /payload_too_large|context.{0,20}(?:limit|length|window)|maximum.{0,20}tokens|too many tokens|request.{0,20}too large/i.test(
      match,
    )
  )
    return {
      code: "context_limit",
      message: "The task exceeded the model's context limit.",
      nextStep: "Narrow the request or process fewer records at a time.",
    };
  if (
    /\[time_limit\]|budget_exhausted|timed? out|timeout|deadline/i.test(match)
  )
    return {
      code: "time_limit",
      message: "The model service ran out of time.",
      nextStep:
        "Check completed actions, then continue with a smaller request.",
    };
  if (
    /\[model_unavailable\]|router_unavailable|router_internal|HTTP (?:429|5\d\d)|rate.?limit|temporarily unavailable/i.test(
      match,
    )
  )
    return {
      code: "model_unavailable",
      message: "The model service is temporarily unavailable.",
      nextStep: "Check completed actions before trying again later.",
    };
  if (
    /\[model_rejected\]|candidates_exhausted|router_rejected|rejected.*request/i.test(
      match,
    )
  )
    return {
      code: "model_rejected",
      message: "The model service could not accept this task.",
      nextStep:
        "Try a smaller request; if it persists, ask an administrator to check model routing.",
    };
  const terminal = terminalCode(error);
  if (terminal === "not_authorized" || /\[not_authorized\]/.test(match))
    return {
      code: "not_authorized",
      message: "Access to this operation is no longer authorized.",
      nextStep: "Sign in again with the required operator access.",
    };
  if (
    terminal === "integration_unavailable" ||
    /\[integration_unavailable\]/.test(match)
  )
    return {
      code: "integration_unavailable",
      message: "A required integration is unavailable.",
      nextStep: "Ask an administrator to check its connection in Settings.",
    };
  if (
    record?.name === "OperatorPlanGenerationError" ||
    /\[planning_failed\]/.test(match)
  )
    return {
      code: "planning_failed",
      message: "The model could not create a valid plan.",
      nextStep:
        "Retry with a smaller, concrete objective. No business tools ran.",
    };
  if (
    record?.name === "AgentIncompleteOutputError" ||
    /\[model_empty_output\]/.test(match)
  )
    return {
      code: "model_empty_output",
      message: "The model stopped before producing a complete answer.",
      nextStep: "Check completed actions, then continue the remaining work.",
    };
  return {
    code: "internal_error",
    message: "An internal error stopped the task.",
    nextStep:
      "Check completed actions and share the run ID with an administrator before retrying changes.",
  };
}
