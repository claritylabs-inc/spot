import { v } from "convex/values";
export const intakeAddressValidator = v.object({
  longitude: v.optional(v.number()),
  latitude: v.optional(v.number()),
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});
export const intakeDetailsValidator = v.object({
  companyResearchSource: v.optional(v.string()),
  prefillSourceIds: v.optional(v.array(v.string())),
  coverages: v.array(
    v.object({
      coverage: v.union(
        v.literal("unknown"),
        v.literal("general_liability"),
        v.literal("property"),
        v.literal("workers_compensation"),
        v.literal("commercial_auto"),
        v.literal("professional_liability"),
        v.literal("cyber"),
        v.literal("umbrella"),
        v.literal("other"),
      ),
      limits: v.record(v.string(), v.string()),
      additionalCoverages: v.optional(v.string()),
      scopeDescription: v.optional(v.string()),
      properties: v.optional(
        v.array(
          v.object({
            name: v.optional(v.string()),
            address: intakeAddressValidator,
            details: v.string(),
            activitiesPrefilled: v.optional(v.boolean()),
            ownership: v.optional(
              v.union(v.literal("owned"), v.literal("leased")),
            ),
            staff: v.optional(v.string()),
          }),
        ),
      ),
      vehicles: v.optional(
        v.array(
          v.object({
            year: v.string(),
            make: v.string(),
            model: v.string(),
            vin: v.string(),
          }),
        ),
      ),
    }),
  ),
  mailingAddress: intakeAddressValidator,
  registrationCountry: v.optional(v.string()),
  registrationState: v.optional(v.string()),
  registrationAddress: v.optional(intakeAddressValidator),
  mailingAddressStep: v.optional(v.boolean()),
  mailingSameAsRegistered: v.optional(
    v.union(v.literal("yes"), v.literal("no")),
  ),
  hasCancellations: v.optional(v.union(v.literal("yes"), v.literal("no"))),
  hasPlannedChanges: v.optional(v.union(v.literal("yes"), v.literal("no"))),
  hasClaims: v.optional(v.union(v.literal("yes"), v.literal("no"))),
  operatingLocationPrefilled: v.optional(v.boolean()),
  locations: v.array(
    v.object({
      name: v.optional(v.string()),
      address: intakeAddressValidator,
      details: v.string(),
      activitiesPrefilled: v.optional(v.boolean()),
      ownership: v.optional(v.union(v.literal("owned"), v.literal("leased"))),
      staff: v.optional(v.string()),
    }),
  ),
  relatedEntities: v.array(
    v.object({
      legalName: v.string(),
      relationship: v.string(),
      insured: v.union(
        v.literal(""),
        v.literal("include"),
        v.literal("exclude"),
        v.literal("unsure"),
      ),
    }),
  ),
  relatedEntitiesNote: v.string(),
  hasRelatedEntities: v.optional(v.union(v.literal("yes"), v.literal("no"))),
  limitsNote: v.optional(v.string()),
  scopeNote: v.optional(v.string()),
  additionalNote: v.optional(v.string()),
  dateInput: v.optional(v.string()),
  dateParts: v.object({ year: v.string(), month: v.string(), day: v.string() }),
  revenueStep: v.optional(v.union(v.literal("annual"), v.literal("projected"))),
  revenue: v.optional(
    v.object({
      annualPeriod: v.string(),
      annualAmount: v.string(),
      projectedPeriod: v.string(),
      projectedAmount: v.string(),
    }),
  ),
  coverageIndex: v.number(),
});
