/**
 * The reviewer is an ordinary customer account with preset demonstration data.
 * Its email is on a non-operator domain. Nothing here gates sign-in or access.
 */
export const REVIEW_EMAIL = "chrome-review@review.spot.insure";
export const REVIEW_USER_NAME = "Spot Review";
export const REVIEW_ORG_SLUG = "spot-review-demo";
export const REVIEW_ORG_NAME = "Spot Review Demo (demonstration)";
/** Until migrated, the reviewer's credential lives under its former provider. */
export const LEGACY_REVIEW_PROVIDER_ID = "review-password";

const MIN_PASSWORD_LENGTH = 24;
const MAX_PASSWORD_LENGTH = 256;

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
