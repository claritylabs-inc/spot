"use node";

import dayjs from "dayjs";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type {
  ExtractAnswer,
  ExtractFieldSpec,
  ExtractResponse,
} from "../../../contracts/cl-router/policy";
import { clRouterExtract } from "../clRouterClient";
import type { PolicySection } from "../policySectioning";
import type { PdfPageText } from "../pdfText";
import type { DeclarationsSectionOutput } from "./schemas";

/** The parsed-source subset the fast pass reads. */
export type ParsedPdfText = {
  pages: PdfPageText[];
  textLayerMissing: boolean;
};

export type DeclarationsPageOffset = { page: number; start: number; end: number };

export type DeclarationsState = {
  state: string;
  /** `start`/`end` bound each page's own text (not its "Page N:" header). */
  pageOffsets: DeclarationsPageOffset[];
};

export type DeclarationsFastPass = {
  fields: Partial<DeclarationsSectionOutput>;
  raw: ExtractResponse;
};

/** About 60k tokens of the model's 64k window. */
export const MAX_DECLARATIONS_STATE_CHARS = 240_000;
const MAX_LIST_ITEMS = 60;

const SCALAR_TEXT_KEYS = [
  "policyNumber",
  "namedInsured",
  "insurer",
  "broker",
  "programName",
  "operationsDescription",
  "premium",
  "totalCost",
] as const;
const DATE_KEYS = ["effectiveDate", "expirationDate", "retroactiveDate"] as const;
type ScalarKey = (typeof SCALAR_TEXT_KEYS)[number] | (typeof DATE_KEYS)[number];

const evidenceKey = (key: (typeof DATE_KEYS)[number]) => `${key}Evidence`;

export const DECLARATIONS_FIELDS: Record<string, ExtractFieldSpec> = {
  policyNumber: {
    type: "text",
    instructions: "The policy number of this policy, exactly as written.",
  },
  namedInsured: {
    type: "text",
    instructions: "The first named insured, exactly as written.",
  },
  insurer: {
    type: "text",
    instructions: "The insurance company or carrier issuing the policy.",
  },
  broker: {
    type: "text",
    instructions: "The broker, agent or producer of record.",
  },
  programName: {
    type: "text",
    instructions: "The program or product name of the policy, if stated.",
  },
  operationsDescription: {
    type: "text",
    instructions: "The description of the insured's operations or business.",
  },
  premium: {
    type: "text",
    instructions: "The policy premium before taxes and fees, as written.",
  },
  totalCost: {
    type: "text",
    instructions: "The total cost including taxes and fees, as written.",
  },
  effectiveDate: {
    type: "date",
    instructions:
      "The date the policy period starts: the effective or inception date, such as the 'From' date of 'Policy Period: From X to Y' or a labeled 'Effective Date'. Return the calendar date only and ignore any time of day. Do not use the issue, transaction or retroactive date. Leave empty if no start date is written; never infer a date or assume a year.",
  },
  expirationDate: {
    type: "date",
    instructions:
      "The date the policy period ends: the expiration date, such as the 'To' date of 'Policy Period: From X to Y' or a labeled 'Expiration Date'. Return the calendar date only and ignore any time of day such as '12:01 A.M.'. Do not use the issue, transaction or retroactive date. Leave empty if no end date is written; never infer a date from the effective date, assume a one-year term, or assume a year.",
  },
  retroactiveDate: {
    type: "date",
    instructions:
      "The retroactive date, if the policy is claims-made. Return the calendar date only and ignore any time of day. Leave empty if none is written; never infer a date or assume a year.",
  },
  [evidenceKey("effectiveDate")]: {
    type: "text",
    instructions:
      "The exact text, as written on the page, that states the policy effective date: the start date of the policy period, including the date as written (and its time of day, if given). Copy it verbatim from the page.",
  },
  [evidenceKey("expirationDate")]: {
    type: "text",
    instructions:
      "The exact text, as written on the page, that states the policy expiration date: the end date of the policy period, including the date as written (and its time of day, if given). Copy it verbatim from the page. For a 'From X to Y' period, this is the text containing Y.",
  },
  [evidenceKey("retroactiveDate")]: {
    type: "text",
    instructions:
      "The exact text, as written on the page, that states the retroactive date. Copy it verbatim from the page.",
  },
  formNumbers: {
    type: "list",
    items: "text",
    instructions: "Each form number listed in the forms schedule.",
  },
};

/** Declarations pages, unique and in page order, capped by whole trailing pages. */
export function buildDeclarationsState(
  parsed: ParsedPdfText,
  sections: PolicySection[],
): DeclarationsState {
  const ranges = sections.filter((section) => section.kind === "declarations");
  const wanted = new Set<number>();
  for (const range of ranges)
    for (let page = range.pageStart; page <= range.pageEnd; page++)
      wanted.add(page);
  const byPage = new Map<number, string>();
  for (const page of parsed.pages)
    if (wanted.has(page.page) && !byPage.has(page.page))
      byPage.set(page.page, page.text);

  let state = "";
  const pageOffsets: DeclarationsPageOffset[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const text = byPage.get(page) ?? "";
    const header = `Page ${page}:\n`;
    const chunkLength = header.length + text.length + 2;
    if (state.length + chunkLength > MAX_DECLARATIONS_STATE_CHARS) break;
    const start = state.length + header.length;
    pageOffsets.push({ page, start, end: start + text.length });
    state += `${header}${text}\n\n`;
  }
  return { state, pageOffsets };
}

type Span = { start: number; end: number };

/** A span is usable only if it is a non-empty slice inside one page's text. */
function resolveSpan(
  state: DeclarationsState,
  span: Span | undefined,
): { page: number; quote: string } | null {
  if (!span) return null;
  const { start, end } = span;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > state.state.length) return null;
  const offset = state.pageOffsets.find(
    (candidate) => start >= candidate.start && end <= candidate.end,
  );
  if (!offset) return null;
  const quote = state.state.slice(start, end);
  return quote.trim() ? { page: offset.page, quote } : null;
}

type Answer = ExtractAnswer;

function scalarValue(answer: Answer | undefined): string | null {
  if (!answer || answer.value === null || Array.isArray(answer.value))
    return null;
  const value = String(answer.value).trim();
  return value || null;
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

const DAY_PATTERN =
  /(?<!\d)(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})|([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4}))(?!\d)/g;

function monthNumber(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index >= 0 ? index + 1 : null;
}

/** Calendar-valid date as `YYYY-MM-DD`, or null (e.g. Feb 30). */
function calendarDay(year: number, month: number | null, day: number) {
  if (month === null) return null;
  const date = dayjs(new Date(year, month - 1, day));
  if (
    date.year() !== year ||
    date.month() !== month - 1 ||
    date.date() !== day
  )
    return null;
  return date.format("YYYY-MM-DD");
}

/** Every calendar-valid date written in `text`, normalized to `YYYY-MM-DD`. */
function datesIn(text: string): string[] {
  const days: string[] = [];
  for (const m of text.matchAll(DAY_PATTERN)) {
    const day = m[1]
      ? calendarDay(Number(m[1]), Number(m[2]), Number(m[3]))
      : m[4]
        ? calendarDay(
            m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6]),
            Number(m[4]),
            Number(m[5]),
          )
        : m[7]
          ? calendarDay(Number(m[9]), monthNumber(m[7]), Number(m[8]))
          : calendarDay(Number(m[12]), monthNumber(m[11]), Number(m[10]));
    if (day) days.push(day);
  }
  return days;
}

function parseDay(text: string): string | null {
  const days = datesIn(text.trim());
  const only = days.length === 1 ? days[0] : null;
  return only && text.trim().match(DAY_PATTERN)?.[0] === text.trim() ? only : null;
}

/** True when the evidence text states the same calendar day as the date value. */
function dateGrounded(value: string, evidence: string): boolean {
  const day = parseDay(value);
  return day !== null && datesIn(evidence).includes(day);
}

function listItems(answer: Answer | undefined): string[] {
  if (!answer || !Array.isArray(answer.value)) return [];
  const seen = new Set<string>();
  for (const item of answer.value) {
    const text = String(item).trim();
    if (text) seen.add(text);
  }
  return [...seen].slice(0, MAX_LIST_ITEMS);
}

/** Citations for a list item, only when the provider returned a valid span for it. */
function listCitations(
  state: DeclarationsState,
  answer: Answer | undefined,
  text: string,
) {
  const item = answer?.items?.find(
    (candidate) => candidate.value !== null && String(candidate.value).trim() === text,
  );
  const resolved = resolveSpan(state, item?.span);
  return resolved ? [resolved] : [];
}

export function mapDeclarationsAnswers(
  state: DeclarationsState,
  answers: ExtractResponse["answers"],
): Partial<DeclarationsSectionOutput> {
  const fields: Partial<DeclarationsSectionOutput> = {};
  const setScalar = (
    key: ScalarKey,
    value: string,
    citation: { page: number; quote: string },
  ) => {
    fields[key] = { value, citations: [citation] };
  };

  for (const key of SCALAR_TEXT_KEYS) {
    const value = scalarValue(answers[key]);
    const citation = resolveSpan(state, answers[key]?.span);
    if (value && citation) setScalar(key, value, citation);
  }

  for (const key of DATE_KEYS) {
    const value = scalarValue(answers[key]);
    const evidence = answers[evidenceKey(key)];
    const evidenceText = scalarValue(evidence);
    const citation = resolveSpan(state, evidence?.span);
    if (!value || !evidenceText || !citation) continue;
    const day = parseDay(value);
    if (!day || !dateGrounded(value, citation.quote)) continue;
    setScalar(key, day, citation);
  }

  const forms = listItems(answers.formNumbers);
  if (forms.length)
    fields.forms = forms.map((formNumber) => ({
      formNumber,
      editionDate: null,
      title: null,
      formType: null,
      citations: listCitations(state, answers.formNumbers, formNumber),
    }));

  return fields;
}

export async function runDeclarationsFastPass(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    traceId?: string;
    parsed: ParsedPdfText;
    sections: PolicySection[];
  },
): Promise<DeclarationsFastPass> {
  if (params.parsed.textLayerMissing)
    throw new Error("declarations fast pass: PDF has no text layer");
  const built = buildDeclarationsState(params.parsed, params.sections);
  if (!built.state.trim() || built.pageOffsets.every((o) => o.end === o.start))
    throw new Error("declarations fast pass: declarations pages have no text");
  const raw = await clRouterExtract(
    {
      task: "policy_declarations_fast_pass",
      state: built.state,
      fields: DECLARATIONS_FIELDS,
      ...(params.traceId ? { trace: { traceId: params.traceId } } : {}),
    },
    { orgId: params.orgId, telemetry: ctx },
  );
  return { fields: mapDeclarationsAnswers(built, raw.answers), raw };
}

const SCALAR_KEYS: readonly ScalarKey[] = [...SCALAR_TEXT_KEYS, ...DATE_KEYS];

/** Clairic scalars win over the LLM's; LLM-only structures are kept as-is. */
export function overlayFastPass(
  llmOutput: DeclarationsSectionOutput,
  fastPass: DeclarationsFastPass,
): DeclarationsSectionOutput {
  const result = { ...llmOutput };
  for (const key of SCALAR_KEYS) {
    const value = fastPass.fields[key];
    if (value) result[key] = value;
  }
  return result;
}

/**
 * Complete output for the preview and declarations summary. Fast-pass coverage
 * lists were unreliable, so lines of business and coverages stay empty even
 * when a restored artifact carries them; the LLM extraction supplies both.
 */
export function fastPassAsOutput(
  fastPass: DeclarationsFastPass,
): DeclarationsSectionOutput {
  const { fields } = fastPass;
  return {
    policyNumber: null,
    namedInsured: null,
    insurer: null,
    broker: null,
    effectiveDate: null,
    expirationDate: null,
    retroactiveDate: null,
    programName: null,
    operationsDescription: null,
    premium: null,
    totalCost: null,
    premiumBreakdown: [],
    taxesAndFees: [],
    linesOfBusiness: [],
    parties: [],
    insuredDetails: [],
    coverages: [],
    forms: [],
    ...fields,
    linesOfBusiness: [],
    coverages: [],
  };
}
