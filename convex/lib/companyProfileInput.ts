import { z } from "zod";

const text = z.string().max(8000);
const address = z
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
  .strict();

/** Partial company edits; omitted fields retain their current values. */
export const companyProfileInputSchema = z
  .object({
    orgId: z.string(),
    expectedVersion: z.number().int().min(0),
    answers: z
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
      .strict()
      .optional(),
    details: z
      .object({
        mailingAddress: address.optional(),
        registrationAddress: address.optional(),
        registrationCountry: text.optional(),
        registrationState: text.optional(),
        mailingSameAsRegistered: z.enum(["yes", "no"]).optional(),
        locations: z
          .array(
            z
              .object({
                name: text.optional(),
                address,
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
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.keys(input.answers ?? {}).length +
        Object.keys(input.details ?? {}).length >
      0,
    "Supply at least one company field",
  );
