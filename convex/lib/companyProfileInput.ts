import { z } from "zod";
import { fieldNames, strictObjectField } from "./operatorToolFieldCatalog";

const text = z.string().max(8000);
export const companyAddressSchema = z
  .object({
    street1: text.optional(),
    street2: text.optional(),
    city: text.optional(),
    state: text.optional(),
    zip: text.optional(),
    country: text.optional(),
    formatted: text.optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .strict()
  .superRefine((address, context) => {
    const { latitude, longitude } = address;
    if (
      (latitude === undefined) !== (longitude === undefined) ||
      (latitude !== undefined && Math.abs(latitude) > 90) ||
      (longitude !== undefined && Math.abs(longitude) > 180)
    )
      context.addIssue({
        code: "custom",
        message:
          "Coordinates need both latitude (-90 to 90) and longitude (-180 to 180), or neither.",
      });
  });

const companyAnswers = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    website: z.union([z.literal(""), z.url().max(500)]).optional(),
    dba: text.optional(),
    entityType: text.optional(),
    fein: text.optional(),
    businessNumber: text.optional(),
    industry: text.optional(),
    industryVertical: text.optional(),
    description: text.optional(),
    yearStarted: text.optional(),
    fullTime: text.optional(),
    partTime: text.optional(),
    contractors: text.optional(),
  })
  .strict();

const companyDetails = z
  .object({
    mailingAddress: companyAddressSchema.optional(),
    registrationAddress: companyAddressSchema.optional(),
    registrationCountry: text.optional(),
    registrationState: text.optional(),
    mailingSameAsRegistered: z.enum(["yes", "no"]).optional(),
    locations: z
      .array(
        z
          .object({
            name: text.optional(),
            address: companyAddressSchema,
            details: text,
            ownership: z.enum(["owned", "leased"]).optional(),
            staff: text.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    relatedEntities: z
      .array(
        z
          .object({
            legalName: text,
            relationship: text,
            insured: z.enum(["", "include", "exclude", "unsure"]),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    relatedEntitiesNote: text.optional(),
    hasRelatedEntities: z.enum(["yes", "no"]).optional(),
    revenue: z
      .object({
        annualPeriod: text,
        annualAmount: text,
        projectedPeriod: text,
        projectedAmount: text,
      })
      .strict()
      .optional(),
    techStack: z
      .object({
        paymentProcessors: z.array(z.string().trim().min(1).max(200)).max(30),
        hostingProviders: z.array(z.string().trim().min(1).max(200)).max(30),
        dataCountries: z.array(z.string().trim().min(1).max(200)).max(30),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Partial company edits; omitted fields retain their current values. */
export const companyProfileInputSchema = z
  .object({
    orgId: z.string(),
    expectedVersion: z.number().int().min(0),
    answers: companyAnswers.optional(),
    details: companyDetails.optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.keys(input.answers ?? {}).length +
        Object.keys(input.details ?? {}).length >
      0,
    "Supply at least one company field",
  );

export const COMPANY_PROFILE_SHAPES = {
  answers: companyAnswers,
  details: companyDetails,
  named: new Map<z.ZodType, string>([[companyAddressSchema, "Address"]]),
};

/**
 * Model-facing input: `answers` and `details` are free-form objects in the
 * provider schema and validated strictly (see `describe_record_fields`).
 */
export const companyProfileToolInputSchema = z
  .object({
    orgId: z.string().trim().min(1),
    expectedVersion: z.number().int().min(0),
    answers: strictObjectField(companyAnswers, {
      label: "answers",
      hint: `Changed text fields only. Keys: ${fieldNames(companyAnswers).join(", ")}.`,
      named: COMPANY_PROFILE_SHAPES.named,
    }),
    details: strictObjectField(companyDetails, {
      label: "details",
      hint: `Changed typed sections only; each supplied key replaces its whole value. Keys: ${fieldNames(companyDetails).join(", ")}. Shapes: describe_record_fields.`,
      named: COMPANY_PROFILE_SHAPES.named,
    }),
  })
  .strict()
  .refine(
    (input) =>
      Object.keys(input.answers ?? {}).length +
        Object.keys(input.details ?? {}).length >
      0,
    "Supply at least one company field",
  );
