import { resolveCitation, type ResolvedCitation } from "../citationResolver";
import { mergeCoverageRows, type CoverageLike } from "../coverageScoping";
import { toLobCodes } from "../linesOfBusiness";
import type { PolicySection, PolicySectionKind } from "../policySectioning";
import type { DocumentSourceNode, SourceSpanLike } from "../sourceTree";
import { citationPageCandidates } from "./prompts";
import {
  SECTION_OUTPUT_SCHEMAS,
  type CitedValue,
  type DeclarationsSectionOutput,
  type SectionCitation,
  type SectionCoverage,
  type SectionFormReference,
  type SectionOutputByKind,
} from "./schemas";

export type SectionResult = {
  [K in PolicySectionKind]: {
    kind: K;
    section: PolicySection;
    output: SectionOutputByKind[K];
  };
}[PolicySectionKind];

export type CitationMatchCounts = Record<ResolvedCitation["match"], number>;

/** Validates a stored section output against the schema for its kind. */
export function parseSectionResult(
  section: PolicySection,
  output: unknown,
): SectionResult | undefined {
  const parsed = SECTION_OUTPUT_SCHEMAS[section.kind].safeParse(output);
  return parsed.success
    ? ({ kind: section.kind, section, output: parsed.data } as SectionResult)
    : undefined;
}

type SourceBacked = { sourceNodeIds: string[]; sourceSpanIds: string[] };
type RawValue = SourceBacked & { value: string; confidence: "high" | "medium" };
type RawAddress = Partial<
  Record<"street1" | "street2" | "city" | "state" | "zip" | "country", string>
>;
type RawParty = SourceBacked & {
  role: string;
  name: string;
  address?: RawAddress;
  naicNumber?: string;
  licenseNumber?: string;
  scope?: string;
};
type CoverageSchedule = {
  name: string;
  kind: "vehicle" | "property" | "location" | "other";
  description?: string;
  items: Array<{
    label: string;
    description?: string;
    values: Array<{ label: string; value: string }>;
    sourceSpanIds: string[];
  }>;
  sourceSpanIds: string[];
  pageStart: number;
  pageEnd: number;
};

/** Raw operational profile in the shape the cl-sdk extractor returned. */
export type RawOperationalProfile = {
  documentType: "policy";
  linesOfBusiness: string[];
  policyNumber?: RawValue;
  namedInsured?: RawValue;
  insurer?: RawValue;
  broker?: RawValue;
  effectiveDate?: RawValue;
  expirationDate?: RawValue;
  retroactiveDate?: RawValue;
  premium?: RawValue;
  operationsDescription?: RawValue;
  productIdentity?: { name: RawValue };
  totalCost?: RawValue;
  declarationFacts: Array<SourceBacked & { field: string; value: string }>;
  coverages: CoverageLike[];
  coverageSchedules?: CoverageSchedule[];
  premiumBreakdown?: Array<Record<string, unknown>>;
  taxesAndFees?: Array<Record<string, unknown>>;
  parties: RawParty[];
  endorsementSupport: Array<
    SourceBacked & { kind: string; status: string; summary: string }
  >;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
  warnings: string[];
};

export type MergedSectionExtraction = {
  operationalProfile: RawOperationalProfile;
  /** Compatibility InsuranceDocument for postProcessExtractionDocument. */
  document: Record<string, unknown>;
  uncitedFactCount: number;
  citationMatches: CitationMatchCounts;
};

type Evidence = SourceBacked & { pages: number[]; exact: boolean };

const MATCH_RANK: Record<ResolvedCitation["match"], number> = {
  exact: 3,
  normalized: 2,
  page_only: 1,
  unresolved: 0,
};

const ENDORSEMENT_RECORD_PARTY_ROLES = new Set([
  "additional_insured",
  "loss_payee",
  "mortgage_holder",
  "certificate_holder",
  "notice_recipient",
]);

function clean(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nameKey(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

function withoutEmpty<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}

function sourceIdsOf(value: unknown, key: keyof SourceBacked): string[] {
  const ids = (value as Record<string, unknown>)[key];
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

function moneyAmount(value: string): number | undefined {
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return /\d/.test(value) && Number.isFinite(amount) ? amount : undefined;
}

function createEvidenceResolver(
  sourceSpans: SourceSpanLike[],
  sourceTree: DocumentSourceNode[],
) {
  const spansByPage = new Map<number, SourceSpanLike[]>();
  for (const span of sourceSpans) {
    if (typeof span.pageStart !== "number") continue;
    for (let page = span.pageStart; page <= (span.pageEnd ?? span.pageStart); page += 1) {
      spansByPage.set(page, [...(spansByPage.get(page) ?? []), span]);
    }
  }
  // The document root lists every span, so facts cite the specific nodes.
  const nodeIdsBySpanId = new Map<string, string[]>();
  for (const node of sourceTree) {
    if (node.kind === "document") continue;
    for (const spanId of node.sourceSpanIds) {
      nodeIdsBySpanId.set(spanId, [...(nodeIdsBySpanId.get(spanId) ?? []), node.id]);
    }
  }
  const counts: CitationMatchCounts = {
    exact: 0,
    normalized: 0,
    page_only: 0,
    unresolved: 0,
  };
  const resolve = (
    citations: SectionCitation[],
    section: PolicySection,
  ): Evidence => {
    const spanIds: string[] = [];
    const pages: number[] = [];
    let exact = false;
    for (const citation of citations) {
      let best: ResolvedCitation | undefined;
      for (const page of citationPageCandidates(citation.page, section)) {
        const resolved = resolveCitation(
          { page, quote: citation.quote },
          spansByPage.get(page) ?? [],
        );
        if (!best || MATCH_RANK[resolved.match] > MATCH_RANK[best.match]) {
          best = resolved;
        }
      }
      const match = best?.match ?? "unresolved";
      counts[match] += 1;
      if (!best || match === "unresolved" || best.sourceSpanIds.length === 0) {
        continue;
      }
      spanIds.push(...best.sourceSpanIds);
      pages.push(best.page);
      exact ||= match === "exact" || match === "normalized";
    }
    const sourceSpanIds = unique(spanIds);
    return {
      sourceSpanIds,
      sourceNodeIds: unique(
        sourceSpanIds.flatMap((id) => nodeIdsBySpanId.get(id) ?? []),
      ),
      pages,
      exact,
    };
  };
  return { resolve, counts };
}

function ofKind<K extends PolicySectionKind>(
  results: SectionResult[],
  kind: K,
): Array<Extract<SectionResult, { kind: K }>> {
  return results.filter(
    (result): result is Extract<SectionResult, { kind: K }> =>
      result.kind === kind,
  );
}

function rawAddress(
  address: Partial<Record<keyof RawAddress, string | null>> | null,
): RawAddress | undefined {
  if (!address) return undefined;
  const next = withoutEmpty({
    street1: clean(address.street1),
    street2: clean(address.street2),
    city: clean(address.city),
    state: clean(address.state),
    zip: clean(address.zip),
    country: clean(address.country),
  });
  return Object.keys(next).length > 0 ? next : undefined;
}

function completeAddress(address: RawAddress | undefined) {
  return address?.street1 && address.city && address.state && address.zip
    ? withoutEmpty({
        street1: address.street1,
        street2: address.street2,
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: address.country,
      })
    : undefined;
}

function provenance(value: SourceBacked | undefined) {
  return value && value.sourceSpanIds.length > 0
    ? withoutEmpty({
        sourceSpanIds: value.sourceSpanIds,
        documentNodeId: value.sourceNodeIds[0],
      })
    : undefined;
}

function matchingCoverageIndex(rows: CoverageLike[], name: unknown): number {
  const key = nameKey(name);
  if (!key) return -1;
  const exact = rows.findIndex((row) => nameKey(row.name) === key);
  if (exact >= 0) return exact;
  const partial = rows.flatMap((row, index) => {
    const other = nameKey(row.name);
    return other && (other.includes(key) || key.includes(other)) ? [index] : [];
  });
  return partial.length === 1 ? partial[0] : -1;
}

/** An endorsement's printed values replace the matching coverage's values and terms. */
function modifiedCoverage(existing: CoverageLike, change: CoverageLike): CoverageLike {
  const termKey = (term: unknown) => nameKey((term as { label?: unknown }).label);
  const changedTerms = Array.isArray(change.limits) ? change.limits : [];
  const changedKeys = new Set(changedTerms.map(termKey));
  const keptTerms = (Array.isArray(existing.limits) ? existing.limits : []).filter(
    (term) => !changedKeys.has(termKey(term)),
  );
  return {
    ...existing,
    ...withoutEmpty({
      limit: change.limit,
      deductible: change.deductible,
      retroactiveDate: change.retroactiveDate,
      endorsementNumber: change.endorsementNumber,
    }),
    limits: [...changedTerms, ...keptTerms],
    sourceNodeIds: unique([
      ...sourceIdsOf(existing, "sourceNodeIds"),
      ...sourceIdsOf(change, "sourceNodeIds"),
    ]),
    sourceSpanIds: unique([
      ...sourceIdsOf(existing, "sourceSpanIds"),
      ...sourceIdsOf(change, "sourceSpanIds"),
    ]),
  };
}

function dedupeForms(forms: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return forms.filter((form) => {
    const key = `${nameKey(form.formNumber)}|${nameKey(form.editionDate)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deterministically merges section results into the raw extraction result
 * shape: declarations are authoritative for core metadata, parties, and
 * premium; schedules and coverage forms add coverage rows and terms; and
 * endorsements apply party and coverage changes on top, in page order.
 * Facts whose citations resolve to no source span are dropped, as the cl-sdk
 * extractor dropped uncited facts.
 */
export function mergeSectionResults(args: {
  policyId: string;
  results: SectionResult[];
  sourceSpans: SourceSpanLike[];
  sourceTree: DocumentSourceNode[];
}): MergedSectionExtraction {
  const resolver = createEvidenceResolver(args.sourceSpans, args.sourceTree);
  let uncitedFactCount = 0;

  const cited = (citations: SectionCitation[], section: PolicySection) => {
    const evidence = resolver.resolve(citations, section);
    if (evidence.sourceSpanIds.length > 0) return evidence;
    uncitedFactCount += 1;
    return undefined;
  };
  const sourceValue = (
    input: CitedValue | null,
    section: PolicySection,
  ): RawValue | undefined => {
    const value = clean(input?.value);
    const evidence = value && input ? cited(input.citations, section) : undefined;
    return value && evidence
      ? {
          value,
          confidence: evidence.exact ? "high" : "medium",
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        }
      : undefined;
  };
  const coverageRow = (
    input: SectionCoverage,
    section: PolicySection,
    extra: { formNumber?: string; endorsementNumber?: string } = {},
  ): CoverageLike | undefined => {
    const name = clean(input.name);
    if (!name) return undefined;
    const rowEvidence = resolver.resolve(input.citations, section);
    const limits = input.limits.flatMap((term) => {
      const label = clean(term.label);
      const value = clean(term.value);
      if (!label || !value) return [];
      const termEvidence = resolver.resolve(term.citations, section);
      const evidence =
        termEvidence.sourceSpanIds.length > 0 ? termEvidence : rowEvidence;
      if (evidence.sourceSpanIds.length === 0) {
        uncitedFactCount += 1;
        return [];
      }
      return [
        withoutEmpty({
          kind: term.kind ?? undefined,
          label,
          value,
          appliesTo: clean(term.appliesTo),
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        }),
      ];
    });
    const sourceSpanIds = unique([
      ...rowEvidence.sourceSpanIds,
      ...limits.flatMap((term) => term.sourceSpanIds),
    ]);
    if (sourceSpanIds.length === 0) {
      uncitedFactCount += 1;
      return undefined;
    }
    return withoutEmpty({
      name,
      lineOfBusiness: clean(input.lineOfBusiness),
      coverageCode: clean(input.coverageCode),
      limit: clean(input.limit),
      deductible: clean(input.deductible),
      premium: clean(input.premium),
      retroactiveDate: clean(input.retroactiveDate),
      formNumber: clean(input.formNumber) ?? extra.formNumber,
      endorsementNumber: extra.endorsementNumber,
      limits,
      sourceNodeIds: unique([
        ...rowEvidence.sourceNodeIds,
        ...limits.flatMap((term) => term.sourceNodeIds),
      ]),
      sourceSpanIds,
    });
  };
  const coverageRows = (
    inputs: SectionCoverage[],
    section: PolicySection,
    extra: { formNumber?: string } = {},
  ): CoverageLike[] =>
    inputs.flatMap((input) => {
      const row = coverageRow(input, section, extra);
      return row ? [row] : [];
    });
  const partyRow = (
    input: {
      role: string;
      name: string;
      address: Parameters<typeof rawAddress>[0];
      naicNumber?: string | null;
      licenseNumber?: string | null;
      scope?: string | null;
      citations: SectionCitation[];
    },
    section: PolicySection,
  ): RawParty | undefined => {
    const name = clean(input.name);
    const evidence = name ? cited(input.citations, section) : undefined;
    return name && evidence
      ? withoutEmpty({
          role: input.role,
          name,
          address: rawAddress(input.address),
          naicNumber: clean(input.naicNumber),
          licenseNumber: clean(input.licenseNumber),
          scope: clean(input.scope),
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        })
      : undefined;
  };
  const formRow = (
    input: SectionFormReference,
    section: PolicySection,
    fallbackType: string,
  ) => {
    const formNumber = clean(input.formNumber);
    const evidence = formNumber ? cited(input.citations, section) : undefined;
    return formNumber && evidence
      ? withoutEmpty({
          formNumber,
          editionDate: clean(input.editionDate),
          title: clean(input.title),
          formType: input.formType ?? fallbackType,
          ...(section.kind === "coverage_form"
            ? { pageStart: section.pageStart, pageEnd: section.pageEnd }
            : {}),
          documentNodeId: evidence.sourceNodeIds[0],
          sourceSpanIds: evidence.sourceSpanIds,
        })
      : undefined;
  };
  const moneyRow = (
    labelInput: string,
    amountInput: string,
    citations: SectionCitation[],
    section: PolicySection,
  ) => {
    const label = clean(labelInput);
    const amount = clean(amountInput);
    const evidence = label && amount ? cited(citations, section) : undefined;
    return label && amount && evidence
      ? withoutEmpty({
          label,
          amount,
          amountValue: moneyAmount(amount),
          documentNodeId: evidence.sourceNodeIds[0],
          sourceSpanIds: evidence.sourceSpanIds,
        })
      : undefined;
  };
  const firstValue = (
    entries: Array<{ section: PolicySection; value: CitedValue | null }>,
  ) => {
    for (const entry of entries) {
      const value = sourceValue(entry.value, entry.section);
      if (value) return value;
    }
    return undefined;
  };

  const parties: RawParty[] = [];
  const addParty = (party: RawParty | undefined) => {
    if (!party) return;
    const existing = parties.find(
      (other) =>
        other.role === party.role && nameKey(other.name) === nameKey(party.name),
    );
    if (!existing) {
      parties.push(party);
      return;
    }
    existing.sourceNodeIds = unique([...existing.sourceNodeIds, ...party.sourceNodeIds]);
    existing.sourceSpanIds = unique([...existing.sourceSpanIds, ...party.sourceSpanIds]);
    existing.address ??= party.address;
  };

  let coverages: CoverageLike[] = [];
  const addCoverageRows = (rows: CoverageLike[]) => {
    coverages =
      coverages.length === 0
        ? mergeCoverageRows(rows, [])
        : mergeCoverageRows(coverages, rows);
  };

  const declarations = ofKind(args.results, "declarations");
  const invoices = ofKind(args.results, "invoice");
  const declarationsValue = (
    pick: (output: DeclarationsSectionOutput) => CitedValue | null,
  ) =>
    firstValue(
      declarations.map(({ section, output }) => ({ section, value: pick(output) })),
    );

  const declarationFacts: RawOperationalProfile["declarationFacts"] = [];
  const premiumBreakdown: Array<Record<string, unknown>> = [];
  const formInventory: Array<Record<string, unknown>> = [];
  const linesOfBusiness: string[] = [];
  for (const { section, output } of declarations) {
    linesOfBusiness.push(...output.linesOfBusiness);
    for (const party of output.parties) addParty(partyRow(party, section));
    for (const detail of output.insuredDetails) {
      const value = sourceValue(detail, section);
      if (value) declarationFacts.push({ ...value, field: detail.field });
    }
    for (const row of output.premiumBreakdown) {
      const money = moneyRow(row.line, row.amount, row.citations, section);
      if (!money) continue;
      const { label, ...rest } = money;
      premiumBreakdown.push({ line: label, ...rest });
    }
    addCoverageRows(coverageRows(output.coverages, section));
    for (const form of output.forms) {
      const row = formRow(form, section, "other");
      if (row) formInventory.push(row);
    }
  }
  // Invoice taxes and fees apply only when the declarations list none.
  const taxSources = declarations.some(({ output }) => output.taxesAndFees.length > 0)
    ? declarations.map(({ section, output }) => ({ section, rows: output.taxesAndFees }))
    : invoices.map(({ section, output }) => ({ section, rows: output.taxesAndFees }));
  const taxesAndFees = taxSources.flatMap(({ section, rows }) =>
    rows.flatMap((row) => {
      const money = moneyRow(row.name, row.amount, row.citations, section);
      if (!money) return [];
      const { label, ...rest } = money;
      return [withoutEmpty({ name: label, ...rest, type: row.type ?? undefined })];
    }),
  );

  const coverageSchedules: CoverageSchedule[] = [];
  for (const { section, output } of ofKind(args.results, "schedule")) {
    for (const schedule of output.schedules) {
      const items = schedule.items.flatMap((item) => {
        const label = clean(item.label);
        const evidence = label ? cited(item.citations, section) : undefined;
        if (!label || !evidence) return [];
        return [
          withoutEmpty({
            label,
            description: clean(item.description),
            values: item.values.flatMap((value) => {
              const valueLabel = clean(value.label);
              const text = clean(value.value);
              return valueLabel && text ? [{ label: valueLabel, value: text }] : [];
            }),
            sourceSpanIds: evidence.sourceSpanIds,
          }),
        ];
      });
      const name = clean(schedule.name);
      if (!name || items.length === 0) continue;
      coverageSchedules.push(
        withoutEmpty({
          name,
          kind: schedule.kind,
          description: clean(schedule.description),
          items,
          sourceSpanIds: unique(items.flatMap((item) => item.sourceSpanIds)),
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
        }),
      );
    }
    addCoverageRows(coverageRows(output.coverages, section));
  }

  const definitions: Array<Record<string, unknown>> = [];
  const exclusions: Array<Record<string, unknown>> = [];
  for (const { section, output } of ofKind(args.results, "coverage_form")) {
    for (const form of output.forms) {
      const row = formRow(form, section, "coverage");
      if (row) formInventory.push(row);
    }
    const formNumber = clean(output.forms[0]?.formNumber) ?? section.formNumber;
    addCoverageRows(coverageRows(output.coverages, section, { formNumber }));
    for (const definition of output.definitions) {
      const term = clean(definition.term);
      const summary = clean(definition.summary);
      const evidence = term && summary ? cited(definition.citations, section) : undefined;
      if (!term || !summary || !evidence) continue;
      definitions.push(
        withoutEmpty({
          term,
          definition: summary,
          formNumber,
          pageNumber: evidence.pages[0],
          documentNodeId: evidence.sourceNodeIds[0],
          sourceSpanIds: evidence.sourceSpanIds,
        }),
      );
    }
    for (const exclusion of output.exclusions) {
      const title = clean(exclusion.title);
      const summary = clean(exclusion.summary);
      const evidence = title && summary ? cited(exclusion.citations, section) : undefined;
      if (!title || !summary || !evidence) continue;
      exclusions.push(
        withoutEmpty({
          name: title,
          content: summary,
          formNumber,
          pageNumber: evidence.pages[0],
          documentNodeId: evidence.sourceNodeIds[0],
          sourceSpanIds: evidence.sourceSpanIds,
        }),
      );
    }
  }
  for (const { section, output } of ofKind(args.results, "forms_list")) {
    for (const form of output.forms) {
      const row = formRow(form, section, "other");
      if (row) formInventory.push(row);
    }
  }

  const supplementaryFacts: Array<Record<string, unknown>> = [];
  for (const result of args.results) {
    if (
      result.kind !== "application" &&
      result.kind !== "invoice" &&
      result.kind !== "notice" &&
      result.kind !== "other"
    ) {
      continue;
    }
    const summary = clean(result.output.summary);
    const evidence = summary ? cited(result.output.citations, result.section) : undefined;
    if (!summary || !evidence) continue;
    supplementaryFacts.push(
      withoutEmpty({
        key: `${result.kind}_summary`,
        value: summary,
        subject: clean(result.output.title),
        context: `Pages ${result.section.pageStart}-${result.section.pageEnd}`,
        documentNodeId: evidence.sourceNodeIds[0],
        sourceSpanIds: evidence.sourceSpanIds,
      }),
    );
  }

  const endorsementSupport: RawOperationalProfile["endorsementSupport"] = [];
  const endorsementRecords: Array<Record<string, unknown>> = [];
  for (const { section, output } of ofKind(args.results, "endorsement")) {
    for (const endorsement of output.endorsements) {
      const endorsementNumber =
        clean(endorsement.endorsementNumber) ?? clean(endorsement.formNumber);
      for (const change of endorsement.coverageChanges) {
        const row = coverageRow(change.coverage, section, { endorsementNumber });
        if (!row) continue;
        const index = matchingCoverageIndex(coverages, row.name);
        if (change.action === "removed") {
          if (index >= 0) coverages.splice(index, 1);
        } else if (change.action === "modified" && index >= 0) {
          coverages[index] = modifiedCoverage(coverages[index], row);
        } else {
          addCoverageRows([row]);
        }
      }
      const namedParties: Array<Record<string, unknown>> = [];
      for (const change of endorsement.partyChanges) {
        const party = partyRow(change, section);
        if (!party) continue;
        if (change.action === "removed") {
          const index = parties.findIndex(
            (other) =>
              other.role === party.role && nameKey(other.name) === nameKey(party.name),
          );
          if (index >= 0) parties.splice(index, 1);
          continue;
        }
        addParty(party);
        namedParties.push(
          withoutEmpty({
            name: party.name,
            role: ENDORSEMENT_RECORD_PARTY_ROLES.has(party.role) ? party.role : "other",
            scope: party.scope,
            documentNodeId: party.sourceNodeIds[0],
            sourceSpanIds: party.sourceSpanIds,
          }),
        );
      }
      const summary = clean(endorsement.summary);
      const evidence = summary ? cited(endorsement.citations, section) : undefined;
      if (!summary || !evidence) continue;
      endorsementSupport.push({
        kind: endorsement.endorsementType,
        status: endorsement.supportStatus,
        summary,
        sourceNodeIds: evidence.sourceNodeIds,
        sourceSpanIds: evidence.sourceSpanIds,
      });
      endorsementRecords.push(
        withoutEmpty({
          formNumber: clean(endorsement.formNumber) ?? endorsementNumber ?? "",
          editionDate: clean(endorsement.editionDate),
          title: clean(endorsement.title) ?? summary,
          endorsementType: endorsement.endorsementType,
          effectiveDate: sourceValue(endorsement.effectiveDate, section)?.value,
          affectedCoverageParts: endorsement.coverageChanges.map(
            (change) => `${change.action}: ${change.coverage.name}`,
          ),
          namedParties,
          dateChanges: endorsement.dateChanges.flatMap((change) => {
            const value = sourceValue(change, section);
            return value
              ? [{ field: change.field, value: value.value, sourceSpanIds: value.sourceSpanIds }]
              : [];
          }),
          premiumImpact: sourceValue(endorsement.premiumChange, section)?.value,
          content: summary,
          pageStart: evidence.pages[0] ?? section.pageStart,
          pageEnd: section.pageEnd,
          documentNodeId: evidence.sourceNodeIds[0],
          sourceSpanIds: evidence.sourceSpanIds,
        }),
      );
    }
  }

  const programName = declarationsValue((output) => output.programName);
  const profile: RawOperationalProfile = {
    documentType: "policy",
    linesOfBusiness: unique(linesOfBusiness.map((lob) => lob.trim()).filter(Boolean)),
    policyNumber: declarationsValue((output) => output.policyNumber),
    namedInsured: declarationsValue((output) => output.namedInsured),
    insurer: declarationsValue((output) => output.insurer),
    broker: declarationsValue((output) => output.broker),
    effectiveDate: declarationsValue((output) => output.effectiveDate),
    expirationDate: declarationsValue((output) => output.expirationDate),
    retroactiveDate: declarationsValue((output) => output.retroactiveDate),
    premium:
      declarationsValue((output) => output.premium) ??
      firstValue(invoices.map(({ section, output }) => ({ section, value: output.premium }))),
    operationsDescription: declarationsValue((output) => output.operationsDescription),
    productIdentity: programName ? { name: programName } : undefined,
    totalCost:
      declarationsValue((output) => output.totalCost) ??
      firstValue(invoices.map(({ section, output }) => ({ section, value: output.totalCost }))),
    declarationFacts,
    coverages,
    coverageSchedules: coverageSchedules.length > 0 ? coverageSchedules : undefined,
    premiumBreakdown: premiumBreakdown.length > 0 ? premiumBreakdown : undefined,
    taxesAndFees: taxesAndFees.length > 0 ? taxesAndFees : undefined,
    parties,
    endorsementSupport,
    sourceNodeIds: [],
    sourceSpanIds: [],
    warnings: [],
  };
  const evidenceRecords: unknown[] = [
    profile.policyNumber,
    profile.namedInsured,
    profile.insurer,
    profile.broker,
    profile.effectiveDate,
    profile.expirationDate,
    profile.retroactiveDate,
    profile.premium,
    profile.operationsDescription,
    programName,
    profile.totalCost,
    ...declarationFacts,
    ...parties,
    ...coverages,
    ...endorsementSupport,
  ].filter(Boolean);
  profile.sourceNodeIds = unique(
    evidenceRecords.flatMap((record) => sourceIdsOf(record, "sourceNodeIds")),
  );
  profile.sourceSpanIds = unique(
    evidenceRecords.flatMap((record) => sourceIdsOf(record, "sourceSpanIds")),
  );

  return {
    operationalProfile: profile,
    document: compatibilityDocument({
      policyId: args.policyId,
      profile,
      results: args.results,
      formInventory: dedupeForms(formInventory),
      endorsements: endorsementRecords,
      definitions,
      exclusions,
      supplementaryFacts,
    }),
    uncitedFactCount,
    citationMatches: resolver.counts,
  };
}

function scheduleValue(
  values: Array<{ label: string; value: string }>,
  labels: string[],
): string | undefined {
  const byLabel = values.map((value) => ({
    label: value.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    value: value.value,
  }));
  for (const label of labels) {
    const match =
      byLabel.find((value) => value.label === label) ??
      byLabel.find((value) => value.label.includes(label));
    if (match?.value) return match.value;
  }
  return undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Spot-owned port of the cl-sdk source-tree compatibility document. */
function compatibilityDocument(args: {
  policyId: string;
  profile: RawOperationalProfile;
  results: SectionResult[];
  formInventory: Array<Record<string, unknown>>;
  endorsements: Array<Record<string, unknown>>;
  definitions: Array<Record<string, unknown>>;
  exclusions: Array<Record<string, unknown>>;
  supplementaryFacts: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const { profile } = args;
  const partiesWithRole = (...roles: string[]) =>
    roles.flatMap((role) => profile.parties.filter((party) => party.role === role));
  const firstParty = (...roles: string[]) => {
    const candidates = partiesWithRole(...roles);
    return candidates.find((party) => party.address) ?? candidates[0];
  };
  const insuredParty = firstParty("named_insured");
  const insurerParty = firstParty("carrier", "insurer");
  const producerParty = firstParty("producer");
  const carrier = profile.insurer?.value ?? insurerParty?.name ?? "Unknown";
  const policyNumber = profile.policyNumber?.value ?? "Unknown";
  const insuredName = profile.namedInsured?.value ?? insuredParty?.name ?? "Unknown";
  const broker = profile.broker?.value ?? producerParty?.name;
  const combined = (...values: Array<SourceBacked | undefined>) =>
    provenance({
      sourceNodeIds: unique(values.flatMap((value) => value?.sourceNodeIds ?? [])),
      sourceSpanIds: unique(values.flatMap((value) => value?.sourceSpanIds ?? [])),
    });
  const insurerProvenance = combined(profile.insurer, insurerParty);
  const brokerProvenance = combined(profile.broker, producerParty);
  const insuredAddress = completeAddress(insuredParty?.address);
  const fact = (field: string) =>
    profile.declarationFacts.find((candidate) => candidate.field === field)?.value;
  const partyRecords = (role: string) =>
    partiesWithRole(role).map((party) =>
      withoutEmpty({
        name: party.name,
        role,
        address: party.address?.street1 ? party.address : undefined,
        scope: party.scope,
        ...provenance(party),
      }),
    );
  const lossPayees = partyRecords("loss_payee");
  const mortgageHolders = partyRecords("mortgage_holder");
  const additionalNamedInsureds = partiesWithRole("additional_named_insured").map(
    (party) =>
      withoutEmpty({
        name: party.name,
        address: party.address?.street1 ? party.address : undefined,
        ...provenance(party),
      }),
  );
  const scheduleItems = (...kinds: string[]) =>
    (profile.coverageSchedules ?? [])
      .filter((schedule) => kinds.includes(schedule.kind))
      .flatMap((schedule) => schedule.items);
  const vehicles = scheduleItems("vehicle").flatMap((item, index) => {
    const year = positiveInteger(scheduleValue(item.values, ["year", "model year"]));
    const make = scheduleValue(item.values, ["make"]);
    const model = scheduleValue(item.values, ["model"]);
    const vin = scheduleValue(item.values, ["vin", "vehicle identification number"]);
    return year && make && model && vin
      ? [{ number: positiveInteger(item.label) ?? index + 1, year, make, model, vin }]
      : [];
  });
  const locations = scheduleItems("location", "property").flatMap((item, index) => {
    const street1 = scheduleValue(item.values, ["street 1", "street address", "address"]);
    const city = scheduleValue(item.values, ["city"]);
    const state = scheduleValue(item.values, ["state", "province"]);
    const zip = scheduleValue(item.values, ["zip", "postal code"]);
    return street1 && city && state && zip
      ? [
          withoutEmpty({
            number: positiveInteger(item.label) ?? index + 1,
            address: withoutEmpty({
              street1,
              city,
              state,
              zip,
              country: scheduleValue(item.values, ["country"]),
            }),
            description: item.description,
            buildingValue: scheduleValue(item.values, ["building value", "building"]),
            contentsValue: scheduleValue(item.values, ["contents value", "contents"]),
          }),
        ]
      : [];
  });
  const linesOfBusiness =
    profile.linesOfBusiness.length > 0 ? toLobCodes(profile.linesOfBusiness) : [];
  const summary = [
    carrier !== "Unknown" ? carrier : undefined,
    policyNumber !== "Unknown" ? `#${policyNumber}` : undefined,
    insuredName !== "Unknown" ? `for ${insuredName}` : undefined,
    linesOfBusiness.length > 0
      ? `covering ${linesOfBusiness.slice(0, 5).join(", ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const declarationField = (field: string, value: RawValue | undefined) =>
    value ? { field, value: value.value, sourceSpanIds: value.sourceSpanIds } : undefined;
  return withoutEmpty({
    id: args.policyId,
    type: "policy",
    carrier,
    security: carrier,
    insuredName,
    policyNumber,
    effectiveDate: profile.effectiveDate?.value ?? "Unknown",
    expirationDate: profile.expirationDate?.value ?? "Unknown",
    retroactiveDate: profile.retroactiveDate?.value,
    premium: profile.premium?.value,
    premiumBreakdown: profile.premiumBreakdown,
    taxesAndFees: profile.taxesAndFees,
    totalCost: profile.totalCost?.value,
    totalCostAmount: profile.totalCost ? moneyAmount(profile.totalCost.value) : undefined,
    insuredDba: fact("dba"),
    insuredEntityType: fact("entityType"),
    insuredFein: fact("taxId"),
    insuredAddress:
      insuredAddress && insuredParty
        ? { ...insuredAddress, ...provenance(insuredParty) }
        : undefined,
    additionalNamedInsureds:
      additionalNamedInsureds.length > 0 ? additionalNamedInsureds : undefined,
    lossPayees: lossPayees.length > 0 ? lossPayees : undefined,
    mortgageHolders: mortgageHolders.length > 0 ? mortgageHolders : undefined,
    insurer: insurerProvenance
      ? withoutEmpty({
          legalName: carrier,
          address: completeAddress(insurerParty?.address),
          ...insurerProvenance,
        })
      : undefined,
    brokerAgency: broker && brokerProvenance ? broker : undefined,
    producer:
      broker && brokerProvenance
        ? withoutEmpty({
            agencyName: broker,
            address: completeAddress(producerParty?.address),
            ...brokerProvenance,
          })
        : undefined,
    linesOfBusiness,
    programName: profile.productIdentity?.name.value,
    formInventory: args.formInventory,
    coverages: profile.coverages.map((coverage) => {
      const limits = Array.isArray(coverage.limits)
        ? (coverage.limits as Array<{ label: string; value: string }>)
        : [];
      return withoutEmpty({
        name: coverage.name,
        lineOfBusiness: coverage.lineOfBusiness,
        coverageCode: coverage.coverageCode,
        limit: coverage.limit,
        deductible: coverage.deductible,
        premium: coverage.premium,
        retroactiveDate: coverage.retroactiveDate,
        formNumber: coverage.formNumber,
        endorsementNumber: coverage.endorsementNumber,
        limits,
        sourceSpanIds: coverage.sourceSpanIds,
        documentNodeId: sourceIdsOf(coverage, "sourceNodeIds")[0],
        originalContent: [
          coverage.name,
          ...(limits.length > 0
            ? limits.map((term) => `${term.label}: ${term.value}`)
            : [coverage.limit, coverage.deductible, coverage.premium]),
        ]
          .filter(Boolean)
          .join(" | "),
      });
    }),
    coverageSchedules: profile.coverageSchedules,
    vehicles: vehicles.length > 0 ? vehicles : undefined,
    locations: locations.length > 0 ? locations : undefined,
    endorsements: args.endorsements.length > 0 ? args.endorsements : undefined,
    definitions: args.definitions.length > 0 ? args.definitions : undefined,
    exclusions: args.exclusions.length > 0 ? args.exclusions : undefined,
    documentMetadata: {
      sourceTreeVersion: "v3",
      sourceTreeCanonical: true,
      extractionSections: args.results.map(({ section }) =>
        withoutEmpty({
          sectionId: section.sectionId,
          kind: section.kind,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          formNumber: section.formNumber,
          title: section.title,
        }),
      ),
    },
    documentOutline: [],
    declarations: {
      fields: [
        declarationField("policyNumber", profile.policyNumber),
        declarationField("namedInsured", profile.namedInsured),
        declarationField("insurer", profile.insurer),
        declarationField("policyPeriodStart", profile.effectiveDate),
        declarationField("policyPeriodEnd", profile.expirationDate),
        ...profile.declarationFacts.map((declarationFact) => ({
          field: declarationFact.field === "taxId" ? "fein" : declarationFact.field,
          value: declarationFact.value,
          sourceSpanIds: declarationFact.sourceSpanIds,
        })),
      ].filter(Boolean),
    },
    supplementaryFacts: [
      ...profile.endorsementSupport.map((item) =>
        withoutEmpty({
          key: item.kind,
          value: item.summary,
          documentNodeId: item.sourceNodeIds[0],
          sourceSpanIds: item.sourceSpanIds,
        }),
      ),
      ...args.supplementaryFacts,
    ],
    summary: summary || undefined,
  });
}

/** Allowlisted provisional fields from the declarations, written before the full merge. */
export function declarationsPreviewFields(
  outputs: DeclarationsSectionOutput[],
): Record<string, unknown> {
  const first = (
    pick: (output: DeclarationsSectionOutput) => string | null | undefined,
  ) => outputs.map((output) => clean(pick(output))).find(Boolean);
  const party = (...roles: string[]) =>
    first(
      (output) =>
        output.parties.find((candidate) => roles.includes(candidate.role))?.name,
    );
  const carrier = first((output) => output.insurer?.value) ?? party("carrier", "insurer");
  const policyNumber = first((output) => output.policyNumber?.value);
  const insuredName = first((output) => output.namedInsured?.value) ?? party("named_insured");
  const generalAgent = party("general_agent");
  const lobs = outputs.flatMap((output) => output.linesOfBusiness);
  const coverages = outputs
    .flatMap((output) => output.coverages)
    .flatMap((coverage) => {
      const name = clean(coverage.name);
      return name
        ? [
            withoutEmpty({
              name,
              lineOfBusiness: clean(coverage.lineOfBusiness),
              coverageCode: clean(coverage.coverageCode),
              limit: clean(coverage.limit),
              deductible: clean(coverage.deductible),
            }),
          ]
        : [];
    })
    .slice(0, 40);
  return withoutEmpty({
    documentType: "policy",
    carrier,
    security: carrier,
    broker: first((output) => output.broker?.value) ?? party("producer"),
    generalAgent: generalAgent ? { agencyName: generalAgent } : undefined,
    policyNumber,
    programName: first((output) => output.programName?.value),
    effectiveDate: first((output) => output.effectiveDate?.value),
    expirationDate: first((output) => output.expirationDate?.value),
    insuredName,
    premium: first((output) => output.premium?.value),
    totalCost: first((output) => output.totalCost?.value),
    linesOfBusiness: lobs.length > 0 ? toLobCodes(lobs) : undefined,
    coverages: coverages.length > 0 ? coverages : undefined,
    summary:
      [
        carrier,
        policyNumber ? `#${policyNumber}` : undefined,
        insuredName ? `for ${insuredName}` : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  });
}
