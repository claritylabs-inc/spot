import { v, type Infer } from "convex/values";

export const routerJobFailureValidator = v.object({
  code: v.string(),
  retryable: v.boolean(),
  executionStarted: v.boolean(),
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
    const { code, message, retryable, executionStarted } = value as Record<
      string,
      unknown
    >;
    if (
      typeof code === "string" &&
      typeof retryable === "boolean" &&
      typeof executionStarted === "boolean"
    ) {
      const text = typeof message === "string" && message ? message : "Router job failed";
      return {
        error: `${text} (${code})`.slice(0, 1_000),
        failure: { code: code.slice(0, 100), retryable, executionStarted },
      };
    }
  }
  return { error: "Router job failed" };
}
