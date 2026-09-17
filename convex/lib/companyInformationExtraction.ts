import { v } from "convex/values";

import { ORG_WIKI_SECTIONS } from "./orgWiki";

// Retained for historical source contributions; new profile edits are explicit.

export const companyInformationTextFactValidator = v.object({
  value: v.string(),
  confidence: v.number(),
  evidence: v.string(),
});

export const companyInformationProfileValidator = v.object({
  namedInsured: v.union(companyInformationTextFactValidator, v.null()),
  mailingAddress: v.union(
    v.object({
      value: v.object({
        street1: v.union(v.string(), v.null()),
        street2: v.union(v.string(), v.null()),
        city: v.union(v.string(), v.null()),
        state: v.union(v.string(), v.null()),
        zip: v.union(v.string(), v.null()),
        country: v.union(v.string(), v.null()),
        formatted: v.union(v.string(), v.null()),
      }),
      confidence: v.number(),
      evidence: v.string(),
    }),
    v.null(),
  ),
  dba: v.union(companyInformationTextFactValidator, v.null()),
  entityType: v.union(
    v.object({
      value: v.union(
        v.literal("sole_proprietorship"),
        v.literal("partnership"),
        v.literal("corporation"),
        v.literal("s_corporation"),
        v.literal("limited_liability_company"),
        v.literal("trust_estate"),
        v.literal("tax_exempt_organization"),
        v.literal("government_entity"),
        v.literal("other"),
      ),
      confidence: v.number(),
      evidence: v.string(),
    }),
    v.null(),
  ),
  fein: v.union(companyInformationTextFactValidator, v.null()),
  businessNumber: v.union(companyInformationTextFactValidator, v.null()),
  operationsDescription: v.union(companyInformationTextFactValidator, v.null()),
  additionalNamedInsureds: v.array(companyInformationTextFactValidator),
});

const wikiSectionValidator = v.union(
  ...ORG_WIKI_SECTIONS.map(([key]) => v.literal(key)),
);

export const companyInformationOrganizationFactValidator = v.object({
  section: wikiSectionValidator,
  content: v.string(),
  confidence: v.number(),
});
