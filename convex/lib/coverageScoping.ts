"use node";

import {
  inferLineOfBusinessForOperationalCoverage,
  inferLinesOfBusinessFromOperationalCoverages,
  lobLabel,
  normalizeOperationalLinesOfBusiness,
  resolveAcordCoverageCode,
  type OperationalCoverageLine,
} from "@claritylabs/cl-sdk";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";

export type CoverageLike = Record<string, unknown>;

export type CoverageSourceSpan = {
  id?: unknown;
  text?: unknown;
  pageStart?: unknown;
  pageEnd?: unknown;
  sourceUnit?: unknown;
  metadata?: Record<string, unknown>;
};

export type CoverageScheduleValue = {
  label: string;
  value: string;
};

export type CoverageScheduleItem = {
  label: string;
  description?: string;
  values: CoverageScheduleValue[];
  sourceSpanIds: string[];
};

export type CoverageSchedule = {
  name: string;
  kind: "vehicle" | "property" | "location" | "other";
  description?: string;
  items: CoverageScheduleItem[];
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type CoverageReviewOption = {
  id: string;
  value: string;
  label: string;
  coverage: CoverageLike;
  detail?: string;
  limitType?: string;
  pageNumber?: number;
  sourceLabel?: string;
  reason?: string;
  sourceSpanIds?: string[];
};

export type CoverageReviewQuestion = {
  id: string;
  kind: "coverage_limit_conflict" | "coverage_line_of_business";
  status: "open" | "confirmed" | "broker_help_requested" | "dismissed";
  coverageName: string;
  limitType?: string;
  currentValue?: string;
  recommendedOptionId?: string;
  recommendation?: string;
  question: string;
  reason: string;
  options: CoverageReviewOption[];
  sourceSpanIds?: string[];
  createdAt: number;
};

export type CoverageReviewState = {
  strategyVersion: "coverage-declaration-scope-v1";
  generatedAt: number;
  questions: CoverageReviewQuestion[];
};

type DetailSpan = {
  id?: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  sourceUnit?: string;
};

type MoneyValue = {
  amount: number;
  value: string;
};

type CoverageTerm = {
  kind: string;
  label: string;
  value: string;
  amount?: number;
  appliesTo?: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

const MONEY_PATTERN = /(?:\b(?:CAD|USD)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?/gi;
const COVERAGE_STOP_WORDS = new Set([
  "auto",
  "commercial",
  "coverage",
  "legal",
  "liability",
  "policy",
]);

function normalizeWhitespace(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = normalizeWhitespace(value);
  return text || undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0,
  ))];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function detailSpans(sourceSpans: CoverageSourceSpan[] | undefined): DetailSpan[] {
  if (!Array.isArray(sourceSpans)) return [];
  return sourceSpans.flatMap((span) => {
    const text = textValue(span.text);
    const sourceUnit = textValue(span.sourceUnit) ?? textValue(span.metadata?.sourceUnit);
    if (!text || sourceUnit === "page" || sourceUnit === "table_cell") return [];
    return [{
      id: textValue(span.id),
      text,
      pageStart: typeof span.pageStart === "number" ? span.pageStart : undefined,
      pageEnd: typeof span.pageEnd === "number" ? span.pageEnd : undefined,
      sourceUnit,
    }];
  });
}

function pageText(sourceSpans: CoverageSourceSpan[] | undefined, page: number) {
  const pageSpan = sourceSpans?.find((span) =>
    span.sourceUnit === "page" && span.pageStart === page && typeof span.text === "string",
  );
  return textValue(pageSpan?.text) ?? "";
}

function spansByPage(spans: DetailSpan[]) {
  const pages = new Map<number, DetailSpan[]>();
  for (const span of spans) {
    if (span.pageStart === undefined) continue;
    const rows = pages.get(span.pageStart) ?? [];
    rows.push(span);
    pages.set(span.pageStart, rows);
  }
  return pages;
}

function moneyValue(value: string | undefined): MoneyValue | undefined {
  const match = textValue(value)?.match(MONEY_PATTERN)?.[0];
  if (!match) return undefined;
  const amount = Number(match.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  const currency = match.match(/\b(CAD|USD)\b/i)?.[1]?.toUpperCase();
  const decimals = /\.\d{1,2}\b/.test(match);
  return {
    amount,
    value: `${currency ? `${currency} ` : ""}$${amount.toLocaleString("en-US", {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: 2,
    })}`,
  };
}

function moneyValues(value: string): MoneyValue[] {
  return [...value.matchAll(MONEY_PATTERN)]
    .map((match) => moneyValue(match[0]))
    .filter((item): item is MoneyValue => Boolean(item));
}

function formattedMoney(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizedCoverageName(value: unknown) {
  return textValue(value)
    ?.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:endorsement|insurance)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function coverageTokens(value: unknown) {
  return normalizedCoverageName(value)
    .split(" ")
    .filter((token) => token.length > 2 && !COVERAGE_STOP_WORDS.has(token));
}

function sourceIds(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(stringList))];
}

function coverageTermKey(term: Record<string, unknown>) {
  return [
    textValue(term.label)
      ?.toLowerCase()
      .replace(/["']/g, "")
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    textValue(term.value)?.toLowerCase(),
  ].join("|");
}

function isPremiumTerm(term: Record<string, unknown>) {
  return term.kind === "premium" || /\bpremium\b/i.test(textValue(term.label) ?? "");
}

function isExposureTerm(term: Record<string, unknown>) {
  return /\b(?:exposure|reporting values?|total (?:pd|stated) values?|vehicle pd values?|premium basis|rate)\b/i.test(
    [textValue(term.label), textValue(term.appliesTo)].filter(Boolean).join(" "),
  );
}

function coverageWithoutBilling(value: unknown): CoverageLike | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const limits = Array.isArray(record.limits)
    ? record.limits
        .map(recordValue)
        .filter((term): term is Record<string, unknown> => Boolean(term))
        .filter((term) => !isPremiumTerm(term) && !isExposureTerm(term))
    : [];
  const removedLimit = Array.isArray(record.limits) && record.limits.some((term) => {
    const item = recordValue(term);
    return item && (isPremiumTerm(item) || isExposureTerm(item)) && textValue(item.value) === textValue(record.limit);
  });
  const next = { ...record };
  delete next.premium;
  if (removedLimit || /\b(?:exposure|reporting values?|total (?:pd|stated) values?|vehicle pd values?)\b/i.test(
    [textValue(record.limit), textValue(record.originalContent)].filter(Boolean).join(" "),
  )) {
    delete next.limit;
  }
  if (limits.length > 0) next.limits = limits;
  else delete next.limits;
  const hasCoverageFact = Boolean(
    textValue(next.limit) ||
    textValue(next.deductible) ||
    textValue(next.retroactiveDate) ||
    textValue(next.formNumber) ||
    textValue(next.sectionRef) ||
    limits.length > 0,
  );
  return textValue(next.name) && hasCoverageFact ? next : undefined;
}

function coverageMatchScore(left: CoverageLike, right: CoverageLike) {
  const leftName = normalizedCoverageName(left.name);
  const rightName = normalizedCoverageName(right.name);
  if (!leftName || !rightName) return 0;
  if (leftName === rightName) return 100;
  if (leftName.includes(rightName) || rightName.includes(leftName)) return 80;
  const leftTokens = new Set(coverageTokens(left.name));
  const rightTokens = new Set(coverageTokens(right.name));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (overlap === 0) return 0;
  const sameLob = textValue(left.lineOfBusiness) && left.lineOfBusiness === right.lineOfBusiness;
  return overlap * 10 + (sameLob ? 8 : 0);
}

function mergeCoveragePair(primary: CoverageLike, supplement: CoverageLike): CoverageLike {
  const primaryTerms = Array.isArray(primary.limits) ? primary.limits.map(recordValue).filter(Boolean) : [];
  const supplementTerms = Array.isArray(supplement.limits) ? supplement.limits.map(recordValue).filter(Boolean) : [];
  const limits: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const term of [...primaryTerms, ...supplementTerms]) {
    if (!term || isPremiumTerm(term) || isExposureTerm(term)) continue;
    const key = coverageTermKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    limits.push(term);
  }
  const primaryLimit = textValue(primary.limit);
  const supplementLimit = textValue(supplement.limit);
  return {
    ...supplement,
    ...primary,
    name: textValue(primary.name) ?? textValue(supplement.name) ?? "Coverage",
    lineOfBusiness: textValue(primary.lineOfBusiness) ?? textValue(supplement.lineOfBusiness),
    limit: primaryLimit ?? supplementLimit,
    deductible: textValue(primary.deductible) ?? textValue(supplement.deductible),
    limits,
    sourceNodeIds: sourceIds(primary.sourceNodeIds, supplement.sourceNodeIds),
    sourceSpanIds: sourceIds(primary.sourceSpanIds, supplement.sourceSpanIds),
  };
}

export function mergeCoverageRows(primary: unknown, supplement: unknown): CoverageLike[] {
  const rows = Array.isArray(primary)
    ? primary.map(coverageWithoutBilling).filter((row): row is CoverageLike => Boolean(row))
    : [];
  const additions = Array.isArray(supplement)
    ? supplement.map(coverageWithoutBilling).filter((row): row is CoverageLike => Boolean(row))
    : [];
  for (const addition of additions) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const score = coverageMatchScore(rows[index]!, addition);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex >= 0 && bestScore >= 20) {
      rows[bestIndex] = mergeCoveragePair(rows[bestIndex]!, addition);
    } else {
      rows.push(addition);
    }
  }
  return rows;
}

function termKind(label: string): string {
  if (/\bdeductible\b/i.test(label)) return "deductible";
  if (/\bretention\b/i.test(label)) return "retention";
  if (/\baggregate\b/i.test(label)) return "aggregate_limit";
  if (/\bper\s+(?:occurrence|accident)\b|\beach occurrence\b/i.test(label)) return "each_occurrence_limit";
  if (/\bper claim\b|\beach claim\b/i.test(label)) return "each_claim_limit";
  if (/\bper loss\b|\beach loss\b/i.test(label)) return "each_loss_limit";
  if (/\bsub-?limit\b/i.test(label)) return "sublimit";
  if (/\bretroactive\b/i.test(label)) return "retroactive_date";
  return "other";
}

function cleanTermLabel(value: string) {
  return normalizeWhitespace(value)
    .replace(/^(?:[A-Z]|\d+)[.)]\s*/i, "")
    .replace(/\s+Limit$/i, " Limit")
    .replace(/^Limit$/i, "Limit")
    .trim();
}

function cleanTermValue(value: string) {
  return normalizeWhitespace(value)
    .replace(/,?\s*subject to maximum of\s*\$?\s*$/i, "")
    .replace(/\s*\$\s*$/g, "")
    .trim();
}

function coverageTerm(
  labelInput: string,
  valueInput: string,
  spanIds: string[],
  appliesTo?: string,
): CoverageTerm | undefined {
  const label = cleanTermLabel(labelInput);
  const value = cleanTermValue(valueInput);
  if (!label || !value) return undefined;
  if (!moneyValue(value) && !/\b(?:actual cash value|included|statutory|scheduled|as stated)\b/i.test(value)) {
    return undefined;
  }
  const money = moneyValue(value);
  return {
    kind: termKind(label),
    label,
    value: money?.value ?? value,
    ...(money ? { amount: money.amount } : {}),
    ...(appliesTo ? { appliesTo: normalizeWhitespace(appliesTo) } : {}),
    sourceNodeIds: [],
    sourceSpanIds: spanIds,
  };
}

function pageCoverageLob(pageHeading: string, existingCoverages: CoverageLike[]) {
  const heading = { name: pageHeading };
  let best: CoverageLike | undefined;
  let bestScore = 0;
  for (const coverage of existingCoverages) {
    const score = coverageMatchScore(coverage, heading);
    if (score > bestScore && textValue(coverage.lineOfBusiness)) {
      best = coverage;
      bestScore = score;
    }
  }
  return bestScore >= 20 ? textValue(best?.lineOfBusiness) : undefined;
}

function mainCoverageHeading(text: string) {
  const match = text.match(/^(?:[IVXLCDM]+\.?\s+)?(.+?)\s+COVERAGE$/i);
  if (!match) return undefined;
  const name = normalizeWhitespace(match[1] ?? "");
  if (!name || /\b(?:additional|optional)\b/i.test(name)) return undefined;
  return name;
}

function extractMainDeclarationCoverages(
  pages: Map<number, DetailSpan[]>,
  existingCoverages: CoverageLike[],
): CoverageLike[] {
  const coverages: CoverageLike[] = [];
  for (const [page, spans] of pages) {
    const headingIndex = spans.findIndex((span) => Boolean(mainCoverageHeading(span.text)));
    if (headingIndex < 0) continue;
    const headingSpan = spans[headingIndex]!;
    const name = mainCoverageHeading(headingSpan.text)!;
    const terms: CoverageTerm[] = [];
    let pendingLabel: string | undefined;
    for (let index = headingIndex + 1; index < spans.length; index += 1) {
      const span = spans[index]!;
      if (/^(?:[IVXLCDM]+\.?\s+).+\b(?:PREMIUM|OPTIONAL COVERAGE|ADDITIONAL COVERAGE)\b/i.test(span.text)) break;
      if (/\b(?:covered autos?\s*\/|excluded commodities|excluded operations|unscheduled autos?)\b/i.test(span.text)) {
        pendingLabel = undefined;
        continue;
      }
      const withoutPrefix = span.text.replace(/^(?:[A-Z]|\d+)[.)]\s*/, "");
      const parts = withoutPrefix.match(/^(.+?):\s*(.*)$/);
      if (!parts) {
        if (/\b(?:limit|deductible|retention)\b/i.test(withoutPrefix)) {
          pendingLabel = withoutPrefix;
        }
        continue;
      }
      let label = normalizeWhitespace(parts[1] ?? "");
      let value = normalizeWhitespace(parts[2] ?? "");
      const ids = span.id ? [span.id] : [];
      if (!value) {
        pendingLabel = label;
        continue;
      }
      const next = spans[index + 1];
      if (
        next &&
        !next.text.includes(":") &&
        !moneyValue(value) &&
        /\b(?:scheduled|actual cash value|subject to maximum)\b/i.test(`${value} ${next.text}`)
      ) {
        value = `${value} ${next.text}`;
        if (next.id) ids.push(next.id);
        index += 1;
      }
      let appliesTo: string | undefined;
      if (/^\(/.test(label) && pendingLabel) {
        appliesTo = label.replace(/^\(|\)$/g, "");
        label = pendingLabel;
      }
      if (/^deductible$/i.test(label) && next && /\bper\s+['"]?occurrence/i.test(next.text)) {
        label = "Deductible per Occurrence";
        if (next.id) ids.push(next.id);
        index += 1;
      }
      const term = coverageTerm(label, value, ids, appliesTo);
      if (term) terms.push(term);
      pendingLabel = undefined;
    }
    if (terms.length === 0) continue;
    const primaryLimit = terms.find((term) => term.kind !== "deductible" && term.kind !== "retention");
    const deductible = terms.find((term) => term.kind === "deductible");
    coverages.push({
      name,
      lineOfBusiness: pageCoverageLob(name, existingCoverages),
      limit: primaryLimit?.value,
      deductible: deductible?.value,
      limits: terms,
      sourceNodeIds: [],
      sourceSpanIds: sourceIds(
        headingSpan.id ? [headingSpan.id] : [],
        terms.flatMap((term) => term.sourceSpanIds),
      ),
      pageNumber: page,
    });
  }
  return coverages;
}

function sectionHeading(text: string) {
  const match = text.match(/^(?:[IVXLCDM]+\.?\s+)?((?:OPTIONAL|ADDITIONAL) COVERAGES?(?: ENDORSEMENTS?)?)(?:\s*-\s*(.+))?$/i);
  if (!match) return undefined;
  return {
    label: normalizeWhitespace(match[1] ?? ""),
    scope: textValue(match[2]),
  };
}

function coverageNamesWithAmounts(text: string) {
  const matches: Array<{ name: string; value: string }> = [];
  const pattern = /([A-Za-z][A-Za-z0-9/&()'" -]{2,120}?\bCoverage(?: Endorsement)?(?:\s*\([^)]{1,80}\))?)\s*:\s*(?:Limit\s*:\s*)?((?:\b(?:CAD|USD)\s*)?\$\s*\d[\d,]*(?:\.\d{1,2})?)/gi;
  for (const match of text.matchAll(pattern)) {
    const name = normalizeWhitespace(match[1] ?? "")
      .replace(/^(?:[A-Z]|\d+)[.)]\s*/i, "")
      .replace(/^\d+[.)]\s*/i, "")
      .trim();
    const value = moneyValue(match[2])?.value;
    if (name && value) matches.push({ name, value });
  }
  return matches;
}

function extractNamedCoverageSections(
  pages: Map<number, DetailSpan[]>,
  existingCoverages: CoverageLike[],
): CoverageLike[] {
  const coverages: CoverageLike[] = [];
  for (const [page, spans] of pages) {
    const pageHeading = spans
      .map((span) => mainCoverageHeading(span.text))
      .find((heading): heading is string => Boolean(heading));
    const nearestDeclaration = existingCoverages
      .filter((coverage) => typeof coverage.pageNumber === "number" && coverage.pageNumber <= page)
      .sort((left, right) => Number(right.pageNumber) - Number(left.pageNumber))[0];
    const pageLineOfBusiness = pageHeading
      ? pageCoverageLob(pageHeading, existingCoverages)
      : textValue(nearestDeclaration?.lineOfBusiness);
    let activeSection: ReturnType<typeof sectionHeading>;
    let pending: {
      name: string;
      lineOfBusiness?: string;
      headingSpan: DetailSpan;
      evidence: DetailSpan[];
    } | undefined;
    const flushPending = () => {
      if (!pending) return;
      const evidenceText = pending.evidence.map((span) => span.text).join(" ");
      const declined = /\b(?:decline|declined|not included|not covered|excluded)\b/i.test(evidenceText);
      const terms = pending.evidence.flatMap((span) => {
        const parts = span.text.match(/^(.+?):\s*(.+)$/);
        if (!parts) return [];
        const term = coverageTerm(parts[1] ?? "Limit", parts[2] ?? "", span.id ? [span.id] : []);
        return term ? [term] : [];
      });
      if (!declined && terms.length > 0) {
        const primary = terms.find((term) => term.kind !== "deductible" && term.kind !== "retention");
        const deductible = terms.find((term) => term.kind === "deductible");
        coverages.push({
          name: pending.name,
          lineOfBusiness: pending.lineOfBusiness,
          limit: primary?.value,
          deductible: deductible?.value,
          limits: terms,
          sourceNodeIds: [],
          sourceSpanIds: sourceIds(
            pending.headingSpan.id ? [pending.headingSpan.id] : [],
            terms.flatMap((term) => term.sourceSpanIds),
          ),
          pageNumber: page,
        });
      }
      pending = undefined;
    };

    for (const span of spans) {
      const heading = sectionHeading(span.text);
      if (heading) {
        flushPending();
        activeSection = heading;
        continue;
      }
      if (!activeSection) continue;
      if (/^[IVXLCDM]+\.?\s+[A-Z]/.test(span.text) && !/\bCOVERAGE\b/i.test(span.text)) {
        flushPending();
        activeSection = undefined;
        continue;
      }

      const direct = coverageNamesWithAmounts(span.text);
      if (direct.length > 0) {
        flushPending();
        const lineOfBusiness = pageLineOfBusiness ?? pageCoverageLob(span.text, existingCoverages);
        for (const item of direct) {
          const label = activeSection.scope && /\bper\s+['"]?occurrence/i.test(activeSection.scope)
            ? "Per Occurrence Limit"
            : "Limit";
          const term = coverageTerm(label, item.value, span.id ? [span.id] : []);
          if (!term) continue;
          coverages.push({
            name: item.name,
            lineOfBusiness,
            limit: item.value,
            limits: [term],
            sourceNodeIds: [],
            sourceSpanIds: span.id ? [span.id] : [],
            pageNumber: page,
          });
        }
        continue;
      }

      const pendingHeading = span.text.match(/^(?:[A-Z]|\d+)[.)]\s*(.+?\bCoverage(?: Endorsement)?)\s*:\s*$/i);
      if (pendingHeading) {
        flushPending();
        const name = normalizeWhitespace(pendingHeading[1] ?? "");
        pending = {
          name,
          lineOfBusiness: pageLineOfBusiness ?? pageCoverageLob(name, existingCoverages),
          headingSpan: span,
          evidence: [],
        };
        continue;
      }
      if (pending) pending.evidence.push(span);
    }
    flushPending();
  }
  return coverages;
}

function scheduleKind(name: string): CoverageSchedule["kind"] {
  if (/\b(?:auto|vehicle|trailer)\b/i.test(name)) return "vehicle";
  if (/\bproperty\b/i.test(name)) return "property";
  if (/\b(?:location|premises|building|statement of values)\b/i.test(name)) return "location";
  return "other";
}

function scheduleHeading(text: string) {
  if (/\b(?:forms? and endorsements?|schedule of forms)\b/i.test(text)) return undefined;
  if (
    /^(?:covered\s+)?(?:auto|vehicle|trailer|property|location|premises|building).*\bschedule\b/i.test(text) ||
    /^schedule of (?:vehicles|locations|property|premises|buildings)\b/i.test(text) ||
    /^statement of values\b/i.test(text)
  ) {
    return text;
  }
  return undefined;
}

function scheduleValues(description: string): CoverageScheduleValue[] {
  const values: CoverageScheduleValue[] = [];
  for (const part of description.split("|")) {
    const match = normalizeWhitespace(part).match(/^([^:]{1,60}):\s*(.+)$/);
    if (!match) continue;
    const label = normalizeWhitespace(match[1] ?? "").replace(/^\d+[.)]\s*/, "");
    const value = normalizeWhitespace(match[2] ?? "").replace(/\b(?:VEHICLE|TRAILER) SCHEDULE\b/gi, "").trim();
    if (!label || !value) continue;
    values.push({ label, value });
  }
  return values;
}

function extractCoverageSchedules(
  sourceSpans: CoverageSourceSpan[] | undefined,
  pages: Map<number, DetailSpan[]>,
): CoverageSchedule[] {
  const schedules: CoverageSchedule[] = [];
  for (const [page, spans] of pages) {
    const headingSpan = spans.find((span) => Boolean(scheduleHeading(span.text)));
    const name = headingSpan ? scheduleHeading(headingSpan.text) : undefined;
    if (!headingSpan || !name) continue;
    const pageCorpus = pageText(sourceSpans, page) || spans.map((span) => span.text).join(" ");
    if (!/\b(?:covered under this policy|coverage active|stated amount|location|premises|property)\b/i.test(pageCorpus)) {
      continue;
    }
    const evidenceSpans = spans.filter((span) =>
      span !== headingSpan &&
      !/\b(?:please read it carefully|all other terms|page \d+ of \d+)\b/i.test(span.text),
    );
    const rowSpans = evidenceSpans.filter((span) =>
      /(?:^|\s)\d+[.)]\s+|\|/.test(span.text) &&
      /\b(?:VIN|address|location|building|premises|limit|value|coverage|status|deductible)\b/i.test(span.text),
    );
    const joined = rowSpans
      .map((span) => span.text)
      .join(" ")
      .replace(/\b(?:VEHICLE|TRAILER) SCHEDULE\b/gi, " ");
    const items: CoverageScheduleItem[] = [];
    const itemPattern = /(?:^|\s)(\d+)[.)]\s*(.*?)(?=(?:\s+\d+[.)]\s*)|$)/g;
    for (const match of joined.matchAll(itemPattern)) {
      const number = Number(match[1]);
      const description = normalizeWhitespace(match[2] ?? "");
      if (!description) continue;
      const values = scheduleValues(description);
      if (values.length === 0 && description.length < 3) continue;
      items.push({
        label: `${scheduleKind(name) === "vehicle" ? "Scheduled vehicle" : "Scheduled item"} ${number}`,
        ...(values.length === 0 ? { description } : {}),
        values,
        sourceSpanIds: sourceIds(rowSpans.map((span) => span.id).filter(Boolean)),
      });
    }
    if (items.length === 0) {
      for (const [index, span] of rowSpans.entries()) {
        const values = scheduleValues(span.text);
        if (values.length === 0) continue;
        items.push({
          label: `Scheduled item ${index + 1}`,
          values,
          sourceSpanIds: span.id ? [span.id] : [],
        });
      }
    }
    if (items.length === 0) continue;
    const exclusion = pageCorpus.match(/\b(Unscheduled\s+(?:autos?|vehicles?|trailers?|property|locations?)[^.]{0,140}\bexcluded\.)/i)?.[1];
    schedules.push({
      name,
      kind: scheduleKind(name),
      ...(exclusion ? { description: normalizeWhitespace(exclusion) } : {}),
      items,
      sourceSpanIds: sourceIds(
        headingSpan.id ? [headingSpan.id] : [],
        items.flatMap((item) => item.sourceSpanIds),
      ),
      pageStart: page,
      pageEnd: page,
    });
  }
  return schedules;
}

function premiumRowsFromCoverages(coverages: unknown): Array<{
  line: string;
  amount: string;
  amountValue: number;
  sourceSpanIds?: string[];
}> {
  if (!Array.isArray(coverages)) return [];
  return coverages.flatMap((coverage) => {
    const record = recordValue(coverage);
    const name = textValue(record?.name);
    const money = moneyValue(textValue(record?.premium));
    if (!name || !money) return [];
    return [{
      line: name,
      amount: money.value,
      amountValue: money.amount,
      ...(stringList(record?.sourceSpanIds).length > 0
        ? { sourceSpanIds: stringList(record?.sourceSpanIds) }
        : {}),
    }];
  });
}

function premiumRowsFromSource(spans: DetailSpan[]) {
  const rows: Array<{
    line: string;
    amount: string;
    amountValue: number;
    sourceSpanIds: string[];
  }> = [];
  for (const span of spans) {
    if (!/\bPREMIUM\b/i.test(span.text) || /\b(?:TOTAL|FEE|TAX|PREMIUM\s*&\s*FEES)\b/i.test(span.text)) continue;
    for (const segment of span.text.split("|").slice(1)) {
      const match = segment.match(/^\s*([^:]{2,120}):\s*(.+)$/);
      const money = moneyValue(match?.[2]);
      const line = textValue(match?.[1]);
      if (!line || !money) continue;
      rows.push({
        line,
        amount: money.value,
        amountValue: money.amount,
        sourceSpanIds: span.id ? [span.id] : [],
      });
    }
  }
  return rows;
}

function totalPayableFromSource(spans: DetailSpan[]): (MoneyValue & { sourceSpanIds: string[] }) | undefined {
  const candidates: Array<MoneyValue & { sourceSpanIds: string[]; score: number }> = [];
  for (const span of spans) {
    if (!/\bTOTAL\s+(?:PREMIUM|COST|PAYABLE|DUE)\b/i.test(span.text)) continue;
    const values = moneyValues(span.text);
    for (const money of values) {
      let score = money.amount;
      if (/\bWITH\s+FEES?\s*(?:&|AND)\s*TAX(?:ES)?\b/i.test(span.text)) score += 1_000_000_000;
      if (/^TOTAL\s+(?:PREMIUM|COST|PAYABLE|DUE)\s*:/i.test(span.text)) score += 500_000_000;
      if (values.length === 1) score += 100_000_000;
      candidates.push({
        ...money,
        sourceSpanIds: span.id ? [span.id] : [],
        score,
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0];
}

function feeRowsFromSource(spans: DetailSpan[]) {
  const preferred = spans.filter((span) =>
    /\bFEE\b/i.test(span.text) &&
    !/\b(?:TOTAL FEE|included in|Other Fee:\s*\$?0)\b/i.test(span.text) &&
    (span.sourceUnit === "table_row" || moneyValues(span.text).length > 1),
  );
  const rows: Array<{
    name: string;
    amount: string;
    amountValue: number;
    type: "fee";
    sourceSpanIds: string[];
  }> = [];
  for (const span of preferred) {
    const label = textValue(span.text.match(/(?:^|:\s*)([A-Za-z][A-Za-z ]{0,50}Fee)\b/i)?.[1]);
    const values = moneyValues(span.text).filter((money) => money.amount > 0);
    if (!label || values.length === 0) continue;
    const amount = values.reduce((sum, money) => sum + money.amount, 0);
    rows.push({
      name: label,
      amount: formattedMoney(amount),
      amountValue: amount,
      type: "fee",
      sourceSpanIds: span.id ? [span.id] : [],
    });
  }
  const byName = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    const current = byName.get(key);
    if (!current || row.amountValue > current.amountValue) byName.set(key, row);
  }
  return [...byName.values()];
}

function applyFinancialSeparation(
  fields: Record<string, unknown>,
  rawCoverages: unknown,
  spans: DetailSpan[],
) {
  const fromCoverages = premiumRowsFromCoverages(rawCoverages);
  const premiumBreakdown = fromCoverages.length > 0 ? fromCoverages : premiumRowsFromSource(spans);
  if (premiumBreakdown.length === 0) return fields;
  const premiumAmount = premiumBreakdown.reduce((sum, row) => sum + row.amountValue, 0);
  const totalPayable = totalPayableFromSource(spans);
  const currentPremium = moneyValue(textValue(fields.premium));
  const total = totalPayable ?? (
    currentPremium && currentPremium.amount > premiumAmount
      ? { ...currentPremium, sourceSpanIds: [] }
      : undefined
  );
  const next = {
    ...fields,
    premium: formattedMoney(premiumAmount),
    premiumAmount,
    premiumBreakdown,
  };
  if (!total || total.amount + 0.005 < premiumAmount) return next;
  const fees = feeRowsFromSource(spans);
  const feeAmount = fees.reduce((sum, row) => sum + row.amountValue, 0);
  const taxAmount = Math.round((total.amount - premiumAmount - feeAmount) * 100) / 100;
  const taxesAndFees: Array<Record<string, unknown>> = [...fees];
  if (taxAmount > 0.005) {
    taxesAndFees.push({
      name: "Taxes",
      amount: formattedMoney(taxAmount),
      amountValue: taxAmount,
      type: "tax",
      description: "Calculated from total payable less premium and extracted fees.",
      sourceSpanIds: sourceIds(
        total.sourceSpanIds,
        premiumBreakdown.flatMap((row) => row.sourceSpanIds ?? []),
        fees.flatMap((row) => row.sourceSpanIds),
      ),
    });
  }
  return {
    ...next,
    totalCost: total.value,
    totalCostAmount: total.amount,
    ...(taxesAndFees.length > 0 ? { taxesAndFees } : {}),
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function declarationScopedFields(
  fields: Record<string, unknown>,
  sourceSpans: CoverageSourceSpan[] | undefined,
  inferLinesOfBusiness: boolean,
): Record<string, unknown> {
  const spans = detailSpans(sourceSpans);
  const pages = spansByPage(spans);
  const existingCoverages = Array.isArray(fields.coverages)
    ? fields.coverages.map(recordValue).filter((row): row is CoverageLike => Boolean(row))
    : [];
  // Declaration rows borrow a line of business from name-matched existing rows
  // only on the rule-based path; the classifier path assigns lines itself.
  const lineReference = inferLinesOfBusiness ? existingCoverages : [];
  const mainDeclarationCoverages = extractMainDeclarationCoverages(pages, lineReference);
  const declarationCoverages = [
    ...mainDeclarationCoverages,
    ...extractNamedCoverageSections(
      pages,
      inferLinesOfBusiness ? [...existingCoverages, ...mainDeclarationCoverages] : [],
    ),
  ];
  const coverages = mergeCoverageRows(existingCoverages, declarationCoverages);
  const schedules = extractCoverageSchedules(sourceSpans, pages);
  return applyFinancialSeparation({
    ...fields,
    coverages,
    ...(schedules.length > 0 ? { coverageSchedules: schedules } : {}),
  }, fields.coverages, spans);
}

export function applyCoverageDeclarationScoping({
  fields,
  sourceSpans,
  nowMs,
}: {
  fields: Record<string, unknown>;
  sourceSpans?: CoverageSourceSpan[];
  nowMs: number;
}): {
  fields: Record<string, unknown>;
  review: CoverageReviewState;
  changed: boolean;
} {
  const nextFields = declarationScopedFields(fields, sourceSpans, true);
  return {
    fields: nextFields,
    review: {
      strategyVersion: "coverage-declaration-scope-v1",
      generatedAt: nowMs,
      questions: [],
    },
    changed: !sameJson(fields, nextFields),
  };
}

const MAX_COVERAGE_SCOPE_QUESTIONS = 100;

function coverageLineReviewQuestion(
  coverage: CoverageLike,
  index: number,
  candidates: string[],
  recommended: string | undefined,
  nowMs: number,
): CoverageReviewQuestion {
  const coverageName = textValue(coverage.name) ?? "Coverage";
  const options = candidates.map((code): CoverageReviewOption => ({
    id: `line:${code}`,
    value: code,
    label: lobLabel(code),
    coverage: { ...coverage, lineOfBusiness: code },
    sourceSpanIds: stringList(coverage.sourceSpanIds),
  }));
  const recommendedOption = options.find((option) => option.value === recommended);
  return {
    id: `coverage_line_of_business:${index}:${normalizedCoverageName(coverageName) || "coverage"}`,
    kind: "coverage_line_of_business",
    status: "open",
    coverageName,
    ...(textValue(coverage.limit) ? { currentValue: textValue(coverage.limit) } : {}),
    ...(recommendedOption
      ? {
          recommendedOptionId: recommendedOption.id,
          recommendation: `${recommendedOption.label} is the most likely line, but the declarations do not state it clearly.`,
        }
      : {}),
    question: `Which line of business does ${coverageName} belong to?`,
    reason: "This coverage appears on a multi-line policy without a clear line of business.",
    options,
    sourceSpanIds: stringList(coverage.sourceSpanIds),
    createdAt: nowMs,
  };
}

/**
 * Declaration scoping with Jev assigning each unscoped coverage row to one of
 * the policy's ACORD lines. Rows with one deterministic candidate are assigned
 * without a decision; low-confidence rows stay unscoped with a review question.
 * Router failures fall back to the rule-based scoping.
 */
export async function scopeCoveragesWithClassifier(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  fields: Record<string, unknown>;
  sourceSpans?: CoverageSourceSpan[];
  nowMs: number;
  traceId?: string;
}): Promise<{
  fields: Record<string, unknown>;
  review: CoverageReviewState;
  changed: boolean;
  classifiedCount: number;
}> {
  const scoped = declarationScopedFields(params.fields, params.sourceSpans, false);
  const coverages = (scoped.coverages as CoverageLike[]).map((coverage) => ({ ...coverage }));
  const policyLines = normalizeOperationalLinesOfBusiness(params.fields.linesOfBusiness)
    .filter((code) => code !== "UN");
  const rowLines = coverages.map((coverage) =>
    inferLineOfBusinessForOperationalCoverage(
      coverage as OperationalCoverageLine,
      policyLines,
    )
  );
  const knownLines = [...new Set([
    ...policyLines,
    ...rowLines.filter((code): code is NonNullable<typeof code> => Boolean(code)),
  ])];
  const pending: Array<{ index: number; key: string; candidates: string[] }> = [];
  coverages.forEach((coverage, index) => {
    const line = rowLines[index];
    if (line) {
      coverage.lineOfBusiness = line;
      return;
    }
    const candidates = [...new Set([
      ...inferLinesOfBusinessFromOperationalCoverages([coverage as OperationalCoverageLine]),
      ...knownLines,
    ])].filter((code) => code !== "UN");
    if (candidates.length >= 2 && pending.length < MAX_COVERAGE_SCOPE_QUESTIONS) {
      pending.push({ index, key: `coverage_${index}`, candidates });
    }
  });

  const review: CoverageReviewState = {
    strategyVersion: "coverage-declaration-scope-v1",
    generatedAt: params.nowMs,
    questions: [],
  };
  let classifiedCount = 0;
  if (pending.length > 0) {
    try {
      const result = await clRouterDecide({
        orgId: String(params.orgId),
        task: "policy_extraction_coverage_scope",
        state: {
          policyLinesOfBusiness: knownLines.map((code) => ({ code, label: lobLabel(code) })),
          coverages: Object.fromEntries(pending.map(({ index, key }) => {
            const coverage = coverages[index]!;
            const coverageCode = resolveAcordCoverageCode(coverage.coverageCode, coverage.name);
            return [key, {
              name: textValue(coverage.name) ?? "Coverage",
              ...(coverageCode ? { acordCoverageCode: coverageCode } : {}),
              ...Object.fromEntries(
                ["limit", "deductible", "formNumber", "sectionRef", "originalContent"]
                  .flatMap((field) => {
                    const value = textValue(coverage[field]);
                    return value ? [[field, value.slice(0, 300)]] : [];
                  }),
              ),
              ...(typeof coverage.pageNumber === "number" ? { pageNumber: coverage.pageNumber } : {}),
            }];
          })),
        },
        questions: Object.fromEntries(pending.map(({ key, candidates }) => [key, {
          type: "choice" as const,
          instructions: `Which line of business on this policy does coverage ${key} belong to? Use the coverage name, form, section, and ACORD coverage code. Choose none when it belongs to none of the listed lines.`,
          criteria: {
            ...Object.fromEntries(candidates.map((code) => [code, lobLabel(code)])),
            none: "None of the listed lines of business.",
          },
        }])),
        trace: params.traceId ? { traceId: params.traceId } : undefined,
      }, { telemetry: params.ctx });
      for (const { index, key, candidates } of pending) {
        const answer = result.answers[key];
        if (answer?.type !== "choice") continue;
        const confidence = Math.min(
          answer.confidence,
          answer.probabilities[answer.choice] ?? 0,
        );
        if (!jevProceeds(confidence)) {
          review.questions.push(coverageLineReviewQuestion(
            coverages[index]!,
            index,
            candidates,
            answer.choice,
            params.nowMs,
          ));
        } else if (candidates.includes(answer.choice)) {
          coverages[index]!.lineOfBusiness = answer.choice;
          classifiedCount += 1;
        }
      }
    } catch {
      return {
        ...applyCoverageDeclarationScoping({
          fields: params.fields,
          sourceSpans: params.sourceSpans,
          nowMs: params.nowMs,
        }),
        classifiedCount: 0,
      };
    }
  }

  const existingReview = recordValue(params.fields.extractionReview);
  const nextFields: Record<string, unknown> = {
    ...scoped,
    coverages,
    ...(review.questions.length > 0
      ? {
          extractionReview: {
            ...review,
            questions: [
              ...(Array.isArray(existingReview?.questions) ? existingReview.questions : []),
              ...review.questions,
            ],
          },
        }
      : {}),
  };
  return {
    fields: nextFields,
    review,
    changed: !sameJson(params.fields, nextFields),
    classifiedCount,
  };
}
