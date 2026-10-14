import { intakeDetailsValidator } from "./intakeDetailsSchema";
import { v } from "convex/values";
import { INTAKE_FIELDS } from "../../lib/insurance-intake";
export const intakeAnswersValidator = v.object(
  Object.fromEntries(
    Object.keys(INTAKE_FIELDS).map((key) => [key, v.optional(v.string())]),
  ) as {
    [K in keyof typeof INTAKE_FIELDS]: ReturnType<
      typeof v.optional<ReturnType<typeof v.string>>
    >;
  },
);
export const requestIntakeFields = {
  ownerUserId: v.optional(v.id("users")), // Existing requests retain createdByUserId ownership.
  intakeVerifiedAccess: v.optional(v.boolean()),
  verificationClaimHash: v.optional(v.string()),
  verificationClaimExpiresAt: v.optional(v.number()),
  intakeSchemaVersion: v.optional(v.number()),
  intakeAnswers: v.optional(intakeAnswersValidator),
  intakeSkippedSteps: v.optional(v.array(v.number())),
  intakeCompletedSteps: v.optional(v.array(v.number())),
  intakeStep: v.optional(v.number()),
  intakeRevision: v.optional(v.number()),
  intakeAmendedAt: v.optional(v.number()),
  intakeSubmittedAt: v.optional(v.number()),
  intakeSnapshot: v.optional(intakeAnswersValidator),
  intakeDetails: v.optional(intakeDetailsValidator),
  intakeDetailsSnapshot: v.optional(intakeDetailsValidator),
  readiness: v.optional(
    v.union(
      v.literal("incomplete"),
      v.literal("ready_for_review"),
      v.literal("needs_information"),
      v.literal("ready_for_market"),
    ),
  ),
  readinessMissing: v.optional(v.array(v.string())),
  readinessConfirmedByUserId: v.optional(v.id("users")),
  readinessConfirmedAt: v.optional(v.number()),
};
