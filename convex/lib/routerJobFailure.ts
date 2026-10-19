import { v, type Infer } from "convex/values";

const routerAttemptValidator = v.object({
  attempt: v.number(),
  provider: v.string(),
  model: v.string(),
  outcome: v.union(v.literal("error"), v.literal("timeout")),
  errorCode: v.optional(v.string()),
});

export const routerJobFailureValidator = v.object({
  code: v.string(),
  retryable: v.boolean(),
  executionStarted: v.boolean(),
  requestId: v.optional(v.string()),
  attempts: v.optional(v.array(routerAttemptValidator)),
});

export type RouterJobFailure = Infer<typeof routerJobFailureValidator>;

/**
 * Normalizes cl-router's job error, which arrives as a typed
 * `{ code, message, retryable, executionStarted }` object (older routers sent
 * a plain string), into the stored message and structured failure.
 */
export function parseRouterJobError(value: unknown): {
  error: string;
  failure?: RouterJobFailure;
} {
  if (typeof value === "string" && value)
    return { error: value.slice(0, 1_000) };
  if (value && typeof value === "object") {
    const { code, message, retryable, executionStarted, requestId, attempts } =
      value as Record<string, unknown>;
    if (
      typeof code === "string" &&
      typeof retryable === "boolean" &&
      typeof executionStarted === "boolean"
    ) {
      const text =
        typeof message === "string" && message ? message : "Router job failed";
      return {
        error: `${text} (${code})`.slice(0, 1_000),
        failure: {
          code: code.slice(0, 100),
          retryable,
          executionStarted,
          ...(safeDiagnosticToken(requestId) ? { requestId } : {}),
          ...(Array.isArray(attempts)
            ? { attempts: attempts.slice(0, 4).flatMap(parseAttempt) }
            : {}),
        },
      };
    }
  }
  return { error: "Router job failed" };
}

function safeDiagnosticToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value);
}

function parseAttempt(
  value: unknown,
): NonNullable<RouterJobFailure["attempts"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const { attempt, provider, model, outcome, errorCode } = value as Record<
    string,
    unknown
  >;
  if (
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > 4 ||
    !safeDiagnosticToken(provider) ||
    !safeDiagnosticToken(model) ||
    (outcome !== "error" && outcome !== "timeout")
  )
    return [];
  return [
    {
      attempt,
      provider,
      model,
      outcome,
      ...(safeDiagnosticToken(errorCode) ? { errorCode } : {}),
    },
  ];
}
