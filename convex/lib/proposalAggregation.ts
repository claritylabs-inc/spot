/**
 * Owner: P5 (docs/architecture/convex-section-extraction.md). Ported from
 * `extraction-worker/src/proposalExtraction.ts`'s `aggregateProposalDocuments`
 * (pure logic, no I/O). Adapted to the field names Spot's own
 * `mergeSectionResults` compatibility document and raw operational profile
 * produce (see `convex/lib/sectionExtraction/merge.ts`) instead of cl-sdk's
 * extractor output: `parties` comes directly from the operational profile
 * (so "additional_insured" role parties are captured, which the
 * compatibility document does not expose), and `conditions`/`subjectivities`
 * come only from the quote-terms supplemental call since section schemas
 * have no document-level conditions/subjectivities field.
 */

import type { ProposalQuoteTerms } from "./sectionExtraction/schemas";

export type ProposalDocumentParty = {
  role: string;
  name: string;
  address?: unknown;
  naicNumber?: string;
  licenseNumber?: string;
  scope?: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

/** One proposal document's merged, source-cited extraction result. */
export type ProposalDocumentExtraction = {
  proposalDocumentId: string;
  fileName: string;
  /** `mergeSectionResults(...).document`: the cl-sdk-compatible shape. */
  document: Record<string, unknown>;
  /** `mergeSectionResults(...).operationalProfile.parties`. */
  parties: ProposalDocumentParty[];
  supplemental?: ProposalQuoteTerms;
};

export type ProposalEvidenceRef = {
  proposalDocumentId: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type ProposalAggregate = {
  carrier?: string;
  quoteNumber?: string;
  insuredName?: string;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  premium?: string;
  premiums: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  coverages: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  conditions: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  subjectivities: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  exclusions: Array<
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >;
  parties: Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }>;
  evidence: Record<string, ProposalEvidenceRef[]>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized !== "Unknown" ? normalized : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0,
          ),
        ),
      ]
    : [];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function itemEvidence(
  proposalDocumentId: string,
  value: Record<string, unknown>,
): ProposalEvidenceRef[] {
  const sourceNodeIds = strings(value.sourceNodeIds);
  const documentNodeId = text(value.documentNodeId);
  if (documentNodeId && !sourceNodeIds.includes(documentNodeId)) {
    sourceNodeIds.push(documentNodeId);
  }
  const sourceSpanIds = strings(value.sourceSpanIds);
  const pageStart =
    finiteNumber(value.pageStart) ?? finiteNumber(value.pageNumber);
  const pageEnd = finiteNumber(value.pageEnd) ?? pageStart;
  if (
    sourceNodeIds.length === 0 &&
    sourceSpanIds.length === 0 &&
    pageStart === undefined
  ) {
    return [];
  }
  return [{ proposalDocumentId, sourceNodeIds, sourceSpanIds, pageStart, pageEnd }];
}

function first<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function keyFor(value: Record<string, unknown>, fields: string[]): string {
  return fields
    .map(
      (field) =>
        text(value[field])?.toLowerCase() ?? String(value[field] ?? ""),
    )
    .join("|");
}

function withEvidence(
  documents: ProposalDocumentExtraction[],
  field: string,
  keys: string[],
): Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }> {
  const byKey = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    for (const item of records(extracted.document[field])) {
      const key = keyFor(item, keys);
      if (!key.replace(/\|/g, "")) continue;
      const evidence = itemEvidence(extracted.proposalDocumentId, item);
      const existing = byKey.get(key);
      if (existing) existing.evidence.push(...evidence);
      else byKey.set(key, { ...item, evidence });
    }
  }
  return [...byKey.values()];
}

function supplementalItems(
  documents: ProposalDocumentExtraction[],
  field: "conditions" | "subjectivities",
): Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }> {
  const byKey = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    const values = extracted.supplemental?.[field] ?? [];
    for (const item of values) {
      const description = text(item.description);
      if (!description) continue;
      const key = `${description.toLowerCase()}|${text(item.category)?.toLowerCase() ?? ""}`;
      const evidence = itemEvidence(
        extracted.proposalDocumentId,
        item as unknown as Record<string, unknown>,
      );
      const existing = byKey.get(key);
      if (existing) existing.evidence.push(...evidence);
      else byKey.set(key, { ...item, evidence });
    }
  }
  return [...byKey.values()];
}

function scalarEvidence(
  documents: ProposalDocumentExtraction[],
  field: string,
): ProposalEvidenceRef[] {
  return documents.flatMap((extracted) => {
    const declaration = records(
      record(extracted.document.declarations)?.fields,
    ).find((item) => item.field === field);
    return declaration
      ? itemEvidence(extracted.proposalDocumentId, declaration)
      : [];
  });
}

function partyRows(
  extracted: ProposalDocumentExtraction,
): Array<Record<string, unknown> & { evidence: ProposalEvidenceRef[] }> {
  return extracted.parties.map((party) => ({
    role: party.role,
    name: party.name,
    ...(party.address ? { address: party.address } : {}),
    ...(party.naicNumber ? { naicNumber: party.naicNumber } : {}),
    ...(party.licenseNumber ? { licenseNumber: party.licenseNumber } : {}),
    ...(party.scope ? { scope: party.scope } : {}),
    evidence: itemEvidence(extracted.proposalDocumentId, {
      sourceNodeIds: party.sourceNodeIds,
      sourceSpanIds: party.sourceSpanIds,
    }),
  }));
}

/**
 * Deterministically merges every proposal document's extraction into one
 * aggregate offer: scalars are first-document-wins, list fields are
 * key-deduplicated with evidence collected across documents so a fact that
 * appears in more than one document keeps every contributing document's
 * citations.
 */
export function aggregateProposalDocuments(
  documents: ProposalDocumentExtraction[],
): ProposalAggregate {
  const quoteDocuments = documents.map((item) => item.document);
  const carrier = first(quoteDocuments.map((item) => text(item.carrier)));
  const quoteNumber = first(
    quoteDocuments.map((item) => text(item.policyNumber)),
  );
  const insuredName = first(
    quoteDocuments.map((item) => text(item.insuredName)),
  );
  const proposedEffectiveDate = first(
    quoteDocuments.map((item) => text(item.effectiveDate)),
  );
  const proposedExpirationDate = first(
    quoteDocuments.map((item) => text(item.expirationDate)),
  );
  const quoteExpirationDate = first(
    documents.map((item) => text(item.supplemental?.quoteExpirationDate)),
  );
  const premium = first(quoteDocuments.map((item) => text(item.premium)));

  const parties = new Map<
    string,
    Record<string, unknown> & { evidence: ProposalEvidenceRef[] }
  >();
  for (const extracted of documents) {
    for (const party of partyRows(extracted)) {
      const key = keyFor(party, ["role", "name"]);
      const existing = parties.get(key);
      if (existing) existing.evidence.push(...party.evidence);
      else parties.set(key, party);
    }
  }

  return {
    carrier,
    quoteNumber,
    insuredName,
    proposedEffectiveDate,
    proposedExpirationDate,
    quoteExpirationDate,
    premium,
    premiums: withEvidence(documents, "premiumBreakdown", ["line", "amount"]),
    coverages: withEvidence(documents, "coverages", [
      "name",
      "limit",
      "deductible",
    ]),
    conditions: supplementalItems(documents, "conditions"),
    subjectivities: supplementalItems(documents, "subjectivities"),
    exclusions: withEvidence(documents, "exclusions", ["name", "content"]),
    parties: [...parties.values()],
    evidence: {
      carrier: scalarEvidence(documents, "insurer"),
      quoteNumber: scalarEvidence(documents, "policyNumber"),
      insuredName: scalarEvidence(documents, "namedInsured"),
      proposedEffectiveDate: scalarEvidence(documents, "policyPeriodStart"),
      proposedExpirationDate: scalarEvidence(documents, "policyPeriodEnd"),
      quoteExpirationDate: documents.flatMap((extracted) =>
        extracted.supplemental?.quoteExpirationEvidence
          ? itemEvidence(
              extracted.proposalDocumentId,
              extracted.supplemental
                .quoteExpirationEvidence as unknown as Record<string, unknown>,
            )
          : [],
      ),
    },
  };
}
