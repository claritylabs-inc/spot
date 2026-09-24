import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";
import {
  formatDocumentStructureForPrompt,
  formatSourceSpanLabel,
} from "./policyDocumentStructure";
import { coverageBreakdownForTool } from "./coverageBreakdown";

export type CertificateEndorsementKind =
  | "additional_insured"
  | "named_insured"
  | "waiver_of_subrogation"
  | "primary_non_contributory"
  | "loss_payee"
  | "mortgagee"
  | "special_wording"
  | "policy_change";

export type CertificateGateEvidence = {
  label: string;
  excerpt: string;
  sourceSpanIds?: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type CertificateGateVerdict =
  | {
      status: "allowed";
      requiredChanges: CertificateEndorsementKind[];
      evidence: CertificateGateEvidence[];
    }
  | {
      status: "held";
      reasonCode:
        | "policy_change_required"
        | "missing_policy_evidence"
        | "ambiguous_policy_evidence"
        | "conflicting_policy_evidence";
      reasonMessage: string;
      requiredChanges: CertificateEndorsementKind[];
      evidence: CertificateGateEvidence[];
    };

type SourceSpanLike = {
  spanId?: string;
  pageStart?: number;
  pageEnd?: number;
  text?: string;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type SourceNodeLike = {
  nodeId?: string;
  kind?: string;
  title?: string;
  description?: string;
  textExcerpt?: string;
  sourceSpanIds?: string[];
  pageStart?: number;
  pageEnd?: number;
  path?: string;
};

type EvidenceCorpusItem = {
  label: string;
  text: string;
  sourceSpanIds?: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type CertificateGateEvidenceItem = EvidenceCorpusItem & {
  evidenceId: string;
};

const ENDORSEMENT_PATTERNS: Array<{
  kind: CertificateEndorsementKind;
  pattern: RegExp;
}> = [
  {
    kind: "additional_insured",
    pattern: /\b(additional insured|addl\.?\s*insr|ai endorsement|named as insured|add .* as an insured)\b/i,
  },
  {
    kind: "named_insured",
    pattern: /\b(named insured|add .* as named insured|change insured name|insured name change)\b/i,
  },
  {
    kind: "waiver_of_subrogation",
    pattern: /\b(waiver of subrogation|subrogation waived|subr\s*wvd|wos)\b/i,
  },
  {
    kind: "primary_non_contributory",
    pattern: /\b(primary\s*(?:and|&)?\s*non[-\s]?contributory|primary non[-\s]?contributory|pnc)\b/i,
  },
  {
    kind: "loss_payee",
    pattern: /\b(loss payee|lender'?s loss payable)\b/i,
  },
  {
    kind: "mortgagee",
    pattern: /\b(mortgagee|mortgage holder|lender clause)\b/i,
  },
  {
    kind: "special_wording",
    pattern: /\b(special wording|specific wording|wording must say|description of operations|certificate wording)\b/i,
  },
  {
    kind: "policy_change",
    pattern: /\b(endorsement required|requires endorsement|policy change|change request|amend policy|modify policy)\b/i,
  },
];



export const EVIDENCE_GATED_ENDORSEMENTS: CertificateEndorsementKind[] = [
  "additional_insured",
  "waiver_of_subrogation",
  "primary_non_contributory",
  "loss_payee",
  "mortgagee",
];

export const AUTO_HELD_ENDORSEMENTS: CertificateEndorsementKind[] = [
  "named_insured",
  "special_wording",
  "policy_change",
];

export function isEvidenceGatedOnly(kinds: CertificateEndorsementKind[]) {
  return kinds.length > 0
    ? kinds.every((kind) => EVIDENCE_GATED_ENDORSEMENTS.includes(kind))
    : false;
}


export type CertificateEndorsementRequest = {
  certificateHolder?: string;
  requestText?: string;
  requestedEndorsements?: string[];
  /** Kinds Jev detected (`decideCertificateEndorsements`); always unioned in. */
  detectedEndorsements?: CertificateEndorsementKind[];
};

export function inferCertificateEndorsements(
  params: CertificateEndorsementRequest,
): CertificateEndorsementKind[] {
  const text = [
    params.certificateHolder,
    params.requestText,
    ...(params.requestedEndorsements ?? []),
  ]
    .filter(Boolean)
    .join("\n");
  const kinds = new Set<CertificateEndorsementKind>(
    params.detectedEndorsements ?? [],
  );
  for (const item of params.requestedEndorsements ?? []) {
    const normalized = normalizeKind(item);
    if (normalized) kinds.add(normalized);
  }
  for (const rule of ENDORSEMENT_PATTERNS) {
    if (rule.pattern.test(text)) kinds.add(rule.kind);
  }
  return [...kinds];
}

export const CERTIFICATE_ENDORSEMENT_DETECTION_TASK =
  "certificate_endorsement_detection";

const ENDORSEMENT_QUESTIONS: Record<CertificateEndorsementKind, string> = {
  additional_insured:
    "Does the request ask for the certificate holder or another party to be added, named, listed, or covered as an additional insured?",
  named_insured:
    "Does the request ask to change, correct, or add a named insured on the policy?",
  waiver_of_subrogation:
    "Does the request ask for a waiver of subrogation, or for the insurer to give up recovery rights against the holder?",
  primary_non_contributory:
    "Does the request ask for coverage to be primary and non-contributory, or to apply before the holder's own insurance?",
  loss_payee:
    "Does the request ask for a loss payee or loss payable designation?",
  mortgagee:
    "Does the request ask for a mortgagee, mortgage holder, or lender clause?",
  special_wording:
    "Does the request ask for specific wording, language, or description-of-operations text on the certificate?",
  policy_change:
    "Does the request ask for an endorsement, amendment, or other change to the policy itself, beyond issuing a certificate?",
};

/**
 * Regex kinds are a fast positive signal; Jev adds the paraphrases the regex
 * misses. The result is the union, so this is never less strict than the
 * regex alone, and a router failure falls back to the regex result.
 */
export async function decideCertificateEndorsements(
  ctx: Pick<ActionCtx, "runMutation">,
  params: CertificateEndorsementRequest & { orgId: Id<"organizations"> },
): Promise<CertificateEndorsementKind[]> {
  const inferred = inferCertificateEndorsements(params);
  const requestText = [
    params.certificateHolder,
    params.requestText,
    ...(params.requestedEndorsements ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!requestText) return inferred;
  try {
    const result = await clRouterDecide(
      {
        orgId: String(params.orgId),
        task: CERTIFICATE_ENDORSEMENT_DETECTION_TASK,
        state: { requestText },
        questions: Object.fromEntries(
          (
            Object.entries(ENDORSEMENT_QUESTIONS) as Array<
              [CertificateEndorsementKind, string]
            >
          ).map(([kind, instructions]) => [
            kind,
            {
              type: "noul" as const,
              instructions: `${instructions} Only the request text counts; a plain certificate request with holder details is no.`,
            },
          ]),
        ),
      },
      { telemetry: ctx },
    );
    const kinds = new Set(inferred);
    for (const kind of Object.keys(
      ENDORSEMENT_QUESTIONS,
    ) as CertificateEndorsementKind[]) {
      const answer = result.answers[kind];
      if (answer?.type === "noul" && jevProceeds(answer.noul)) kinds.add(kind);
    }
    return [...kinds];
  } catch (error) {
    console.warn("[certificateRequestGate] endorsement decision failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return inferred;
  }
}


export function buildCertificateGateEvidencePacket(params: {
  policy?: Record<string, unknown> | null;
  sourceSpans?: SourceSpanLike[];
  sourceNodes?: SourceNodeLike[];
  certificateHolder?: string;
  requestText?: string;
  requestedEndorsements?: string[];
  maxItems?: number;
}): CertificateGateEvidenceItem[] {
  const corpus = buildEvidenceCorpus(params.policy, params.sourceSpans, params.sourceNodes);
  const queryText = [
    params.certificateHolder,
    params.requestText,
    ...(params.requestedEndorsements ?? []),
  ].filter(Boolean).join(" ");
  const queryTokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !["certificate", "holder", "additional", "insured"].includes(token));
  const score = (item: EvidenceCorpusItem) => {
    const text = `${item.label} ${item.text}`.toLowerCase();
    let value = 0;
    if (/\b(endorsement|endorse|additional insured|scheduled additional insured|certificate holder|waiver of subrogation|primary non|loss payee|mortgagee)\b/i.test(text)) value += 8;
    if (/\b(named additional insured|scheduled additional insured|additional insured automatic class|additional insured endorsement-required class)\b/i.test(item.label)) value += 6;
    if (/\b(operational profile|coverage projection|document metadata|outline)\b/i.test(item.label)) value += 2;
    for (const token of queryTokens) {
      if (text.includes(token)) value += 3;
    }
    return value;
  };
  return corpus
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, params.maxItems ?? 50)
    .map(({ item }, index) => ({
      evidenceId: `e${index + 1}`,
      label: item.label,
      text: item.text.slice(0, 1800),
      sourceSpanIds: item.sourceSpanIds,
      pageStart: item.pageStart,
      pageEnd: item.pageEnd,
    }));
}

function normalizeKind(value: string): CertificateEndorsementKind | undefined {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!text) return undefined;
  if (/additional insured|addl insr/.test(text)) return "additional_insured";
  if (/named insured/.test(text)) return "named_insured";
  if (/waiver|subrogation|wos/.test(text)) return "waiver_of_subrogation";
  if (/primary|non contributory|pnc/.test(text)) return "primary_non_contributory";
  if (/loss payee/.test(text)) return "loss_payee";
  if (/mortgagee|mortgage holder/.test(text)) return "mortgagee";
  if (/wording|description/.test(text)) return "special_wording";
  if (/endorsement|policy change|change request/.test(text)) return "policy_change";
  return undefined;
}

function buildEvidenceCorpus(
  policy?: Record<string, unknown> | null,
  sourceSpans?: SourceSpanLike[],
  sourceNodes?: SourceNodeLike[],
) {
  const items: EvidenceCorpusItem[] = [];
  for (const node of sourceNodes ?? []) {
    const text = [node.description, node.textExcerpt].filter(Boolean).join("\n").trim();
    if (!text) continue;
    items.push({
      label: [
        node.path,
        node.kind,
        node.title,
        node.pageStart ? `p.${node.pageStart}${node.pageEnd && node.pageEnd !== node.pageStart ? `-${node.pageEnd}` : ""}` : undefined,
      ].filter(Boolean).join(" "),
      text,
      sourceSpanIds: node.sourceSpanIds,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
    });
  }

  for (const span of sourceSpans ?? []) {
    const text = span.text?.trim();
    if (!text) continue;
    items.push({
      label: formatSourceSpanLabel(span),
      text,
      sourceSpanIds: span.spanId ? [span.spanId] : undefined,
      pageStart: span.pageStart,
      pageEnd: span.pageEnd,
    });
  }

  if (!policy) return items;
  addOperationalProfileEvidence(items, policy.operationalProfile);
  const addStructured = (label: string, value: unknown) => {
    const text = stringifyEvidence(value);
    if (!text) return;
    items.push({ label, text });
  };

  addStructured("Operational profile", policy.operationalProfile);
  addStructured("Coverage breakdown", coverageBreakdownForTool(policy));
  addStructured("Coverage projection", policy.coverages);
  addStructured("Declarations projection", policy.declarations);
  addStructured("Supplementary source-backed facts", policy.supplementaryFacts);
  addStructured("Document metadata and outline", formatDocumentStructureForPrompt(policy, {
    maxNodes: 36,
    maxChars: 12000,
    includeSourceSpanIds: true,
  }));
  return items;
}

function addOperationalProfileEvidence(items: EvidenceCorpusItem[], profile: unknown) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return;
  const record = profile as Record<string, unknown>;
  const eligibility = objectValue(record.additionalInsuredEligibility);
  addRecordArrayEvidence(items, "Named additional insured", record.additionalInsureds, (item) => [
    fieldText(item, "name"),
    fieldText(item, "status"),
    fieldText(item, "endorsementTitle"),
    fieldText(item, "scope"),
  ]);
  addRecordArrayEvidence(items, "Scheduled additional insured", eligibility?.scheduledAdditionalInsureds, (item) => [
    fieldText(item, "name"),
    fieldText(item, "endorsementTitle"),
    fieldText(item, "scope"),
  ]);
  addRecordArrayEvidence(items, "Additional insured automatic class", eligibility?.withoutEndorsement, (item) => [
    fieldText(item, "category"),
    fieldText(item, "condition"),
    fieldText(item, "summary"),
  ]);
  addRecordArrayEvidence(items, "Additional insured endorsement-required class", eligibility?.requiresEndorsement, (item) => [
    fieldText(item, "category"),
    fieldText(item, "condition"),
    fieldText(item, "summary"),
  ]);
  addRecordArrayEvidence(items, "Additional insured review-required class", eligibility?.reviewRequired, (item) => [
    fieldText(item, "category"),
    fieldText(item, "condition"),
    fieldText(item, "summary"),
  ]);
  addRecordArrayEvidence(items, "Endorsement support", record.endorsementSupport, (item) => [
    fieldText(item, "kind"),
    fieldText(item, "status"),
    fieldText(item, "summary"),
  ]);
  addRecordArrayEvidence(items, "Coverage", record.coverages, (item) => [
    fieldText(item, "name"),
    fieldText(item, "limit"),
    fieldText(item, "formNumber"),
    fieldText(item, "sectionRef"),
  ]);
  addRecordArrayEvidence(items, "Party", record.parties, (item) => [
    fieldText(item, "role"),
    fieldText(item, "name"),
  ]);
}

function addRecordArrayEvidence(
  items: EvidenceCorpusItem[],
  label: string,
  value: unknown,
  fields: (item: Record<string, unknown>) => Array<string | undefined>,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const record = objectValue(item);
    if (!record) continue;
    const text = fields(record).filter(Boolean).join("\n").trim();
    if (!text) continue;
    items.push({
      label,
      text,
      sourceSpanIds: stringArray(record.sourceSpanIds),
      pageStart: numberValue(record.pageStart),
      pageEnd: numberValue(record.pageEnd),
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function fieldText(record: Record<string, unknown>, field: string) {
  const value = record[field];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const sourceBacked = objectValue(value);
  if (sourceBacked && typeof sourceBacked.value === "string") {
    return sourceBacked.value.trim() || undefined;
  }
  return undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringifyEvidence(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  try {
    const text = JSON.stringify(value);
    return text.length > 60000 ? text.slice(0, 60000) : text;
  } catch {
    return undefined;
  }
}




