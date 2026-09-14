/**
 * A domain validation failure that is raised before the operation performs any
 * write. Catchers may offer a corrected attempt, but changed write input still
 * requires its own authorization and confirmation.
 */
export class NoWriteInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NoWriteInputError";
    this.code = code;
  }
}
