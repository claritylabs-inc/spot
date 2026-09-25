"use node";

import { z } from "zod";
import type { PolicySectionKind } from "../policySectioning";

/** Bump when section prompts or schemas change; binds section results to promotion. */
export const SECTION_EXTRACTOR_VERSION = "convex-sections-v1.0";

export const sectionCitationSchema = z.object({
  page: z.number().int(),
  quote: z.string(),
});

const citations = z.array(sectionCitationSchema);

export const citedValueSchema = z.object({
  value: z.string(),
  citations,
});

const addressSchema = z.object({
  street1: z.string().nullable(),
  street2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  country: z.string().nullable(),
});

export const COVERAGE_TERM_KINDS = [
  "each_claim_limit",
  "each_occurrence_limit",
  "each_loss_limit",
  "aggregate_limit",
  "sublimit",
  "retention",
  "deductible",
  "retroactive_date",
  "premium",
  "other",
] as const;

const coverageTermSchema = z.object({
  kind: z.enum(COVERAGE_TERM_KINDS).nullable(),
  label: z.string(),
  value: z.string(),
  appliesTo: z.string().nullable(),
  citations,
});

export const sectionCoverageSchema = z.object({
  name: z.string(),
  lineOfBusiness: z.string().nullable(),
  coverageCode: z.string().nullable(),
  limit: z.string().nullable(),
  deductible: z.string().nullable(),
  premium: z.string().nullable(),
  retroactiveDate: z.string().nullable(),
  formNumber: z.string().nullable(),
  limits: z.array(coverageTermSchema),
  citations,
});

export const FORM_TYPES = [
  "declarations",
  "coverage",
  "endorsement",
  "application",
  "notice",
  "other",
] as const;

const formReferenceSchema = z.object({
  formNumber: z.string(),
  editionDate: z.string().nullable(),
  title: z.string().nullable(),
  formType: z.enum(FORM_TYPES).nullable(),
  citations,
});

export const DECLARATION_PARTY_ROLES = [
  "named_insured",
  "additional_named_insured",
  "carrier",
  "insurer",
  "producer",
  "general_agent",
  "additional_insured",
  "loss_payee",
  "mortgage_holder",
  "other",
] as const;

const partySchema = z.object({
  role: z.enum(DECLARATION_PARTY_ROLES),
  name: z.string(),
  address: addressSchema.nullable(),
  naicNumber: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  citations,
});

const moneyLineSchema = z.object({
  line: z.string(),
  amount: z.string(),
  citations,
});

const taxFeeSchema = z.object({
  name: z.string(),
  amount: z.string(),
  type: z.enum(["tax", "fee", "surcharge", "assessment", "other"]).nullable(),
  citations,
});

export const declarationsSectionSchema = z.object({
  policyNumber: citedValueSchema.nullable(),
  namedInsured: citedValueSchema.nullable(),
  insurer: citedValueSchema.nullable(),
  broker: citedValueSchema.nullable(),
  effectiveDate: citedValueSchema.nullable(),
  expirationDate: citedValueSchema.nullable(),
  retroactiveDate: citedValueSchema.nullable(),
  programName: citedValueSchema.nullable(),
  operationsDescription: citedValueSchema.nullable(),
  premium: citedValueSchema.nullable(),
  totalCost: citedValueSchema.nullable(),
  premiumBreakdown: z.array(moneyLineSchema),
  taxesAndFees: z.array(taxFeeSchema),
  linesOfBusiness: z.array(z.string()),
  parties: z.array(partySchema),
  insuredDetails: z.array(
    z.object({
      field: z.enum(["dba", "entityType", "taxId"]),
      value: z.string(),
      citations,
    }),
  ),
  coverages: z.array(sectionCoverageSchema),
  forms: z.array(formReferenceSchema),
});

export const scheduleSectionSchema = z.object({
  schedules: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["vehicle", "property", "location", "other"]),
      description: z.string().nullable(),
      items: z.array(
        z.object({
          label: z.string(),
          description: z.string().nullable(),
          values: z.array(z.object({ label: z.string(), value: z.string() })),
          citations,
        }),
      ),
    }),
  ),
  coverages: z.array(sectionCoverageSchema),
});

export const coverageFormSectionSchema = z.object({
  forms: z.array(formReferenceSchema),
  coverages: z.array(sectionCoverageSchema),
  definitions: z.array(
    z.object({ term: z.string(), summary: z.string(), citations }),
  ),
  exclusions: z.array(
    z.object({ title: z.string(), summary: z.string(), citations }),
  ),
});

/** Matches cl-sdk EndorsementSchema.endorsementType. */
export const ENDORSEMENT_TYPES = [
  "additional_insured",
  "waiver_of_subrogation",
  "primary_noncontributory",
  "blanket_additional_insured",
  "loss_payee",
  "mortgage_holder",
  "broadening",
  "restriction",
  "exclusion",
  "amendatory",
  "notice_of_cancellation",
  "designated_premises",
  "classification_change",
  "schedule_update",
  "deductible_change",
  "limit_change",
  "territorial_extension",
  "other",
] as const;

export const ENDORSEMENT_PARTY_ROLES = [
  "additional_insured",
  "additional_named_insured",
  "loss_payee",
  "mortgage_holder",
  "certificate_holder",
  "notice_recipient",
  "other",
] as const;

export const endorsementSectionSchema = z.object({
  endorsements: z.array(
    z.object({
      formNumber: z.string().nullable(),
      editionDate: z.string().nullable(),
      title: z.string(),
      endorsementNumber: z.string().nullable(),
      endorsementType: z.enum(ENDORSEMENT_TYPES),
      supportStatus: z.enum(["supported", "excluded", "requires_review"]),
      summary: z.string(),
      citations,
      effectiveDate: citedValueSchema.nullable(),
      coverageChanges: z.array(
        z.object({
          action: z.enum(["added", "removed", "modified"]),
          coverage: sectionCoverageSchema,
        }),
      ),
      partyChanges: z.array(
        z.object({
          action: z.enum(["added", "removed"]),
          role: z.enum(ENDORSEMENT_PARTY_ROLES),
          name: z.string(),
          address: addressSchema.nullable(),
          scope: z.string().nullable(),
          citations,
        }),
      ),
      dateChanges: z.array(
        z.object({
          field: z.enum([
            "effective_date",
            "expiration_date",
            "retroactive_date",
            "other",
          ]),
          value: z.string(),
          citations,
        }),
      ),
      premiumChange: citedValueSchema.nullable(),
    }),
  ),
});

export const formsListSectionSchema = z.object({
  forms: z.array(formReferenceSchema),
});

export const invoiceSectionSchema = z.object({
  title: z.string().nullable(),
  summary: z.string(),
  citations,
  premium: citedValueSchema.nullable(),
  taxesAndFees: z.array(taxFeeSchema),
  totalCost: citedValueSchema.nullable(),
  amountDue: citedValueSchema.nullable(),
  dueDate: citedValueSchema.nullable(),
});

export const summarySectionSchema = z.object({
  title: z.string().nullable(),
  summary: z.string(),
  citations,
});

export const SECTION_OUTPUT_SCHEMAS = {
  declarations: declarationsSectionSchema,
  schedule: scheduleSectionSchema,
  forms_list: formsListSectionSchema,
  coverage_form: coverageFormSectionSchema,
  endorsement: endorsementSectionSchema,
  application: summarySectionSchema,
  invoice: invoiceSectionSchema,
  notice: summarySectionSchema,
  other: summarySectionSchema,
} satisfies Record<PolicySectionKind, z.ZodType>;

export type SectionCitation = z.infer<typeof sectionCitationSchema>;
export type CitedValue = z.infer<typeof citedValueSchema>;
export type SectionCoverage = z.infer<typeof sectionCoverageSchema>;
export type SectionFormReference = z.infer<typeof formReferenceSchema>;
export type DeclarationsSectionOutput = z.infer<typeof declarationsSectionSchema>;
export type ScheduleSectionOutput = z.infer<typeof scheduleSectionSchema>;
export type CoverageFormSectionOutput = z.infer<typeof coverageFormSectionSchema>;
export type EndorsementSectionOutput = z.infer<typeof endorsementSectionSchema>;
export type FormsListSectionOutput = z.infer<typeof formsListSectionSchema>;
export type InvoiceSectionOutput = z.infer<typeof invoiceSectionSchema>;
export type SummarySectionOutput = z.infer<typeof summarySectionSchema>;

export type SectionOutputByKind = {
  [K in PolicySectionKind]: z.infer<(typeof SECTION_OUTPUT_SCHEMAS)[K]>;
};

/**
 * Quote-only supplemental facts for procurement proposal documents: the
 * quote validity deadline plus binding/underwriting conditions. Unlike
 * section schemas, the model copies `sourceNodeIds`/`sourceSpanIds` directly
 * from the evidence it is supplied (already resolved by the section merge)
 * instead of returning `{page, quote}` citations to re-resolve.
 */
export const proposalEvidenceItemSchema = z.object({
  description: z.string().min(1).max(2000),
  category: z.string().max(200).nullable(),
  sourceNodeIds: z.array(z.string().min(1)).max(20),
  sourceSpanIds: z.array(z.string().min(1)).max(50),
  pageStart: z.number().int().positive().nullable(),
  pageEnd: z.number().int().positive().nullable(),
});

export const proposalQuoteTermsSchema = z.object({
  quoteExpirationDate: z.string().max(100).nullable(),
  quoteExpirationEvidence: proposalEvidenceItemSchema.nullable(),
  subjectivities: z.array(proposalEvidenceItemSchema).max(100),
  conditions: z.array(proposalEvidenceItemSchema).max(100),
});

export type ProposalEvidenceItem = z.infer<typeof proposalEvidenceItemSchema>;
export type ProposalQuoteTerms = z.infer<typeof proposalQuoteTermsSchema>;
