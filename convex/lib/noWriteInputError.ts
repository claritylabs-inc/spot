import { ConvexError } from "convex/values";

/**
 * A domain validation failure that is raised before the operation performs any
 * write. Catchers may offer a corrected attempt, but changed write input still
 * requires its own authorization and confirmation.
 */
export class NoWriteInputError extends ConvexError<{
  kind: "no_write_input";
  code: string;
  message: string;
}> {
  readonly code: string;

  constructor(code: string, message: string) {
    super({ kind: "no_write_input", code, message });
    this.message = message;
    this.name = "NoWriteInputError";
    this.code = code;
  }
}

/**
 * Rethrows a NoWriteInputError that crossed a `runAction` boundary as a fresh
 * one, so its message no longer carries the nested function's stack text.
 */
export function rethrowNoWriteInput(error: unknown): never {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data: unknown }).data
      : undefined;
  if (
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === "no_write_input" &&
    typeof (data as { code?: unknown }).code === "string" &&
    typeof (data as { message?: unknown }).message === "string"
  ) {
    const { code, message } = data as { code: string; message: string };
    throw new NoWriteInputError(code, message);
  }
  throw error;
}
