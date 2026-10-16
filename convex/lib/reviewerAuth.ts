/**
 * The reviewer account is one fixed, password-protected demonstration identity.
 * Its email is on a non-operator domain, so operator alias linking never applies.
 */
export const REVIEW_PROVIDER_ID = "review-password";
export const REVIEW_EMAIL = "chrome-review@review.spot.insure";
export const REVIEW_USER_NAME = "Spot Review";
export const REVIEW_ORG_SLUG = "spot-review-demo";
export const REVIEW_ORG_NAME = "Spot Review Demo (demonstration)";

const MIN_PASSWORD_LENGTH = 24;
const MAX_PASSWORD_LENGTH = 256;

function normalizeReviewerEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isReviewerEmail(value: unknown) {
  return normalizeReviewerEmail(value) === REVIEW_EMAIL;
}

/**
 * Profile hook for the `review-password` provider. The library calls it for
 * every flow before touching the database, so rejecting here closes sign-up,
 * reset and email verification, and limits sign-in to the one identity.
 */
export function reviewerSignInProfile(params: Record<string, unknown>) {
  if (params.flow !== "signIn" || !isReviewerEmail(params.email)) {
    throw new Error("Invalid credentials");
  }
  return { email: REVIEW_EMAIL };
}

export function assertReviewerPassword(password: unknown): asserts password is string {
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Reviewer password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
    );
  }
}
