"use node";

import { z } from "zod";
import { sanitizeNulls } from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "./models";
import { normalizeExtractedString } from "./valueNormalization";
import { decideWithFallback } from "./decisions";
import { prepareFieldReviewQuestions } from "./extractionFieldQuestions";

type SourceLike = {
  id?: string;
  text?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  metadata?: Record<string, unknown>;
};

type FieldReviewGroup = {
  id: string;
  label: string;
  fields: string[];
  keywords: string[];
  instructions: string;
};

export type FieldReviewOptions = {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  document: Record<string, unknown>;
  sourceSpans: SourceLike[];
  log?: (message: string, level?: "info" | "warn" | "error") => Promise<void> | void;
};

type ReviewCorrection = {
  field: string;
  value: unknown;
  confidence: "high" | "medium" | "low";
  reason: string;
  evidenceQuote: string;
};

const CLEAR_FIELD_CORRECTION = { __clearFieldCorrection: true } as const;

function clearFieldCorrection() {
  return CLEAR_FIELD_CORRECTION;
}

function isClearFieldCorrection(value: unknown): value is typeof CLEAR_FIELD_CORRECTION {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __clearFieldCorrection?: unknown }).__clearFieldCorrection === true
  );
}

type ReviewResult = {
  groupId: string;
  corrections: ReviewCorrection[];
  reviewedFields?: readonly string[];
};

export type FieldReviewApplication = {
  document: Record<string, unknown>;
  applied: Array<ReviewCorrection & { groupId: string }>;
  skipped: Array<ReviewCorrection & { groupId: string; reasonSkipped: string }>;
  reviewedFieldCount: number;
};

const FIELD_REVIEW_GROUPS: FieldReviewGroup[] = [
  {
    id: "identity_and_period",
    label: "Identity and policy period",
    fields: [
      "carrier",
      "security",
      "brokerAgency",
      "policyNumber",
      "insuredName",
      "effectiveDate",
      "expirationDate",
    ],
    keywords: [
      "policy number",
      "named insured",
      "insured",
      "carrier",
      "insurer",
      "underwriter",
      "general agent",
      "managing general agent",
      "administrator",
      "broker",
      "effective",
      "expiration",
      "period",
    ],
    instructions:
      "Verify carrier/security, General Agent, Producer, policy number, named insured, and policy period fields. General Agent may be labeled MGA, managing general agent, program administrator, or administrator in the source document. Normalize source labels such as Broker or Agent to Producer; do not conflate either party with the insurer. Prefer declaration pages and schedule summaries over policy wording. For named insured, use rows explicitly labeled named insured/insured/applicant and do not use authorized officer contacts, notice contacts, producer names, signatures, incorporation/licensing statements, or corporate-authority wording as the insured.",
  },
  {
    id: "financial_terms",
    label: "Premiums, taxes, fees, and payment terms",
    fields: [
      "premium",
      "premiumAmount",
      "totalCost",
      "totalCostAmount",
      "minimumPremium",
      "minimumPremiumAmount",
      "depositPremium",
      "depositPremiumAmount",
      "premiumBreakdown",
      "taxesAndFees",
      "paymentPlan",
    ],
    keywords: [
      "premium",
      "annual premium",
      "total payable",
      "total cost",
      "tax",
      "fee",
      "surcharge",
      "minimum earned",
      "minimum premium",
      "deposit premium",
      "payment",
    ],
    instructions:
      "Verify all money-related fields. Prefer declaration/schedule tables over definitions, exclusions, application summaries, licensing statements, and premium-basis descriptions. Annual or term premium belongs in premium, total payable/due belongs in totalCost, minimum earned/deposit terms belong in minimumPremium/depositPremium, and itemized taxes/fees belong only in taxesAndFees. Percentage-only or rate-only terms are not currency amounts: preserve them as text in minimumPremium/depositPremium/paymentPlan and leave paired numeric amount fields null unless the source directly states a fixed currency amount. PremiumBreakdown rows should represent source-stated premium table rows with currency amounts; omit percentage-only terms from premiumBreakdown unless the row also states a currency amount. When correcting money fields, also correct the paired numeric amount field without currency symbols or commas when evidence directly states the number. Capture premium table rows as structured premiumBreakdown and taxesAndFees when source evidence contains rows but the current extraction missed them.",
  },
  {
    id: "coverage_terms",
    label: "Coverage limits and deductibles",
    fields: ["coverages", "limits", "deductibles", "coverageForm", "retroactiveDate"],
    keywords: [
      "limit",
      "deductible",
      "retention",
      "aggregate",
      "occurrence",
      "claim",
      "coverage",
      "retroactive",
    ],
    instructions:
      "Verify coverage names, limits, deductibles, retentions, aggregate/per-occurrence typing, coverage form, and retroactive date. Do not collapse distinct limits into one field. When correcting numeric coverage rows, include limitAmount and deductibleAmount as plain numbers only when the evidence directly states fixed numeric currency values.",
  },
];

const reviewRowSchema = z.object({
  line: z.string().nullable(),
  name: z.string().nullable(),
  amount: z.string().nullable(),
  amountValue: z.number().nullable(),
  type: z.string().nullable(),
  limit: z.string().nullable(),
  limitAmount: z.number().nullable(),
  limitType: z.string().nullable(),
  deductible: z.string().nullable(),
  deductibleAmount: z.number().nullable(),
  deductibleType: z.string().nullable(),
  formNumber: z.string().nullable(),
  pageNumber: z.number().nullable(),
  sectionRef: z.string().nullable(),
  originalContent: z.string().nullable(),
});

const fieldReviewSchema = z.object({
  corrections: z.array(z.object({
    field: z.string(),
    valueString: z.string().nullable(),
    valueNumber: z.number().nullable(),
    valueBoolean: z.boolean().nullable(),
    valueRows: z.array(reviewRowSchema).nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    reason: z.string(),
    evidenceQuote: z.string(),
  })),
});

const financialReconciliationSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  evidenceQuote: z.string().nullable(),
  premium: z.string().nullable(),
  premiumAmount: z.number().nullable(),
  totalCost: z.string().nullable(),
  totalCostAmount: z.number().nullable(),
  minimumPremium: z.string().nullable(),
  minimumPremiumAmount: z.number().nullable(),
  depositPremium: z.string().nullable(),
  depositPremiumAmount: z.number().nullable(),
  paymentPlan: z.string().nullable(),
  premiumRow: reviewRowSchema.nullable(),
  totalCostRow: reviewRowSchema.nullable(),
  minimumPremiumRow: reviewRowSchema.nullable(),
  premiumBreakdown: z.array(reviewRowSchema).nullable(),
  taxesAndFees: z.array(reviewRowSchema).nullable(),
});

const minimumPremiumSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  evidenceQuote: z.string().nullable(),
  minimumPremium: z.string().nullable(),
  minimumPremiumAmount: z.number().nullable(),
  depositPremium: z.string().nullable(),
  depositPremiumAmount: z.number().nullable(),
  clearMinimumPremiumAmount: z.boolean(),
  clearDepositPremium: z.boolean(),
  clearDepositPremiumAmount: z.boolean(),
});

const REVIEW_ROW_KEYS_BY_FIELD: Record<string, Set<string>> = {
  taxesAndFees: new Set(["name", "amount", "amountValue", "type", "description"]),
  premiumBreakdown: new Set(["line", "amount", "amountValue"]),
  coverages: new Set([
    "name",
    "limit",
    "limitAmount",
    "limitType",
    "deductible",
    "deductibleAmount",
    "deductibleType",
    "formNumber",
    "pageNumber",
    "sectionRef",
    "originalContent",
  ]),
};

function compactReviewRow(field: string, row: z.infer<typeof reviewRowSchema>) {
  const allowedKeys = REVIEW_ROW_KEYS_BY_FIELD[field];
  if (!allowedKeys) return null;
  const compacted = Object.fromEntries(
    Object.entries(row).filter(([key, value]) =>
      value !== null &&
      value !== undefined &&
      (!allowedKeys || allowedKeys.has(key)),
    ),
  );
  if (field === "coverages" && typeof compacted.name !== "string") return null;
  if (field === "taxesAndFees" && typeof compacted.name !== "string") return null;
  if (field === "premiumBreakdown" && typeof compacted.line !== "string") return null;
  return compacted;
}

function correctionValue(correction: z.infer<typeof fieldReviewSchema>["corrections"][number]) {
  if (correction.valueRows !== null) {
    if (!REVIEW_ROW_KEYS_BY_FIELD[correction.field]) return undefined;
    const rows = correction.valueRows
      .map((row) => compactReviewRow(correction.field, row))
      .filter((row) => row !== null);
    return rows.length > 0 ? rows : undefined;
  }
  if (correction.valueNumber !== null) return correction.valueNumber;
  if (correction.valueBoolean !== null) return correction.valueBoolean;
  return correction.valueString ?? undefined;
}

function sanitizeCorrectionValue(field: string, value: unknown) {
  if (!Array.isArray(value)) return value;
  if (!REVIEW_ROW_KEYS_BY_FIELD[field]) return undefined;
  const rows = value
    .map((row) => compactReviewRow(field, row as z.infer<typeof reviewRowSchema>))
    .filter((row) => row !== null);
  return rows.length > 0 ? rows : undefined;
}

function rowAmount(row: z.infer<typeof reviewRowSchema> | null | undefined) {
  return typeof row?.amount === "string" && row.amount.trim() ? row.amount.trim() : undefined;
}

function reviewMode() {
  const raw = process.env.EXTRACTION_FIELD_REVIEW_MODE;
  if (raw === "skip" || raw === "auto" || raw === "always") return raw;
  return "always";
}

function isMissingValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === "unknown" || normalized === "n/a" || normalized === "not applicable";
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function compactDocumentForGroup(document: Record<string, unknown>, group: FieldReviewGroup) {
  return Object.fromEntries(
    group.fields.map((field) => [field, document[field]]),
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function sectionEvidence(document: Record<string, unknown>) {
  const sections = Array.isArray(document.sections) ? document.sections : [];
  const evidence: SourceLike[] = [];
  for (const raw of sections) {
    const section = sanitizeNulls(raw) as Record<string, unknown>;
    const title = normalizeExtractedString(section.title);
    const content = normalizeExtractedString(section.content);
    if (title || content) {
      evidence.push({
        id: typeof section.recordId === "string" ? section.recordId : undefined,
        sectionId: typeof section.sectionNumber === "string" ? section.sectionNumber : undefined,
        pageStart: typeof section.pageStart === "number" ? section.pageStart : undefined,
        pageEnd: typeof section.pageEnd === "number" ? section.pageEnd : undefined,
        text: [title, content].filter(Boolean).join("\n"),
        metadata: { source: "document.sections" },
      });
    }
    if (Array.isArray(section.subsections)) {
      for (const rawSubsection of section.subsections) {
        const subsection = sanitizeNulls(rawSubsection) as Record<string, unknown>;
        const subsectionTitle = normalizeExtractedString(subsection.title);
        const subsectionContent = normalizeExtractedString(subsection.content);
        if (subsectionTitle || subsectionContent) {
          evidence.push({
            pageStart: typeof subsection.pageNumber === "number" ? subsection.pageNumber : undefined,
            sectionId: typeof subsection.sectionNumber === "string" ? subsection.sectionNumber : undefined,
            text: [subsectionTitle, subsectionContent].filter(Boolean).join("\n"),
            metadata: { source: "document.sections.subsections" },
          });
        }
      }
    }
  }
  return evidence;
}

function scoreEvidence(text: string, group: FieldReviewGroup) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const keyword of group.keywords) {
    if (lower.includes(keyword.toLowerCase())) score += 3;
  }
  for (const field of group.fields) {
    const spaced = field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    if (lower.includes(spaced.toLowerCase())) score += 1;
  }
  return score;
}

export function selectEvidenceForFieldGroup(params: {
  document: Record<string, unknown>;
  sourceSpans: SourceLike[];
  group: FieldReviewGroup;
  maxSnippets?: number;
}) {
  const candidates = [...sectionEvidence(params.document), ...params.sourceSpans]
    .map((source, index) => {
      const text = normalizeText(source.text);
      return {
        source,
        index,
        text,
        score: text ? scoreEvidence(text, params.group) : 0,
      };
    })
    .filter((item) => item.text && item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, params.maxSnippets ?? 8);

  return candidates.map((item, index) => ({
    id: item.source.id ?? item.source.sectionId ?? `evidence_${index + 1}`,
    pageStart: item.source.pageStart,
    pageEnd: item.source.pageEnd,
    text: item.text.slice(0, 1800),
  }));
}

function shouldReviewGroup(document: Record<string, unknown>, group: FieldReviewGroup, evidenceCount: number) {
  if (evidenceCount === 0) return false;
  if (reviewMode() === "always") return true;
  return group.fields.some((field) => isMissingValue(document[field]));
}

async function generateReviewObject<T>(
  options: FieldReviewOptions,
  params: {
    schema: z.ZodType<T>;
    maxOutputTokens: number;
    prompt: string;
    label: string;
  },
): Promise<T> {
  const result = await generateObjectForOrg(options.ctx, options.orgId, "extraction", {
    schema: params.schema,
    maxOutputTokens: params.maxOutputTokens,
    prompt: params.prompt,
  }, {
    taskKind: "extraction_review",
  });
  return result.output;
}

function financialEvidence(document: Record<string, unknown>, sourceSpans: SourceLike[]) {
  const group = FIELD_REVIEW_GROUPS.find((item) => item.id === "financial_terms");
  if (!group) return [];
  return selectEvidenceForFieldGroup({
    document,
    sourceSpans,
    group,
    maxSnippets: 10,
  });
}

function minimumPremiumEvidence(document: Record<string, unknown>, sourceSpans: SourceLike[]) {
  const direct = [...sectionEvidence(document), ...sourceSpans]
    .map((source, index) => ({ source, index, text: normalizeText(source.text) }))
    .filter((item) => {
      const lower = item.text.toLowerCase();
      return (
        lower.includes("minimum earned premium") ||
        lower.includes("minimum premium") ||
        lower.includes("deposit premium")
      );
    })
    .sort((a, b) => a.index - b.index)
    .map((item, index) => ({
      id: item.source.id ?? item.source.sectionId ?? `minimum_premium_evidence_${index + 1}`,
      pageStart: item.source.pageStart,
      pageEnd: item.source.pageEnd,
      text: item.text.slice(0, 1800),
    }));

  const seen = new Set<string>();
  return [...direct, ...financialEvidence(document, sourceSpans)]
    .filter((item) => {
      const key = item.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function hasEvidenceQuote(correction: ReviewCorrection) {
  const quote = normalizeText(correction.evidenceQuote);
  return quote.length >= 8;
}

function canApplyCorrection(document: Record<string, unknown>, group: FieldReviewGroup, correction: ReviewCorrection) {
  if (!group.fields.includes(correction.field)) return "field is not registered for this review group";
  if (correction.confidence === "low") return "confidence is low";
  if (!hasEvidenceQuote(correction)) return "missing source evidence quote";
  if (!isMissingValue(document[correction.field]) && correction.confidence !== "high") {
    return "replacing an existing value requires high confidence";
  }
  if (correction.value === undefined || correction.value === null) return "empty correction value";
  return null;
}

export function applyFieldReviewResults(
  document: Record<string, unknown>,
  reviews: ReviewResult[],
): FieldReviewApplication {
  const next = { ...document };
  const applied: FieldReviewApplication["applied"] = [];
  const skipped: FieldReviewApplication["skipped"] = [];
  const reviewedFields = new Set<string>();

  for (const review of reviews) {
    const group = FIELD_REVIEW_GROUPS.find((item) => item.id === review.groupId);
    if (!group) continue;
    for (const field of review.reviewedFields ?? group.fields) reviewedFields.add(field);
    for (const correction of review.corrections) {
      const normalizedCorrection = {
        ...correction,
        value: sanitizeCorrectionValue(correction.field, correction.value),
      };
      const reasonSkipped = canApplyCorrection(next, group, normalizedCorrection);
      if (reasonSkipped) {
        skipped.push({ ...normalizedCorrection, groupId: review.groupId, reasonSkipped });
        continue;
      }
      next[normalizedCorrection.field] = isClearFieldCorrection(normalizedCorrection.value)
        ? undefined
        : normalizedCorrection.value;
      reviewedFields.add(normalizedCorrection.field);
      applied.push({ ...normalizedCorrection, groupId: review.groupId });
    }
  }

  return { document: next, applied, skipped, reviewedFieldCount: reviewedFields.size };
}

async function reviewGroup(options: FieldReviewOptions, group: FieldReviewGroup) {
  const evidence = selectEvidenceForFieldGroup({
    document: options.document,
    sourceSpans: options.sourceSpans,
    group,
  });
  if (!shouldReviewGroup(options.document, group, evidence.length)) return null;

  const current = compactDocumentForGroup(options.document, group);
  const object = await generateReviewObject(options, {
    schema: fieldReviewSchema,
    maxOutputTokens: 2500,
    label: `Field review for ${group.label}`,
    prompt: `Review extracted insurance policy fields against source evidence.

Group: ${group.label}
Registered fields: ${group.fields.join(", ")}

Instructions:
${group.instructions}

Rules:
- Return corrections only for fields in Registered fields.
- Prefer source evidence over the current extracted value.
- Correct missing, Unknown, incomplete, or source-contradicted values.
- Do not invent. Every correction needs a short exact evidenceQuote from the provided evidence.
- Use confidence "high" only when the evidence directly states the value.
- Put exactly one value slot on each correction:
  valueString for string fields, valueNumber for numeric fields, valueBoolean for boolean fields, or valueRows for financial/coverage table rows. Set the unused value slots to null.
- Return an empty corrections array when evidence does not justify a change.

Current extracted fields:
${JSON.stringify(current, null, 2)}

Evidence:
${JSON.stringify(evidence, null, 2)}`,
  });

  return {
    groupId: group.id,
    reviewedFields: group.fields,
    corrections: object.corrections.flatMap((correction): ReviewCorrection[] => {
      const value = correctionValue(correction);
      if (value === undefined) return [];
      return [{
        field: correction.field,
        value,
        confidence: correction.confidence,
        reason: correction.reason,
        evidenceQuote: correction.evidenceQuote,
      }];
    }),
  };
}

async function reconcileFinancialTable(options: FieldReviewOptions): Promise<ReviewResult | null> {
  const evidence = financialEvidence(options.document, options.sourceSpans);
  if (evidence.length === 0) return null;

  const current = compactDocumentForGroup(
    options.document,
    FIELD_REVIEW_GROUPS.find((item) => item.id === "financial_terms")!,
  );
  const object = await generateReviewObject(options, {
    schema: financialReconciliationSchema,
    maxOutputTokens: 1800,
    label: "Financial table reconciliation",
    prompt: `Reconcile the policy premium table against source evidence.

Return the best source-backed financial fields for the policy. Use only rows and values directly supported by the evidence.

Rules:
- Annual or term premium belongs in premium and premiumAmount.
- Total payable/due belongs in totalCost and totalCostAmount.
- Itemized taxes and fees belong in taxesAndFees.
- Minimum earned premium, minimum premium, deposit premium, and payment-plan terms are not annual premium unless the source says so.
- Return premiumRow for the source row that states the annual or term premium.
- Return totalCostRow for the source row that states total payable, total due, or total cost.
- When the evidence contains a minimum earned, minimum premium, or deposit premium row, set minimumPremium or depositPremium to that row's value.
- Percentage-only or rate-only terms must stay textual. Do not convert percentages or rates into currency amounts.
- Put a numeric amount field only when the source directly states a fixed currency amount.
- Return minimumPremiumRow when the premium table has a minimum earned or minimum premium row. For percentage-only rows, put the exact row value in amount and leave amountValue null.
- premiumBreakdown should include source-stated premium table rows with currency amounts for premium/payable rows, using the source row label as line.
- Do not put tax or fee rows in premiumBreakdown when they are already represented in taxesAndFees.
- Exclude percentage-only rows from premiumBreakdown unless they also state a fixed currency amount.
- Return confidence high only when the evidence directly states the corrected values.

Current extracted fields:
${JSON.stringify(current, null, 2)}

Evidence:
${JSON.stringify(evidence, null, 2)}`,
  });

  if (object.confidence === "low" || !normalizeText(object.evidenceQuote)) {
    return {
      groupId: "financial_terms",
      corrections: [],
      reviewedFields: FIELD_REVIEW_GROUPS.find((item) => item.id === "financial_terms")?.fields ?? [],
    };
  }

  const corrections: ReviewCorrection[] = [];
  const add = (field: string, value: unknown) => {
    if (value === null || value === undefined) return;
    corrections.push({
      field,
      value,
      confidence: object.confidence,
      reason: "Reconciled financial table from source evidence.",
      evidenceQuote: object.evidenceQuote ?? "",
    });
  };

  const premium = rowAmount(object.premiumRow) ?? object.premium;
  const totalCost = rowAmount(object.totalCostRow) ?? object.totalCost;
  const minimumPremium = object.minimumPremium ?? rowAmount(object.minimumPremiumRow);

  add("premium", premium);
  add("premiumAmount", object.premiumAmount);
  add("totalCost", totalCost);
  add("totalCostAmount", object.totalCostAmount);
  add("minimumPremium", minimumPremium);
  add("minimumPremiumAmount", object.minimumPremiumAmount);
  add("depositPremium", object.depositPremium);
  add("depositPremiumAmount", object.depositPremiumAmount);
  add("paymentPlan", object.paymentPlan);
  add("premiumBreakdown", object.premiumBreakdown);
  add("taxesAndFees", object.taxesAndFees);
  if (minimumPremium && object.minimumPremiumAmount === null) add("minimumPremiumAmount", clearFieldCorrection());
  if (minimumPremium && object.depositPremium === null) add("depositPremium", clearFieldCorrection());
  if (minimumPremium && object.depositPremiumAmount === null) add("depositPremiumAmount", clearFieldCorrection());

  return {
    groupId: "financial_terms",
    corrections,
    reviewedFields: FIELD_REVIEW_GROUPS.find((item) => item.id === "financial_terms")?.fields ?? [],
  };
}

async function reconcileMinimumPremium(options: FieldReviewOptions): Promise<ReviewResult | null> {
  const evidence = minimumPremiumEvidence(options.document, options.sourceSpans);
  if (evidence.length === 0) return null;

  const object = await generateReviewObject(options, {
    schema: minimumPremiumSchema,
    maxOutputTokens: 900,
    label: "Minimum premium reconciliation",
    prompt: `Find the policy's minimum earned premium, minimum premium, or deposit premium term from the source evidence.

Rules:
- Return only source-stated minimum earned premium, minimum premium, or deposit premium terms.
- Prefer declaration or premium-table rows over policy wording, definitions, examples, conditions, applications, or licensing statements.
- If any evidence contains a declaration or premium-table row labeled as a minimum earned, minimum premium, or deposit premium term, return that row's exact value in the matching field.
- A percentage-only term is text, not a currency amount. Do not convert percentages into currency amounts.
- Set minimumPremiumAmount or depositPremiumAmount only when the source directly states a fixed currency amount for that row.
- If the current minimumPremiumAmount is a stale conversion from a percentage-only term, set clearMinimumPremiumAmount true.
- If the current depositPremium/depositPremiumAmount came from the same minimum earned premium percentage row and the evidence does not separately state a deposit premium, set clearDepositPremium and clearDepositPremiumAmount true.
- Otherwise set clearMinimumPremiumAmount, clearDepositPremium, and clearDepositPremiumAmount false.
- Use confidence high only when the evidence directly states the value.

Current values:
${JSON.stringify({
  minimumPremium: options.document.minimumPremium ?? options.document.minPremium,
  minimumPremiumAmount: options.document.minimumPremiumAmount ?? options.document.minPremiumAmount,
  depositPremium: options.document.depositPremium,
  depositPremiumAmount: options.document.depositPremiumAmount,
}, null, 2)}

Evidence:
${JSON.stringify(evidence, null, 2)}`,
  });

  if (object.confidence === "low" || !normalizeText(object.evidenceQuote)) {
    return {
      groupId: "financial_terms",
      corrections: [],
      reviewedFields: ["minimumPremium", "minimumPremiumAmount", "depositPremium", "depositPremiumAmount"],
    };
  }

  const corrections: ReviewCorrection[] = [];
  const add = (field: string, value: unknown) => {
    if (value === null || value === undefined) return;
    corrections.push({
      field,
      value,
      confidence: object.confidence,
      reason: "Reconciled minimum premium term from source evidence.",
      evidenceQuote: object.evidenceQuote ?? "",
    });
  };

  add("minimumPremium", object.minimumPremium);
  add("minimumPremiumAmount", object.minimumPremiumAmount);
  add("depositPremium", object.depositPremium);
  add("depositPremiumAmount", object.depositPremiumAmount);
  if (object.clearMinimumPremiumAmount) add("minimumPremiumAmount", clearFieldCorrection());
  if (object.clearDepositPremium) add("depositPremium", clearFieldCorrection());
  if (object.clearDepositPremiumAmount) add("depositPremiumAmount", clearFieldCorrection());

  return {
    groupId: "financial_terms",
    corrections,
    reviewedFields: ["minimumPremium", "minimumPremiumAmount", "depositPremium", "depositPremiumAmount"],
  };
}

async function reviewExtractionFieldsWithReasoning(
  options: FieldReviewOptions,
): Promise<FieldReviewApplication> {
  const reviews: ReviewResult[] = [];
  for (const group of FIELD_REVIEW_GROUPS) {
    try {
      const review = await reviewGroup(options, group);
      if (review) reviews.push(review);
    } catch (error) {
      await options.log?.(
        `Field review failed for ${group.label}: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
    }
  }
  try {
    const review = await reconcileFinancialTable(options);
    if (review) reviews.push(review);
  } catch (error) {
    await options.log?.(
      `Financial table reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
  }
  try {
    const review = await reconcileMinimumPremium(options);
    if (review) reviews.push(review);
  } catch (error) {
    await options.log?.(
      `Minimum premium reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
  }

  const applied = applyFieldReviewResults(options.document, reviews);
  if (applied.applied.length > 0) {
    await options.log?.(
      `Field review applied ${applied.applied.length} correction${applied.applied.length === 1 ? "" : "s"} across ${new Set(applied.applied.map((item) => item.groupId)).size} group${new Set(applied.applied.map((item) => item.groupId)).size === 1 ? "" : "s"}`,
      "info",
    );
  }
  return applied;
}

export async function reviewExtractionFields(
  options: FieldReviewOptions,
): Promise<FieldReviewApplication> {
  if (reviewMode() === "skip") {
    return {
      document: options.document,
      applied: [],
      skipped: [],
      reviewedFieldCount: 0,
    };
  }
  const fallback = () => reviewExtractionFieldsWithReasoning(options);
  const groups = FIELD_REVIEW_GROUPS.filter((group) => {
    const evidence = selectEvidenceForFieldGroup({ ...options, group });
    // Financial and minimum-premium reconciliation also run in auto mode.
    return group.id === "financial_terms"
      ? financialEvidence(options.document, options.sourceSpans).length > 0
      : shouldReviewGroup(options.document, group, evidence.length);
  });
  const plan = prepareFieldReviewQuestions({ ...options, groups });
  if (!plan) return fallback();
  return decideWithFallback({
    ctx: options.ctx,
    orgId: options.orgId,
    family: "extraction.field_review",
    state: plan.state,
    questions: plan.questions,
    requiredQuestionIds: plan.requiredQuestionIds,
    accept: (answers) => {
      const changes = plan.accept(answers);
      if (!changes) return undefined;
      const reviews: ReviewResult[] = groups.map((group) => ({
        groupId: group.id,
        reviewedFields: group.fields,
        corrections: changes
          .filter((change) => group.fields.includes(change.field))
          .map((change) => ({
            field: change.field,
            value: change.value,
            // This existing enum enables the apply guard only after the shared
            // family threshold, raw .99 evidence floors and citation checks pass.
            confidence: "high" as const,
            evidenceQuote: change.evidenceQuote,
            reason: `Selected explicit source evidence ${change.sourceId}.`,
          })),
      }));
      return applyFieldReviewResults(options.document, reviews);
    },
    fallback,
  });
}
