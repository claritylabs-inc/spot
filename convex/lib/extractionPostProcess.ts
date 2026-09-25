"use node";

import dayjs from "dayjs";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { scopeCoveragesWithClassifier } from "./coverageScoping";
import { insuranceDocToPolicy } from "./documentMapping";
import { applyPolicyPeriodFallback } from "./policyPeriodExtraction";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";

type SourceSpanLike = {
  text?: string;
  pageStart?: number;
  pageEnd?: number;
  id?: string;
  sectionId?: string;
  metadata?: Record<string, unknown>;
};

type ExtractionPostProcessOptions = {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  document: Record<string, unknown>;
  sourceSpans: SourceSpanLike[];
  traceId?: string;
  policyId?: Id<"policies"> | string;
  /** Accepted for compatibility; model review passes were removed. */
  runModelReview?: boolean;
  log?: (message: string, level?: "info" | "warn" | "error") => Promise<void> | void;
};

/** Retained result shape; post-extraction model review no longer runs. */
export type FieldReviewApplication = {
  document: Record<string, unknown>;
  applied: Array<{ field: string }>;
  skipped: Array<{ field: string }>;
  reviewedFieldCount: number;
};

export type ExtractionPostProcessResult = {
  document: Record<string, unknown>;
  fields: Record<string, unknown>;
  fieldReview: FieldReviewApplication;
  coverageReviewQuestionCount: number;
};

const MAX_GROUNDING_QUESTIONS = 40;
const MAX_CITED_TEXT_CHARS = 1_400;
const MAX_ORG_NAME_CANDIDATES = 6;

const SOURCE_GROUNDED_IDENTITY_FIELDS = [
  "carrier",
  "security",
  "carrierLegalName",
  "carrierNaicNumber",
  "carrierAmBestRating",
  "carrierAdmittedStatus",
  "underwriter",
  "broker",
  "brokerAgency",
  "brokerContactName",
  "brokerLicenseNumber",
  "programName",
  "policyNumber",
  "quoteNumber",
  "priorPolicyNumber",
  "insuredName",
  "insuredDba",
  "insuredFein",
] as const;

const SOURCE_GROUNDED_PARTY_FIELDS = {
  insurer: ["legalName", "naicNumber", "amBestRating", "amBestNumber", "admittedStatus", "stateOfDomicile", "address"],
  producer: ["agencyName", "contactName", "licenseNumber", "phone", "email", "address"],
  generalAgent: ["agencyName", "licenseNumber", "address"],
} as const;

const SOURCE_GROUNDED_ADDRESS_FIELDS = [
  "street1",
  "street2",
  "city",
  "state",
  "zip",
  "country",
] as const;

const SOURCE_PROVENANCE_FIELDS = [
  "sourceSpanIds",
  "documentNodeId",
  "sourceTextHash",
  "pageStart",
  "pageEnd",
] as const;

const SOURCE_BACKED_IDENTITY_FIELDS = [
  "insuredAddress",
  "additionalNamedInsureds",
  "claimsContacts",
  "regulatoryContacts",
  "thirdPartyAdministrators",
  "additionalInsureds",
  "lossPayees",
  "mortgageHolders",
] as const;

const SOURCE_PROVENANCE_FIELD_SET = new Set<string>(SOURCE_PROVENANCE_FIELDS);
const LOW_VALUE_IDENTITY_FIELD_SET = new Set(["role", "relationship", "type", "kind", "label", "status"]);

type RemovedSourceSensitiveValue = {
  field: string;
  value: string;
};

/** A critical value that failed exact matching, with the source text it cites. */
export type GroundingClaim = {
  key: string;
  field: string;
  value: string;
  citedText: string;
};

type SourceGroundingStats = {
  sensitiveFieldCount: number;
  verified: ReadonlySet<string>;
  claims: GroundingClaim[];
};

export function groundingClaimKey(field: string, value: unknown) {
  return `${field}\u0000${String(value)}`;
}

function normalizedSourceEvidence(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderSourceValue(value: string) {
  return /^(?:unknown|n\/a|na|none|not applicable|not available)$/i.test(value.trim());
}

function sourceTextCorpus(sourceSpans: SourceSpanLike[]) {
  return normalizedSourceEvidence(
    sourceSpans
      .map((span) => typeof span.text === "string" ? span.text : "")
      .filter(Boolean)
      .join("\n"),
  );
}

function knownSourceSpanIds(sourceSpans: SourceSpanLike[]) {
  const ids = new Set<string>();
  for (const span of sourceSpans) {
    if (typeof span.id === "string" && span.id.trim()) ids.add(span.id);
    if (typeof span.sectionId === "string" && span.sectionId.trim()) ids.add(span.sectionId);
  }
  return ids;
}

function sourceSpanTextById(sourceSpans: SourceSpanLike[]) {
  const textById = new Map<string, string>();
  const append = (id: string | undefined, text: string) => {
    if (!id?.trim()) return;
    textById.set(id, [textById.get(id), text].filter(Boolean).join("\n"));
  };

  for (const span of sourceSpans) {
    const text = typeof span.text === "string" ? span.text : "";
    append(span.id, text);
    append(span.sectionId, text);
  }
  return textById;
}

function provenanceSourceSpanIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>).sourceSpanIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

function hasValidSourceProvenance(value: unknown, knownIds: Set<string>) {
  const ids = provenanceSourceSpanIds(value);
  if (ids.length === 0) return false;
  if (knownIds.size === 0) return false;
  return ids.some((id) => knownIds.has(id));
}

function sourceCorpusForProvenance(value: unknown, textById: Map<string, string>) {
  return normalizedSourceEvidence(
    provenanceSourceSpanIds(value)
      .map((id) => textById.get(id) ?? "")
      .filter(Boolean)
      .join("\n"),
  );
}

function sourceEvidenceCandidates(value: string) {
  const trimmed = value.trim();
  const withoutParentheticals = trimmed.replace(/\s*\([^)]*\)/g, " ");
  const withoutTrailingDescriptors = withoutParentheticals
    .replace(/\b(?:a\s+division\s+of|division\s+of|administered\s+by|issued\s+by)\b.*$/i, "")
    .trim();
  const beforeMetadataDelimiter =
    withoutTrailingDescriptors.split(/\s[-–—|]\s/)[0]?.trim() ?? withoutTrailingDescriptors;

  return Array.from(new Set([
    trimmed,
    withoutParentheticals,
    withoutTrailingDescriptors,
    beforeMetadataDelimiter,
  ]
    .map(normalizedSourceEvidence)
    .filter((candidate) => candidate.length >= 3)));
}

function sourceSupportsScalarValue(value: unknown, corpus: string) {
  if (typeof value === "string") {
    if (!value.trim() || isPlaceholderSourceValue(value)) return true;
    return sourceEvidenceCandidates(value).some((candidate) => corpus.includes(candidate));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = normalizedSourceEvidence(String(value));
    return candidate.length > 0 && corpus.includes(candidate);
  }
  return true;
}

function sourceSupportsAddressValue(value: string, corpus: string) {
  const normalized = normalizedSourceEvidence(value);
  if (!normalized || isPlaceholderSourceValue(value)) return true;
  if (normalized.length < 3) {
    return ` ${corpus} `.includes(` ${normalized} `);
  }
  return sourceSupportsScalarValue(value, corpus);
}

function displayRemovedValue(value: unknown) {
  const display = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : JSON.stringify(value);
  if (!display) return "";
  return display.length > 120 ? `${display.slice(0, 117)}...` : display;
}

function sourceClaimValues(value: unknown) {
  const claims: unknown[] = [];

  const collect = (item: unknown, key?: string) => {
    if (item === undefined || item === null) return;
    if (key && (SOURCE_PROVENANCE_FIELD_SET.has(key) || LOW_VALUE_IDENTITY_FIELD_SET.has(key))) return;

    if (typeof item === "string") {
      if (normalizedSourceEvidence(item).length >= 3 && !isPlaceholderSourceValue(item)) claims.push(item);
      return;
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      claims.push(item);
      return;
    }

    if (Array.isArray(item)) {
      for (const child of item) collect(child);
      return;
    }

    if (typeof item === "object") {
      for (const [childKey, childValue] of Object.entries(item as Record<string, unknown>)) {
        collect(childValue, childKey);
      }
    }
  };

  collect(value);
  return claims;
}

function hasSourceSupportedClaim(value: unknown, textById: Map<string, string>) {
  const corpus = sourceCorpusForProvenance(value, textById);
  if (!corpus) return false;
  return sourceClaimValues(value).some((claim) => sourceSupportsScalarValue(claim, corpus));
}

function copySourceProvenance(record: Record<string, unknown>) {
  const provenance: Record<string, unknown> = {};
  for (const key of SOURCE_PROVENANCE_FIELDS) {
    if (record[key] !== undefined && record[key] !== null) {
      provenance[key] = record[key];
    }
  }
  return provenance;
}

function sourceGroundedAddress(
  field: string,
  value: unknown,
  corpus: string,
  removed: RemovedSourceSensitiveValue[],
  stats: SourceGroundingStats,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    stats.sensitiveFieldCount += 1;
    removed.push({ field, value: displayRemovedValue(value) });
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, string> = {};
  for (const key of SOURCE_GROUNDED_ADDRESS_FIELDS) {
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    stats.sensitiveFieldCount += 1;
    if (typeof raw === "string" && sourceSupportsAddressValue(raw, corpus)) {
      next[key] = raw;
    } else {
      removed.push({ field: `${field}.${key}`, value: displayRemovedValue(raw) });
    }
  }
  return next.street1 ? next : undefined;
}

function sourceGroundedPartyObject(
  field: keyof typeof SOURCE_GROUNDED_PARTY_FIELDS,
  value: unknown,
  corpus: string,
  sourceSpanIds: Set<string>,
  sourceTextById: Map<string, string>,
  removed: RemovedSourceSensitiveValue[],
  stats: SourceGroundingStats,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    stats.sensitiveFieldCount += 1;
    removed.push({ field, value: displayRemovedValue(value) });
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!hasValidSourceProvenance(record, sourceSpanIds)) {
    stats.sensitiveFieldCount += 1;
    removed.push({ field, value: "missing or invalid source spans" });
    return undefined;
  }
  const allowedFields = SOURCE_GROUNDED_PARTY_FIELDS[field];
  const primaryField = allowedFields[0];
  const primaryValue = record[primaryField];
  const recordCorpus = sourceCorpusForProvenance(record, sourceTextById) || corpus;
  const primaryKey = groundingClaimKey(`${field}.${primaryField}`, primaryValue);
  if (
    typeof primaryValue !== "string" ||
    !primaryValue.trim() ||
    !(sourceSupportsScalarValue(primaryValue, recordCorpus) || stats.verified.has(primaryKey))
  ) {
    stats.sensitiveFieldCount += 1;
    removed.push({ field, value: displayRemovedValue(record[primaryField] ?? value) });
    if (typeof primaryValue === "string" && primaryValue.trim()) {
      stats.claims.push({
        key: primaryKey,
        field: `${field}.${primaryField}`,
        value: primaryValue,
        citedText: provenanceSourceSpanIds(record)
          .map((id) => sourceTextById.get(id) ?? "")
          .join("\n")
          .slice(0, MAX_CITED_TEXT_CHARS),
      });
    }
    return undefined;
  }

  const next: Record<string, unknown> = copySourceProvenance(record);
  for (const key of allowedFields) {
    const raw = record[key];
    if (raw === undefined || raw === null) continue;
    if (key === "address") {
      const address = sourceGroundedAddress(`${field}.address`, raw, recordCorpus, removed, stats);
      if (address) next.address = address;
      continue;
    }
    stats.sensitiveFieldCount += 1;
    if (sourceSupportsScalarValue(raw, recordCorpus)) {
      next[key] = raw;
    } else {
      removed.push({ field: `${field}.${key}`, value: displayRemovedValue(raw) });
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function sourceBackedIdentityValue(
  field: string,
  value: unknown,
  sourceSpanIds: Set<string>,
  sourceTextById: Map<string, string>,
  removed: RemovedSourceSensitiveValue[],
  stats: SourceGroundingStats,
) {
  if (Array.isArray(value)) {
    const kept = value.filter((item, index) => {
      stats.sensitiveFieldCount += 1;
      if (
        hasValidSourceProvenance(item, sourceSpanIds) &&
        hasSourceSupportedClaim(item, sourceTextById)
      ) {
        return true;
      }
      const reason = hasValidSourceProvenance(item, sourceSpanIds)
        ? "source span does not support value"
        : "missing or invalid source spans";
      removed.push({ field: `${field}[${index}]`, value: reason });
      return false;
    });
    return kept.length > 0 || value.length === 0 ? kept : undefined;
  }

  stats.sensitiveFieldCount += 1;
  if (hasValidSourceProvenance(value, sourceSpanIds) && hasSourceSupportedClaim(value, sourceTextById)) {
    return value;
  }
  const removedValue = hasValidSourceProvenance(value, sourceSpanIds)
    ? "source span does not support value"
    : "missing or invalid source spans";
  removed.push({ field, value: removedValue });
  return undefined;
}

/** The source span that best covers the value's words, windowed around them. */
function nearestSourceText(sourceSpans: SourceSpanLike[], value: string) {
  const tokens = [...new Set(normalizedSourceEvidence(value).split(" "))]
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return "";
  let best: { text: string; score: number } | undefined;
  for (const span of sourceSpans) {
    const text = typeof span.text === "string" ? span.text : "";
    const words = new Set(normalizedSourceEvidence(text).split(" "));
    const score = tokens.filter((token) => words.has(token)).length;
    if (
      score > 0 &&
      (!best || score > best.score || (score === best.score && text.length < best.text.length))
    ) {
      best = { text, score };
    }
  }
  if (!best || best.score < Math.ceil(tokens.length / 2)) return "";
  const anchor = [...tokens].sort((left, right) => right.length - left.length)[0]!;
  const index = Math.max(0, best.text.toLowerCase().indexOf(anchor));
  return best.text.slice(
    Math.max(0, index - MAX_CITED_TEXT_CHARS / 2),
    index + MAX_CITED_TEXT_CHARS / 2,
  );
}

/**
 * Removes critical identity values that the source text does not contain. Values
 * in `verified` (confirmed by the grounding classifier) are kept; unsupported
 * critical values with nearby source text are returned as `claims` to verify.
 */
export function stripUngroundedSourceSensitiveValues<T extends Record<string, unknown>>(
  value: T,
  sourceSpans: SourceSpanLike[],
  verified: ReadonlySet<string> = new Set(),
): {
  value: T;
  removed: RemovedSourceSensitiveValue[];
  sensitiveFieldCount: number;
  claims: GroundingClaim[];
} {
  const corpus = sourceTextCorpus(sourceSpans);
  const sourceSpanIds = knownSourceSpanIds(sourceSpans);
  const sourceTextById = sourceSpanTextById(sourceSpans);
  const next: Record<string, unknown> = { ...value };
  const removed: RemovedSourceSensitiveValue[] = [];
  const stats: SourceGroundingStats = { sensitiveFieldCount: 0, verified, claims: [] };

  for (const field of SOURCE_GROUNDED_IDENTITY_FIELDS) {
    const raw = next[field];
    if (raw === undefined || raw === null) continue;
    stats.sensitiveFieldCount += 1;
    const key = groundingClaimKey(field, raw);
    if (sourceSupportsScalarValue(raw, corpus) || verified.has(key)) continue;
    removed.push({ field, value: displayRemovedValue(raw) });
    delete next[field];
    if (typeof raw === "string" || typeof raw === "number") {
      stats.claims.push({
        key,
        field,
        value: String(raw),
        citedText: nearestSourceText(sourceSpans, String(raw)),
      });
    }
  }

  for (const field of SOURCE_BACKED_IDENTITY_FIELDS) {
    if (next[field] === undefined || next[field] === null) continue;
    const grounded = sourceBackedIdentityValue(field, next[field], sourceSpanIds, sourceTextById, removed, stats);
    if (grounded !== undefined) {
      next[field] = grounded;
    } else {
      delete next[field];
    }
  }

  for (const field of Object.keys(SOURCE_GROUNDED_PARTY_FIELDS) as Array<keyof typeof SOURCE_GROUNDED_PARTY_FIELDS>) {
    if (next[field] === undefined || next[field] === null) continue;
    const party = sourceGroundedPartyObject(field, next[field], corpus, sourceSpanIds, sourceTextById, removed, stats);
    if (party) {
      next[field] = party;
    } else {
      delete next[field];
    }
  }

  return {
    value: next as T,
    removed,
    sensitiveFieldCount: stats.sensitiveFieldCount,
    claims: stats.claims.filter((claim) => claim.citedText.trim()),
  };
}

async function logRemovedSourceSensitiveValues(
  removed: RemovedSourceSensitiveValue[],
  log?: ExtractionPostProcessOptions["log"],
) {
  const seen = new Set<string>();
  for (const item of removed) {
    const key = `${item.field}:${item.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await log?.(
      `Dropped ungrounded extracted ${item.field}: ${item.value || "value not present in source spans"}`,
      "warn",
    );
  }
}

async function verifyGroundingClaims(
  options: ExtractionPostProcessOptions,
  claims: GroundingClaim[],
): Promise<Set<string>> {
  const batch = claims.slice(0, MAX_GROUNDING_QUESTIONS);
  if (batch.length === 0) return new Set();
  try {
    const result = await clRouterDecide({
      orgId: String(options.orgId),
      task: "policy_extraction_grounding",
      state: {
        claims: Object.fromEntries(batch.map((claim, index) => [`claim_${index}`, {
          field: claim.field,
          value: claim.value,
          citedText: claim.citedText,
        }])),
      },
      questions: Object.fromEntries(batch.map((claim, index) => [`claim_${index}`, {
        type: "noul" as const,
        instructions: `Does claims.claim_${index}.citedText state claims.claim_${index}.value as the policy's ${claim.field}? Formatting, casing, abbreviation, punctuation, or OCR differences are acceptable; a different, partial, or merely implied value is not.`,
        criteria: {
          true: "The cited text supports the value.",
          false: "The cited text does not support the value.",
        },
      }])),
      trace: options.traceId ? { traceId: options.traceId } : undefined,
    }, { telemetry: options.ctx });
    return new Set(batch.flatMap((claim, index) => {
      const answer = result.answers[`claim_${index}`];
      return answer?.type === "noul" && jevProceeds(answer.noul)
        ? [claim.key]
        : [];
    }));
  } catch (error) {
    await options.log?.(
      `Grounding classifier unavailable; dropping unmatched values (${error instanceof Error ? error.message : String(error)})`,
      "warn",
    );
    return new Set();
  }
}

/**
 * Distinct verbatim spellings in the source text that match a shortened form of
 * the name, or a mixed-case form of an all-caps name.
 */
export function sourceNameSpellings(value: string, sourceSpans: SourceSpanLike[]) {
  const extracted = value.replace(/\s+/g, " ").trim();
  const extractedIsUpperCase = extracted === extracted.toUpperCase();
  const spellings = new Set<string>();
  for (const variant of sourceEvidenceCandidates(value)) {
    const body = variant
      .split(" ")
      .map((token) => (token === "and" ? "(?:and|&)" : token))
      .join("[^A-Za-z0-9]*");
    const pattern = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "gi");
    for (const span of sourceSpans) {
      for (const match of (span.text ?? "").matchAll(pattern)) {
        const spelling = match[0].replace(/\s+/g, " ").trim();
        const shorter = normalizedSourceEvidence(spelling) !== normalizedSourceEvidence(extracted);
        const recased = extractedIsUpperCase && spelling !== spelling.toUpperCase();
        if (shorter || recased) spellings.add(spelling);
      }
    }
  }
  return [...spellings].slice(0, MAX_ORG_NAME_CANDIDATES);
}

const ORG_NAME_FIELDS = [
  { key: "carrier", role: "insurance carrier" },
  { key: "security", role: "security (risk-bearing insurer)" },
  { key: "broker", role: "broker" },
  { key: "brokerAgency", role: "broker agency" },
  { key: "generalAgent.agencyName", role: "general agent" },
] as const;

function orgNameValue(fields: Record<string, unknown>, key: string) {
  const [field, child] = key.split(".");
  const value = child
    ? (fields[field!] && typeof fields[field!] === "object" && !Array.isArray(fields[field!])
      ? (fields[field!] as Record<string, unknown>)[child]
      : undefined)
    : fields[field!];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Jev picks a concise display spelling for organization names among spellings
 * found verbatim in the source text; low confidence keeps the extracted value.
 */
async function normalizeOrgNamesWithClassifier(
  options: ExtractionPostProcessOptions,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const pending = ORG_NAME_FIELDS.flatMap(({ key, role }, index) => {
    const extracted = orgNameValue(fields, key);
    const candidates = extracted ? sourceNameSpellings(extracted, options.sourceSpans) : [];
    return extracted && candidates.length > 0
      ? [{ key, role, extracted, candidates, question: `organization_${index}` }]
      : [];
  });
  if (pending.length === 0) return fields;
  try {
    const result = await clRouterDecide({
      orgId: String(options.orgId),
      task: "policy_extraction_org_name",
      state: {
        organizations: Object.fromEntries(pending.map((item) => [item.question, {
          role: item.role,
          extracted: item.extracted,
        }])),
      },
      questions: Object.fromEntries(pending.map((item) => [item.question, {
        type: "choice" as const,
        instructions: `Choose the concise user-facing display name for the ${item.role} in organizations.${item.question}. Candidates are spellings found verbatim in the policy text. Prefer the canonical entity or brand name without legal disclaimers, "administered by" clauses, or parenthetical metadata. Choose keep_extracted when the extracted name is already the best display name.`,
        criteria: {
          keep_extracted: item.extracted,
          ...Object.fromEntries(item.candidates.map((candidate, index) => [
            `spelling_${index}`,
            candidate,
          ])),
        },
      }])),
      trace: options.traceId ? { traceId: options.traceId } : undefined,
    }, { telemetry: options.ctx });
    let next = fields;
    for (const item of pending) {
      const answer = result.answers[item.question];
      if (answer?.type !== "choice") continue;
      const confidence = Math.min(answer.confidence, answer.probabilities[answer.choice] ?? 0);
      const spelling = item.candidates[Number(answer.choice.replace("spelling_", ""))];
      if (!jevProceeds(confidence) || answer.choice === "keep_extracted" || !spelling) {
        continue;
      }
      const [field, child] = item.key.split(".");
      next = child
        ? { ...next, [field!]: { ...(next[field!] as Record<string, unknown>), [child]: spelling } }
        : { ...next, [field!]: spelling };
      await options.log?.(`Normalized ${item.role} name to "${spelling}" from source text`, "info");
    }
    return next;
  } catch (error) {
    await options.log?.(
      `Organization name classifier unavailable; keeping extracted names (${error instanceof Error ? error.message : String(error)})`,
      "warn",
    );
    return fields;
  }
}

function openReviewQuestionCount(fields: Record<string, unknown>) {
  return openExtractionReviewQuestions(fields.extractionReview).length;
}

export async function postProcessExtractionDocument(
  options: ExtractionPostProcessOptions,
): Promise<ExtractionPostProcessResult> {
  let document = options.document;

  const periodFallback = applyPolicyPeriodFallback(
    document,
    options.sourceSpans.map((span) => ({
      text: typeof span.text === "string" ? span.text : undefined,
      pageStart: typeof span.pageStart === "number" ? span.pageStart : undefined,
    })),
  );
  if (periodFallback.changed) {
    document = periodFallback.document;
    await options.log?.(
      `Policy period verified from source text: ${periodFallback.period?.effectiveDate} to ${periodFallback.period?.expirationDate}`,
      "info",
    );
  }

  // Exact/normalized matching first; the classifier only sees values that fail
  // it, and each value is asked about at most once across both passes.
  const verified = new Set<string>();
  const asked = new Set<string>();
  const ground = async <T extends Record<string, unknown>>(value: T) => {
    let grounded = stripUngroundedSourceSensitiveValues(value, options.sourceSpans, verified);
    const claims = grounded.claims.filter((claim) => !asked.has(claim.key));
    for (const claim of claims) asked.add(claim.key);
    const confirmed = await verifyGroundingClaims(options, claims);
    if (confirmed.size > 0) {
      for (const claim of claims) {
        if (!confirmed.has(claim.key)) continue;
        verified.add(claim.key);
        await options.log?.(
          `Kept ${claim.field} "${displayRemovedValue(claim.value)}": classifier verified it against cited source text`,
          "info",
        );
      }
      grounded = stripUngroundedSourceSensitiveValues(value, options.sourceSpans, verified);
    }
    await logRemovedSourceSensitiveValues(grounded.removed, options.log);
    return grounded;
  };

  const groundedDocument = await ground(document);
  document = groundedDocument.value;

  const scopedCoverage = await scopeCoveragesWithClassifier({
    ctx: options.ctx,
    orgId: options.orgId,
    fields: insuranceDocToPolicy(document as never),
    sourceSpans: options.sourceSpans,
    nowMs: dayjs().valueOf(),
    traceId: options.traceId,
  });
  if (scopedCoverage.classifiedCount > 0) {
    await options.log?.(
      `Coverage scoping assigned ${scopedCoverage.classifiedCount} coverage${scopedCoverage.classifiedCount === 1 ? "" : "s"} to a line of business`,
      "info",
    );
  }
  if (scopedCoverage.review.questions.length > 0) {
    await options.log?.(
      `Coverage scoping found ${scopedCoverage.review.questions.length} line-of-business question${scopedCoverage.review.questions.length === 1 ? "" : "s"} for review`,
      "warn",
    );
  }

  const fields = await normalizeOrgNamesWithClassifier(options, scopedCoverage.fields);
  const groundedFields = await ground(fields);
  const coverageReviewQuestionCount = openReviewQuestionCount(groundedFields.value);

  return {
    document,
    fields: groundedFields.value,
    fieldReview: { document, applied: [], skipped: [], reviewedFieldCount: 0 },
    coverageReviewQuestionCount,
  };
}

export function openExtractionReviewQuestions(value: unknown): Array<Record<string, unknown>> {
  const review = value as { questions?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(review?.questions)) return [];
  return review.questions.filter((question) =>
    typeof question.id === "string" &&
    question.status !== "confirmed" &&
    question.status !== "dismissed"
  );
}
