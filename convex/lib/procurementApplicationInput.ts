import { z } from "zod";
import { companyProfileInputSchema } from "./companyProfileInput";
import { INTAKE_FIELDS } from "../../lib/insurance-intake";

const text = z.string().max(8000);
const companyDetails = companyProfileInputSchema.shape.details.unwrap();
const location = companyDetails.shape.locations.unwrap().element;
export const procurementApplicationInputSchema = z
  .object({
    procurementRequestId: z.string(),
    expectedRevision: z.number().int().min(0),
    expectedUpdatedAt: z.number(),
    answers: z
      .partialRecord(
        z.enum(
          Object.keys(INTAKE_FIELDS).filter(
            (key) =>
              ![
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
              ].includes(key),
          ) as [
            keyof typeof INTAKE_FIELDS,
            ...Array<keyof typeof INTAKE_FIELDS>,
          ],
        ),
        text,
      )
      .optional(),
    details: companyDetails
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
              .strict(),
          )
          .max(20)
          .optional(),
        limitsNote: text.optional(),
        scopeNote: text.optional(),
        additionalNote: text.optional(),
        hasClaims: z.enum(["yes", "no"]).optional(),
        hasCancellations: z.enum(["yes", "no"]).optional(),
        hasPlannedChanges: z.enum(["yes", "no"]).optional(),
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
    "Supply at least one application field",
  );
