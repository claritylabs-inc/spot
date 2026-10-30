import { z } from "zod";
import {
  COMPANY_PROFILE_SHAPES,
  companyProfileInputSchema,
} from "./companyProfileInput";
import { INTAKE_FIELDS } from "../../lib/insurance-intake";
import {
  COVERAGE_OPTIONS,
  UNKNOWN_ANSWER,
  validCoverageLimit,
} from "../../lib/insurance-intake-details";
import { fieldNames, strictObjectField } from "./operatorToolFieldCatalog";

const text = z.string().max(8000);
const companyDetails = companyProfileInputSchema.shape.details.unwrap();
const location = companyDetails.shape.locations.unwrap().element;
/** Typed details own these; answers hold only the remaining scalar fields. */
const DETAIL_OWNED_ANSWER_KEYS: string[] = [
  "intakeGoal",
  "coverage",
  "limits",
  "separateQuotes",
  "coverageScope",
  "formation",
  "registeredAddress",
  "mailingAddress",
  "relatedEntities",
  "locations",
  "trailingRevenue",
  "projectedRevenue",
];
export const APPLICATION_ANSWER_KEYS = Object.keys(INTAKE_FIELDS).filter(
  (key) => !DETAIL_OWNED_ANSWER_KEYS.includes(key),
) as [keyof typeof INTAKE_FIELDS, ...Array<keyof typeof INTAKE_FIELDS>];

const applicationAnswers = z.partialRecord(
  z.enum(APPLICATION_ANSWER_KEYS),
  text,
);

const applicationDetails = companyDetails
  .extend({
    coverages: z
      .array(
        z
          .object({
            coverage: z.enum([
              "unknown",
              "general_liability",
              "property",
              "workers_compensation",
              "commercial_auto",
              "professional_liability",
              "cyber",
              "umbrella",
              "other",
            ]),
            limits: z.record(z.string(), text),
            additionalCoverages: text.optional(),
            scopeDescription: text.optional(),
            properties: z.array(location).max(30).optional(),
            vehicles: z
              .array(
                z
                  .object({
                    year: text,
                    make: text,
                    model: text,
                    vin: text,
                  })
                  .strict(),
              )
              .max(100)
              .optional(),
          })
          .strict()
          .superRefine((line, context) => {
            const option = COVERAGE_OPTIONS.find(
              (candidate) => candidate.id === line.coverage,
            );
            const allowed: string[] = option?.limits.map((limit) => limit.key) ?? [];
            for (const [key, value] of Object.entries(line.limits)) {
              if (!allowed.includes(key))
                context.addIssue({
                  code: "custom",
                  path: ["limits", key],
                  message: `Limit key "${key}" is not valid for ${line.coverage}. ${allowed.length ? `Allowed: ${allowed.join(", ")}.` : "This coverage takes no limits."}`,
                });
              else if (!validCoverageLimit(key, value))
                context.addIssue({
                  code: "custom",
                  path: ["limits", key],
                  message: `${line.coverage} limit ${key} must be a positive dollar amount such as 1000000 or $1,000,000, or "${UNKNOWN_ANSWER}"; got ${JSON.stringify(value.slice(0, 40))}.`,
                });
            }
          }),
      )
      .max(20)
      .superRefine((lines, context) => {
        const ids = lines.map((line) => line.coverage);
        if (
          new Set(ids).size !== ids.length ||
          (ids.includes("unknown") && ids.length > 1)
        )
          context.addIssue({
            code: "custom",
            message:
              'List each coverage at most once; "unknown" cannot be combined with other coverages.',
          });
      })
      .optional(),
    limitsNote: text.optional(),
    scopeNote: text.optional(),
    additionalNote: text.optional(),
    hasClaims: z.enum(["yes", "no"]).optional(),
    hasCancellations: z.enum(["yes", "no"]).optional(),
    hasPlannedChanges: z.enum(["yes", "no"]).optional(),
  })
  .strict();

const archiveInformationQuestionIds = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(40)
  .describe(
    "Answered supplementary question IDs from get_procurement_information whose facts this update copies into the application; they are archived in the same write",
  );

export const procurementApplicationInputSchema = z
  .object({
    procurementRequestId: z.string(),
    expectedRevision: z.number().int().min(0),
    expectedUpdatedAt: z.number(),
    answers: applicationAnswers.optional(),
    details: applicationDetails.optional(),
    archiveInformationQuestionIds: archiveInformationQuestionIds.optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.keys(input.answers ?? {}).length +
        Object.keys(input.details ?? {}).length >
      0,
    "Supply at least one application field",
  );

const APPLICATION_NAMES = new Map<z.ZodType, string>([
  ...COMPANY_PROFILE_SHAPES.named,
  [location, "Location"],
]);

export const APPLICATION_SHAPES = {
  answers: applicationAnswers,
  details: applicationDetails,
  named: APPLICATION_NAMES,
};

/**
 * Model-facing input: `answers` and `details` are free-form objects in the
 * provider schema and validated strictly (see `describe_record_fields`).
 */
export const procurementApplicationToolInputSchema = z
  .object({
    procurementRequestId: z.string().trim().min(1),
    expectedRevision: z.number().int().min(0),
    expectedUpdatedAt: z.number(),
    answers: strictObjectField(applicationAnswers, {
      label: "answers",
      hint: `Changed text fields only. Keys: ${fieldNames(applicationAnswers).join(", ")}.`,
      named: APPLICATION_NAMES,
    }),
    details: strictObjectField(applicationDetails, {
      label: "details",
      hint: `Changed typed sections only; each supplied key replaces its whole value. Keys: ${fieldNames(applicationDetails).join(", ")}. Shapes and coverage limit keys: describe_record_fields.`,
      named: APPLICATION_NAMES,
    }),
    archiveInformationQuestionIds: archiveInformationQuestionIds
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .strict()
  .refine(
    (input) =>
      Object.keys(input.answers ?? {}).length +
        Object.keys(input.details ?? {}).length >
      0,
    "Supply at least one application field",
  );
