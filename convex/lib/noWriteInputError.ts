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
