import { z } from "zod";

const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);
const website = z
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//.test(value), "URL must use http or https");
const country = z
  .string()
  .describe("ISO two-letter country code, e.g. US or CA");
const region = z
  .string()
  .describe("Two-letter US state/DC or Canadian province/territory code");
const line = z
  .string()
  .describe("Exact ACORD LOBCd, e.g. CGL, PROP, AUTOB; empty list if unknown");

export const brokerProfileFields = {
  networkStatus: optional(
    z.enum(["prospect", "active", "inactive", "blacklisted"]).describe(
      "prospect = Cold; active = Active Relationship; inactive = contacted without an established relationship, uses cold copy; blacklisted = Do Not Contact, blocks outreach",
    ),
  ),
  officeAddress: optional(
    z.object({
      street1: optional(z.string().max(300)),
      street2: optional(z.string().max(300)),
      city: optional(z.string().max(200)),
      state: optional(z.string().max(100)),
      postalCode: optional(z.string().max(40)),
      country: optional(z.string().max(100)),
    }),
  ),
  writingCountries: optional(z.array(country).max(250)).describe(
    "Replacement countries; removal clears dependent regions.",
  ),
  nationwideCountries: optional(z.array(country).max(250)).describe(
    "Explicitly evidenced nationwide service; never infer from licensing or empty regions.",
  ),
  excludedStates: optional(z.array(region).max(64)).describe(
    "Exceptions within nationwide countries.",
  ),
  writingStates: optional(z.array(region).max(64)),
  lineOfBusinessCodes: optional(z.array(line).max(100)),
};
export const brokerCreateInput = z.object({
  name: z.string().trim().min(1).max(200),
  website: optional(website),
  ...brokerProfileFields,
});
export const brokerProfilePatch = z
  .object({
    ...brokerProfileFields,
    name: optional(z.string().trim().min(1).max(200)),
    website: website
      .nullish()
      .describe("Omit to preserve; null explicitly clears the website."),
    evidence: optional(z.string().min(1).max(800)).describe(
      "Supporting source URLs or mailbox evidence; retained in audit input.",
    ),
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) =>
          key !== "evidence" && key !== "brokerOrgId" && value !== undefined,
      ),
    "At least one provider profile field is required",
  );
export const brokerUpdateInput = brokerProfilePatch.safeExtend({
  brokerOrgId: z.string().min(1),
});
export const ensureBrokerProfilesInput = z.object({
  items: z
    .array(
      z
        .object({
          ...brokerProfileFields,
          name: optional(z.string().trim().min(1).max(200)),
          domain: optional(z.string().trim().min(1).max(253)).describe(
            "Provider hostname; used before exact-name matching.",
          ),
          website: optional(website),
        })
        .refine(
          (item) => !!(item.name || item.domain || item.website),
          "Supply a provider name, domain or website",
        ),
    )
    .min(1)
    .max(50),
  attachToProcurementRequestId: optional(z.string().min(1)).describe(
    "Create missing tracking rows for this request; never sends email.",
  ),
});
export const updateBrokerProfilesInput = z
  .object({
    items: z
      .array(z.object({ orgId: z.string().min(1), patch: brokerProfilePatch }))
      .min(1)
      .max(50),
  })
  .refine(
    (input) =>
      new Set(input.items.map((item) => item.orgId)).size ===
      input.items.length,
    "Include each provider only once per update batch",
  );
