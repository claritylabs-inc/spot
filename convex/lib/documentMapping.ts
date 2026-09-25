"use node";

/**
 * Maps between cl-sdk InsuranceDocument types and Spot's policies table schema.
 *
 * Replaces the removed applyExtracted adapter from cl-sdk v0.1.x
 * and the old toPolicy adapter from agentPrompts.ts.
 */

import type {
  InsuranceDocument,
  PolicyDocument,
} from "@claritylabs/cl-sdk";
import { sanitizeNulls } from "@claritylabs/cl-sdk";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import {
  declarationFieldValue,
  normalizeCriticalString,
  normalizePolicyDate,
  resolvePolicyPeriod,
} from "./policyPeriodExtraction";
import {
  normalizeExtractedDate,
  normalizeExtractedDateFields,
  normalizeExtractedString,
} from "./valueNormalization";
import { policyLobCodes, toLobCodes } from "./linesOfBusiness";

dayjs.extend(customParseFormat);

function normalizeCoverageValues(rawCoverages: unknown): unknown[] {
  if (!Array.isArray(rawCoverages)) return [];
  return rawCoverages.map((rawCoverage) => {
    const coverage = sanitizeNulls(rawCoverage) as Record<string, unknown>;
    const limitAmount =
      typeof coverage.limitAmount === "number"
        ? coverage.limitAmount
        : undefined;
    const deductibleAmount =
      typeof coverage.deductibleAmount === "number"
        ? coverage.deductibleAmount
        : undefined;
    return {
      ...coverage,
      ...(coverage.limit
        ? { limit: normalizeExtractedString(coverage.limit) ?? coverage.limit }
        : {}),
      ...(limitAmount !== undefined ? { limitAmount } : {}),
      ...(coverage.deductible
        ? { deductible: normalizeExtractedString(coverage.deductible) ?? coverage.deductible }
        : {}),
      ...(deductibleAmount !== undefined ? { deductibleAmount } : {}),
      ...(coverage.retroactiveDate
        ? {
          retroactiveDate:
            normalizeExtractedDate(coverage.retroactiveDate) ?? coverage.retroactiveDate,
        }
        : {}),
    };
  });
}

function normalizeMoneyRows<T extends Record<string, unknown>>(
  rows: unknown,
  labelKey: keyof T,
): T[] | undefined {
  if (!Array.isArray(rows)) return undefined;
  const normalized = rows
    .map((row) => sanitizeNulls(row) as T)
    .map((row) => {
      const amountValue =
        typeof row.amountValue === "number" ? row.amountValue : undefined;
      return {
        ...row,
        [labelKey]: normalizeExtractedString(row[labelKey]) ?? String(row[labelKey] ?? ""),
        ...(typeof row.amount === "string" ? { amount: row.amount } : {}),
        ...(amountValue !== undefined ? { amountValue } : {}),
      } as T;
    })
    .filter((row) => normalizeExtractedString(row[labelKey]) || normalizeExtractedString(row.amount));
  return normalized.length ? normalized : undefined;
}

function normalizeOrgName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().replace(/\s+/g, " ");
  return value || undefined;
}

function policyYearFromDate(value: unknown): number {
  const normalized = normalizePolicyDate(value);
  if (!normalized) return dayjs().year();
  const parsed = dayjs(
    normalized,
    ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD", "YYYY/M/D"],
    true,
  );
  return parsed.isValid() ? parsed.year() : dayjs().year();
}

/**
 * Map an InsuranceDocument (extraction output) to Spot's policies table fields.
 * This is the forward mapping: SDK extraction → Convex mutation args.
 */
export function insuranceDocToPolicy(
  doc: InsuranceDocument,
): Record<string, unknown> {
  const d = doc as any;
  const linesOfBusiness =
    Array.isArray(d.linesOfBusiness) && d.linesOfBusiness.length > 0
      ? toLobCodes(d.linesOfBusiness)
      : toLobCodes();
  const declarationPolicyNumber = declarationFieldValue(d.declarations, [
    "policyNumber",
  ]);
  const resolvedPeriod = resolvePolicyPeriod(d, []);
  const effectiveDate =
    normalizePolicyDate(d.effectiveDate) || resolvedPeriod?.effectiveDate;
  const expirationDate =
    normalizePolicyDate(d.expirationDate) || resolvedPeriod?.expirationDate;
  const premium = normalizeExtractedString(d.premium);
  const totalCost = normalizeExtractedString(d.totalCost);
  const premiumAmount =
    typeof d.premiumAmount === "number" ? d.premiumAmount : undefined;
  const totalCostAmount =
    typeof d.totalCostAmount === "number" ? d.totalCostAmount : undefined;

  const fields: Record<string, unknown> = {
    carrier:
      normalizeOrgName(d.carrier) || normalizeOrgName(d.security) || "Unknown",
    security: normalizeOrgName(d.security) ?? undefined,
    underwriter: d.underwriter ?? undefined,
    broker: normalizeOrgName(d.brokerAgency) ?? undefined,
    policyNumber: normalizeCriticalString(d.policyNumber) || declarationPolicyNumber || "Unknown",
    linesOfBusiness,
    documentType: "policy",
    policyYear: policyYearFromDate(effectiveDate),
    effectiveDate: effectiveDate || "Unknown",
    expirationDate: expirationDate ?? "Unknown",
    isRenewal: d.isRenewal ?? false,
    coverages: normalizeCoverageValues(d.coverages),
    premium,
    ...(premiumAmount !== undefined ? { premiumAmount } : {}),
    totalCost,
    ...(totalCostAmount !== undefined ? { totalCostAmount } : {}),
    insuredName: d.insuredName || "Unknown",
    summary: d.summary ?? undefined,
  };

  // Enriched entity fields
  if (d.carrierLegalName) fields.carrierLegalName = d.carrierLegalName;
  if (d.carrierNaicNumber) fields.carrierNaicNumber = d.carrierNaicNumber;
  if (d.carrierAmBestRating) fields.carrierAmBestRating = d.carrierAmBestRating;
  if (d.carrierAdmittedStatus)
    fields.carrierAdmittedStatus = d.carrierAdmittedStatus;
  if (d.brokerAgency) fields.brokerAgency = normalizeOrgName(d.brokerAgency);
  if (d.brokerContactName) fields.brokerContactName = d.brokerContactName;
  if (d.brokerLicenseNumber) fields.brokerLicenseNumber = d.brokerLicenseNumber;
  // Structured entity objects (cl-sdk 0.11+)
  if (d.insurer) fields.insurer = sanitizeNulls(d.insurer);
  if (d.producer) fields.producer = sanitizeNulls(d.producer);
  if (d.generalAgent) fields.generalAgent = sanitizeNulls(d.generalAgent);
  if (d.lossPayees?.length) fields.lossPayees = sanitizeNulls(d.lossPayees);
  if (d.mortgageHolders?.length)
    fields.mortgageHolders = sanitizeNulls(d.mortgageHolders);
  if (d.priorPolicyNumber) fields.priorPolicyNumber = d.priorPolicyNumber;
  if (d.programName) fields.programName = d.programName;
  if (d.isPackage != null) fields.isPackage = d.isPackage;

  // Insured details
  if (d.insuredDba) fields.insuredDba = d.insuredDba;
  if (d.insuredAddress) fields.insuredAddress = sanitizeNulls(d.insuredAddress);
  if (d.insuredEntityType) fields.insuredEntityType = d.insuredEntityType;
  if (d.insuredFein) fields.insuredFein = d.insuredFein;
  if (d.additionalNamedInsureds?.length) {
    fields.additionalNamedInsureds = sanitizeNulls(d.additionalNamedInsureds);
  }

  // Coverage structure
  if (d.coverageForm) fields.coverageForm = d.coverageForm;
  if (d.retroactiveDate)
    fields.retroactiveDate = normalizeExtractedDate(d.retroactiveDate) ?? d.retroactiveDate;
  if (d.effectiveTime) fields.effectiveTime = d.effectiveTime;
  if (d.limits) fields.limits = sanitizeNulls(d.limits);
  if (d.deductibles) fields.deductibles = sanitizeNulls(d.deductibles);

  // Schedules
  if (d.locations?.length) fields.locations = sanitizeNulls(d.locations);
  if (d.vehicles?.length) fields.vehicles = sanitizeNulls(d.vehicles);
  if (d.classifications?.length)
    fields.classifications = sanitizeNulls(d.classifications);
  if (d.coverageSchedules?.length)
    fields.coverageSchedules = sanitizeNulls(d.coverageSchedules);
  if (d.formInventory?.length)
    fields.formInventory = sanitizeNulls(d.formInventory);
  const taxesAndFees = normalizeMoneyRows(d.taxesAndFees, "name");
  if (taxesAndFees) fields.taxesAndFees = taxesAndFees;
  const premiumBreakdown = normalizeMoneyRows(d.premiumBreakdown, "line");
  if (premiumBreakdown) fields.premiumBreakdown = premiumBreakdown;
  const minimumPremium = normalizeExtractedString(d.minimumPremium);
  if (Object.prototype.hasOwnProperty.call(d, "minimumPremium")) {
    fields.minPremium = minimumPremium || undefined;
  }
  const minPremiumAmount =
    typeof d.minimumPremiumAmount === "number"
      ? d.minimumPremiumAmount
      : undefined;
  if (Object.prototype.hasOwnProperty.call(d, "minimumPremiumAmount")) {
    fields.minPremiumAmount = minPremiumAmount;
  }
  const depositPremium = normalizeExtractedString(d.depositPremium);
  if (Object.prototype.hasOwnProperty.call(d, "depositPremium")) {
    fields.depositPremium = depositPremium || undefined;
  }
  const depositPremiumAmount =
    typeof d.depositPremiumAmount === "number"
      ? d.depositPremiumAmount
      : undefined;
  if (Object.prototype.hasOwnProperty.call(d, "depositPremiumAmount")) {
    fields.depositPremiumAmount = depositPremiumAmount;
  }

  // Document structure (sections, endorsements, definitions, covered reasons, conditions, exclusions)
  const document: Record<string, unknown> = {};
  fields.documentMetadata = sanitizeNulls(d.documentMetadata ?? {});
  fields.documentOutline = sanitizeNulls(d.documentOutline ?? []);
  if (d.sections?.length) document.sections = sanitizeNulls(d.sections);
  if (d.definitions?.length)
    document.definitions = sanitizeNulls(d.definitions);
  if (d.coveredReasons?.length)
    document.coveredReasons = sanitizeNulls(d.coveredReasons);
  if (d.endorsements?.length)
    document.endorsements = sanitizeNulls(d.endorsements);
  if (d.exclusions?.length) document.exclusions = sanitizeNulls(d.exclusions);
  if (d.conditions?.length) document.conditions = sanitizeNulls(d.conditions);
  if (Object.keys(document).length > 0) fields.document = document;

  // Declarations
  if (d.declarations) fields.declarations = sanitizeNulls(d.declarations);

  // Supplementary facts (cl-sdk 0.13+)
  if (d.supplementaryFacts?.length)
    fields.supplementaryFacts = sanitizeNulls(d.supplementaryFacts);

  if (d.policyTermType) fields.policyTermType = d.policyTermType;
  if (d.nextReviewDate)
    fields.nextReviewDate = normalizeExtractedDate(d.nextReviewDate) ?? d.nextReviewDate;

  return normalizeExtractedDateFields(fields) as Record<string, unknown>;
}

/**
 * Map a Spot policies Doc to an InsuranceDocument (SDK type).
 * This is the reverse mapping: Convex Doc → SDK interface.
 * Used by DocumentStore.get/query and agent context building.
 */
export function policyToInsuranceDoc(p: any): InsuranceDocument {
  const base = {
    id: p._id as string,
    carrier: p.carrier,
    security: p.security,
    insuredName: p.insuredName,
    premium: p.premium,
    totalCost: p.totalCost,
    summary: p.summary,
    linesOfBusiness: policyLobCodes(p),
    coverages: (p.coverages as unknown[]) || [],
    effectiveDate: p.effectiveDate,
    expirationDate: p.expirationDate,
    // Enriched entity
    carrierLegalName: p.carrierLegalName,
    carrierNaicNumber: p.carrierNaicNumber,
    carrierAmBestRating: p.carrierAmBestRating,
    carrierAdmittedStatus: p.carrierAdmittedStatus,
    generalAgent: p.generalAgent as unknown,
    underwriter: p.underwriter,
    brokerAgency: p.brokerAgency,
    brokerContactName: p.brokerContactName,
    brokerLicenseNumber: p.brokerLicenseNumber,
    priorPolicyNumber: p.priorPolicyNumber,
    programName: p.programName,
    isRenewal: p.isRenewal,
    isPackage: p.isPackage,
    // Structured entities (cl-sdk 0.11+)
    insurer: p.insurer as unknown,
    producer: p.producer as unknown,
    lossPayees: p.lossPayees as unknown,
    mortgageHolders: p.mortgageHolders as unknown,
    // Insured details
    insuredDba: p.insuredDba,
    insuredAddress: p.insuredAddress as unknown,
    insuredEntityType: p.insuredEntityType,
    insuredFein: p.insuredFein,
    additionalNamedInsureds: p.additionalNamedInsureds as unknown,
    // Coverage structure
    coverageForm: p.coverageForm,
    retroactiveDate: p.retroactiveDate,
    effectiveTime: p.effectiveTime,
    limits: p.limits as unknown,
    deductibles: p.deductibles as unknown,
    // Schedules
    locations: p.locations as unknown,
    vehicles: p.vehicles as unknown,
    classifications: p.classifications as unknown,
    coverageSchedules: p.coverageSchedules as unknown,
    formInventory: p.formInventory as unknown,
    taxesAndFees: p.taxesAndFees as unknown,
    premiumBreakdown: p.premiumBreakdown as unknown,
    minimumPremium: p.minPremium,
    depositPremium: p.depositPremium,
    // Source-tree projections
    documentMetadata: p.documentMetadata as unknown,
    documentOutline: p.documentOutline as unknown,
    // Declarations
    declarations: p.declarations as unknown,
    // Supplementary facts (cl-sdk 0.13+)
    supplementaryFacts: p.supplementaryFacts as unknown,
  };

  return {
    ...base,
    type: "policy" as const,
    policyNumber: p.policyNumber,
    policyTermType: p.policyTermType as unknown,
    nextReviewDate: p.nextReviewDate,
  } as PolicyDocument;
}
