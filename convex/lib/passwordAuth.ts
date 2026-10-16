export const PASSWORD_PROVIDER_ID = "password";
/** A session this young counts as a fresh proof of email ownership (or password). */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

export function normalizePasswordEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Profile hook for the standard `Password` provider. The library calls it for
 * every flow before touching the database, so rejecting here leaves `signIn`
 * only: no public sign-up, reset, or email verification.
 */
export function passwordSignInProfile(params: Record<string, unknown>) {
  const email = normalizePasswordEmail(params.email);
  if (
    params.flow !== "signIn" ||
    !email ||
    typeof params.password !== "string"
  ) {
    throw new Error("Invalid credentials");
  }
  return { email };
}

export function assertNewPassword(password: unknown, email: string): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    password.trim().toLowerCase() === email
  ) {
    throw new Error(
      `Choose a password of ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters that is not your email.`,
    );
  }
}
