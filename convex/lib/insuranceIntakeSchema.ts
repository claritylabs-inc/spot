import { followupBatchValidator } from "./intakeFollowupSchema";
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
export const intakeApplicationValidator = v.object({
  answers: intakeAnswersValidator,
  details: intakeDetailsValidator,
  files: v.array(v.object({ id: v.string(), name: v.string() })),
  submittedAt: v.number(),
  revision: v.number(),
});
export const intakeBusinessProfileValidator = v.object({
  answers: intakeAnswersValidator,
  details: intakeDetailsValidator,
  submittedAt: v.number(),
  sourceRequestId: v.optional(v.id("procurementRequests")),
});
export const requestIntakeFields = {
  intakePremiumEstimate: v.optional(v.object({
    contentHash: v.string(), token: v.string(), startedAt: v.number(), provisional: v.optional(v.boolean()),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    currency: v.string(), minimumMonthly: v.optional(v.number()), maximumMonthly: v.optional(v.number()),
  })),
  intakeVehicleRelevance: v.optional(v.object({
    sourceKey:v.string(), fingerprint:v.string(), startedAt:v.number(), attempts:v.number(),
    status:v.union(v.literal("pending"),v.literal("running"),v.literal("completed"),v.literal("failed")),
    excludedIds:v.array(v.string()),
  })),
  intakeCyberResearch: v.optional(v.object({
    fingerprint: v.string(), sourceKey: v.string(), startedAt: v.number(), attempts: v.number(),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    privacyPolicyUrl: v.optional(v.string()), termsUrl: v.optional(v.string()),
    technologies: v.optional(v.array(v.object({ name: v.string(), evidence: v.string(), sourceUrl: v.string() }))),
    suggestions: v.optional(v.array(v.object({ questionId: v.string(), answer: v.string(), confidence: v.number(), evidence: v.string(), sourceUrl: v.string() }))),
  })),
  intakeGapAssessment: v.optional(v.object({
    token: v.string(), contextHash: v.string(), startedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("complete"), v.literal("failed")),
    needsAdditional: v.optional(v.boolean()),
  })),
  intakeFollowups: v.optional(v.object({ acord: v.optional(followupBatchValidator), additional: v.optional(followupBatchValidator) })),
  intakeSubmittedApplication: v.optional(intakeApplicationValidator),
  ownerUserId: v.optional(v.id("users")), // Existing requests retain createdByUserId ownership.
  intakeSavedCompany: v.optional(
    v.object({
      orgId: v.id("organizations"),
      answers: intakeAnswersValidator,
      details: intakeDetailsValidator,
    }),
  ),
  intakeNewCompany: v.optional(v.boolean()),
  intakeVerifiedAccess: v.optional(v.boolean()),
  verificationClaimHash: v.optional(v.string()),
  verificationClaimExpiresAt: v.optional(v.number()),
  intakeSchemaVersion: v.optional(v.number()),
  intakeAnswers: v.optional(intakeAnswersValidator),
  intakeCompanyResearch: v.optional(
    v.object({
      fingerprint: v.string(),
      name: v.string(),
      website: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
      ),
      startedAt: v.number(),
      attempts: v.number(),
      suggestions: v.optional(intakeAnswersValidator),
      evidence: v.optional(v.string()),
    }),
  ),
  intakeSkippedSteps: v.optional(v.array(v.number())),
  intakeCompletedSteps: v.optional(v.array(v.number())),
  intakeStep: v.optional(v.number()),
  intakeRevision: v.optional(v.number()),
  intakeAmendedAt: v.optional(v.number()),
  intakeSlackProgressSnapshot: v.optional(v.record(v.string(), v.object({ label: v.string(), value: v.string() }))),
  intakeSlackThreadTs: v.optional(v.string()),
  intakeSlackLeaseUntil: v.optional(v.number()),
  intakeSubmittedAt: v.optional(v.number()),
  intakeShoppingAuthorization: v.optional(
    v.object({
      userId: v.id("users"),
      confirmedAt: v.number(),
      contentHash: v.string(),
      statement: v.string(),
    }),
  ),
  // Deprecated: read fallback for submissions before structured application promotion.
  intakeSubmissionBaseline: v.optional(
    v.object({
      answers: intakeAnswersValidator,
      details: intakeDetailsValidator,
      files: v.array(v.object({ id: v.string(), name: v.string() })),
    }),
  ),
  intakeSubmittedContentHash: v.optional(v.string()),
  intakeResubmittedAt: v.optional(v.number()),
  intakeSnapshot: v.optional(intakeAnswersValidator),
  intakeDetails: v.optional(intakeDetailsValidator),
  intakeDetailsSnapshot: v.optional(intakeDetailsValidator),
  // Deprecated: compatibility only; manual readiness review has been removed.
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
