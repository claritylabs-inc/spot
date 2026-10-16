"use node";

// Owner: P2 (docs/architecture/convex-section-extraction.md).
// Plans policy sections from page text (form numbers first, then Jev per-page
// classification) and slices the original PDF per section.

import { createHash } from "crypto";
import { PDFDocument } from "pdf-lib";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PdfPageText } from "./pdfText";
import {
  clRouterDecide,
  isClRouterPayloadTooLarge,
  runWithPayloadSplitting,
} from "./clRouterClient";
import { pdfPageJevImage, stageJevImages } from "./jevImages";
import { renderPdfPageImages } from "./pdfPageImages";
import { jevProceeds } from "./jevThreshold";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";


export const POLICY_SECTION_KINDS = [
  "declarations",
  "schedule",
  "forms_list",
  "coverage_form",
  "endorsement",
  "application",
  "invoice",
  "notice",
  "other",
] as const;

export type PolicySectionKind = (typeof POLICY_SECTION_KINDS)[number];

/** Hard bounds for one section slice sent to a model. Larger sections are split into consecutive parts of the same kind. */
export const MAX_SECTION_PAGES = 30;
export const MAX_SECTION_BYTES = 10 * 1024 * 1024;

export type PolicyPageLabel = {
  page: number;
  kind: PolicySectionKind;
  startsNewDocument: boolean;
  formNumber?: string;
  confidence: number;
  source: "form_number" | "classifier" | "fallback";
};

export type PolicySection = {
  /** Stable within a plan: `${kind}-${pageStart}-${pageEnd}`. */
  sectionId: string;
  kind: PolicySectionKind;
  /** 1-based inclusive page range in the original PDF. */
  pageStart: number;
  pageEnd: number;
  formNumber?: string;
  title?: string;
  /** Minimum page-label confidence in the section. */
  confidence: number;
  /** Set when a larger logical section was split to respect MAX_SECTION_*. */
  part?: { index: number; count: number };
};

export type PolicySectionPlan = {
  version: "policy-section-plan-v1";
  pageCount: number;
  pageLabels: PolicyPageLabel[];
  /** Ordered, contiguous, non-overlapping; union covers pages 1..pageCount exactly once. */
  sections: PolicySection[];
  /** Stable hash of pageCount + sections (used for invocation keys and promotion). */
  planHash: string;
};

/** Compact per-page digest used both for deterministic form-number detection and as Jev context. */
export type PolicyPageDigest = {
  page: number;
  formNumber?: string;
  headings: string[];
  headLines: string[];
  footLines: string[];
};

// Heading phrases checked in canonical order; more specific phrases are listed
// before the generic ones they overlap with (e.g. the endorsement preamble
// before the bare "ENDORSEMENT" heading).
const HEADING_PHRASES = [
  "THIS ENDORSEMENT CHANGES THE POLICY",
  "DECLARATIONS",
  "SCHEDULE OF",
  "ENDORSEMENT",
  "FORMS AND ENDORSEMENTS",
  "APPLICATION",
  "INVOICE",
  "NOTICE",
  "POLICYHOLDER DISCLOSURE",
] as const;

// ISO/carrier form numbers: "CG 00 01 04 13", "IL 00 17 11 98", "WC 00 00 00 C".
const ISO_FORM_NUMBER_PATTERN =
  /\b[A-Z]{2}\s\d{2}\s\d{2}\s\d{2}(?:\s\d{2}|\s[A-Z])?\b/;
// Carrier-style: "ABC-123 (01/20)".
const CARRIER_FORM_NUMBER_PATTERN =
  /\b[A-Z]{2,6}-\d{2,6}\s?\(\d{1,2}\/\d{2,4}\)/;

// Headings that disqualify a form-numbered run from deterministic
// coverage_form/endorsement classification: these pages carry a printed form
// number (declarations pages, forms schedules) but are not themselves the
// form's own coverage wording or endorsement text, so the kind is ambiguous.
const NON_FORM_HEADING_PHRASES = [
  "DECLARATIONS",
  "SCHEDULE OF",
  "SCHEDULE",
  "FORMS AND ENDORSEMENTS",
  "FORMS SCHEDULE",
  "APPLICATION",
  "INVOICE",
  "NOTICE",
] as const;

// A head line that is itself an endorsement title ("ENDORSEMENT", "ENDORSEMENT
// NO. 3"), not a substring match against phrases like "FORMS AND
// ENDORSEMENTS" or "attached endorsements".
const ENDORSEMENT_TITLE_PATTERN = /^ENDORSEMENT\b/;
const ENDORSEMENT_NUMBER_PATTERN = /\bENDORSEMENT\s*(NO\.?|#|NUMBER)/;

const DIGEST_HEAD_LINES = 12;
const DIGEST_FOOT_LINES = 4;
const DIGEST_LINE_MAX_CHARS = 70;
const DIGEST_MAX_CHARS = 1200;

/** Text-digest fallback batches (no PDF bytes or rendering failed). */
const JEV_BATCH_PAGES = 25;
/** Image batches: about 2.5k tokens per 1024px page keeps a batch and its context in Jev's window. */
const JEV_IMAGE_BATCH_PAGES = 8;
const JEV_BATCH_CONCURRENCY = 4;

function isPolicySectionKind(value: unknown): value is PolicySectionKind {
  return (
    typeof value === "string" &&
    (POLICY_SECTION_KINDS as readonly string[]).includes(value)
  );
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function truncateLine(line: string): string {
  return line.length > DIGEST_LINE_MAX_CHARS
    ? `${line.slice(0, DIGEST_LINE_MAX_CHARS - 1)}…`
    : line;
}

function detectHeadings(lines: string[]): string[] {
  const upperLines = lines.map((line) => line.toUpperCase());
  return HEADING_PHRASES.filter((phrase) =>
    upperLines.some((line) => line.includes(phrase)),
  );
}

function detectFormNumber(lines: string[]): string | undefined {
  for (const line of lines) {
    const iso = line.match(ISO_FORM_NUMBER_PATTERN);
    if (iso) return iso[0].replace(/\s+/g, " ").trim();
    const carrier = line.match(CARRIER_FORM_NUMBER_PATTERN);
    if (carrier) return carrier[0].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function buildPageDigest(page: PdfPageText): PolicyPageDigest {
  const lines = nonEmptyLines(page.text).map(truncateLine);
  const headLines = lines.slice(0, DIGEST_HEAD_LINES);
  const footLines =
    lines.length > DIGEST_HEAD_LINES ? lines.slice(-DIGEST_FOOT_LINES) : [];
  const formNumber = detectFormNumber([...footLines, ...headLines]);
  const headings = detectHeadings(lines);

  const footBudget = footLines.reduce((sum, line) => sum + line.length + 1, 0);
  const headBudget = Math.max(0, DIGEST_MAX_CHARS - footBudget);
  const cappedHead: string[] = [];
  let used = 0;
  for (const line of headLines) {
    const needed = line.length + 1;
    if (used + needed > headBudget) break;
    cappedHead.push(line);
    used += needed;
  }

  return {
    page: page.page,
    ...(formNumber ? { formNumber } : {}),
    headings,
    headLines: cappedHead,
    footLines,
  };
}

function hasNonFormHeading(lines: string[]): boolean {
  const upperLines = lines.map((line) => line.toUpperCase());
  return NON_FORM_HEADING_PHRASES.some((phrase) =>
    upperLines.some((line) => line.includes(phrase)),
  );
}

function hasEndorsementTitle(lines: string[]): boolean {
  return lines.some((line) => {
    const upper = line.toUpperCase().trim();
    return (
      ENDORSEMENT_TITLE_PATTERN.test(upper) ||
      ENDORSEMENT_NUMBER_PATTERN.test(upper)
    );
  });
}

function hasCoverageFormTitle(firstPage: PolicyPageDigest): boolean {
  return firstPage.headLines
    .slice(0, 3)
    .some((line) => /\bCOVERAGE FORM\b/.test(line.toUpperCase()));
}

/** Strong textual signals for a run of pages sharing one form number. Null means ambiguous (send to Jev). */
function classifyFormRun(
  run: PolicyPageDigest[],
): { kind: "coverage_form" | "endorsement"; confidence: number } | null {
  const text = run
    .flatMap((digest) => [...digest.headLines, ...digest.footLines])
    .join(" \n ")
    .toUpperCase();
  if (text.includes("THIS ENDORSEMENT CHANGES THE POLICY")) {
    return { kind: "endorsement", confidence: 0.97 };
  }

  // Declarations pages and forms schedules often carry a printed form number
  // but are not the form's own coverage wording or endorsement text.
  const firstPage = run[0];
  if (hasNonFormHeading(firstPage.headLines)) {
    return null;
  }

  if (hasCoverageFormTitle(firstPage)) {
    return { kind: "coverage_form", confidence: 0.9 };
  }
  if (run.some((digest) => hasEndorsementTitle(digest.headLines))) {
    return { kind: "endorsement", confidence: 0.8 };
  }
  return null;
}

function pageKindQuestion(page: number): DecisionQuestion {
  return {
    type: "choice",
    instructions: `Classify \`pages.page_${page}\` (original PDF page ${page}) by its predominant content, using its page image (or its text digest when no image is supplied).`,
    criteria: {
      declarations: "The policy declarations page: named insured, policy period, premium, limits summary.",
      schedule: "A schedule listing locations, vehicles, drivers, classifications, or other scheduled items.",
      forms_list: "A list of forms and endorsements attached to the policy (a 'Forms and Endorsements' schedule).",
      coverage_form: "Base policy coverage form wording defining insuring agreements, exclusions, conditions, and definitions.",
      endorsement: "An endorsement that changes or modifies the policy's coverage form.",
      application: "An insurance application or supplemental application questionnaire.",
      invoice: "A premium invoice, billing statement, or payment notice.",
      notice: "A regulatory or informational notice, disclosure, or policyholder notification.",
      other: "None of the above, or insufficient evidence to classify confidently.",
    },
  };
}

function pageBoundaryQuestion(page: number): DecisionQuestion {
  return {
    type: "noul",
    instructions: `Does \`pages.page_${page}\` (original PDF page ${page}) begin a new document, form, or endorsement compared with \`pages.page_${page - 1}\`?`,
    criteria: {
      true: "Page begins a new form, endorsement, or document (e.g. a new form number, title, or heading appears).",
      false: "Page continues the same form/document as the previous page.",
    },
  };
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

async function classifyRemainingPages(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  pageCount: number;
  remaining: number[];
  pdfBytes?: Uint8Array;
  getDigest: (page: number) => PolicyPageDigest;
  labels: PolicyPageLabel[];
  traceId?: string;
}): Promise<void> {
  const { ctx, orgId, pageCount, remaining, getDigest, labels, traceId } =
    params;
  const hasText = (page: number) => {
    const digest = getDigest(page);
    return digest.headLines.length > 0 || digest.footLines.length > 0;
  };
  // Jev judges pages from their rendered images, never their extracted text;
  // the text digest is used only by code (form numbers) and as a fallback.
  const imagePagesAllowed = new Set(
    params.pdfBytes
      ? [...new Set(remaining.flatMap((page) => [page - 1, page, page + 1]))]
          .filter((page) => page >= 1 && page <= pageCount)
          .sort((a, b) => a - b)
      : [],
  );
  const batchSize = params.pdfBytes ? JEV_IMAGE_BATCH_PAGES : JEV_BATCH_PAGES;
  const batches: number[][] = [];
  let batch: number[] = [];
  for (const page of remaining) {
    if (!hasText(page) && !imagePagesAllowed.has(page)) {
      labels[page - 1] = {
        page,
        kind: "other",
        startsNewDocument: page === 1,
        confidence: 0,
        source: "fallback",
      };
      continue;
    }
    if (batch.length >= batchSize) {
      batches.push(batch);
      batch = [];
    }
    batch.push(page);
  }
  if (batch.length) batches.push(batch);

  // A batch whose page images exceed the router size limit is halved and retried.
  await runBounded(batches, JEV_BATCH_CONCURRENCY, async (pages) => {
    await runWithPayloadSplitting(pages, labelBatch);
  });

  async function labelBatch(batchPages: number[]): Promise<void> {
    const first = batchPages[0];
    const last = batchPages[batchPages.length - 1];
    const contextBefore = first > 1 ? first - 1 : undefined;
    const contextAfter = last < pageCount ? last + 1 : undefined;

    const deterministicBoundary = (page: number): boolean | undefined => {
      if (page === 1) return true;
      const current = getDigest(page).formNumber;
      const previous = getDigest(page - 1).formNumber;
      return current && previous ? current !== previous : undefined;
    };

    const questions: Record<string, DecisionQuestion> = {};
    for (const page of batchPages) {
      questions[`kind_${page}`] = pageKindQuestion(page);
      if (deterministicBoundary(page) === undefined)
        questions[`boundary_${page}`] = pageBoundaryQuestion(page);
    }
    // Include the actual predecessor of every questioned page, even across form runs.
    const statePages = [
      ...new Set([
        ...(contextBefore !== undefined ? [contextBefore] : []),
        ...batchPages.flatMap((page) => (page > 1 ? [page - 1, page] : [page])),
        ...(contextAfter !== undefined ? [contextAfter] : []),
      ]),
    ].map((page) => ({
      ...getDigest(page),
      contextOnly: !batchPages.includes(page),
    }));
    let staged: Awaited<ReturnType<typeof stageJevImages>> | undefined;
    try {
      const imagePages = statePages.filter((page) =>
        imagePagesAllowed.has(page.page),
      );
      const imageRefs = new Map<number, string>();
      try {
        const images =
          params.pdfBytes && imagePages.length
            ? await renderPdfPageImages({
                pdfBytes: params.pdfBytes,
                pages: imagePages.map((page) => page.page),
                maxSide: 1024,
              })
            : [];
        if (images.length) {
          staged = await stageJevImages(ctx, images.map(pdfPageJevImage), {
            orgId,
            surface: "policy-sectioning",
            sessionKey: traceId ?? crypto.randomUUID(),
          });
          images.forEach((image, i) =>
            imageRefs.set(image.page, staged!.refs[i]),
          );
        }
      } catch (error) {
        console.warn(
          "Section images unavailable; using text evidence",
          error instanceof Error ? error.message : String(error),
        );
      }
      const result = await clRouterDecide(
        {
          orgId: String(orgId),
          task: "policy_page_sectioning",
          state: {
            pages: Object.fromEntries(
              statePages.map((page) => [
                `page_${page.page}`,
                imageRefs.has(page.page)
                  ? {
                      page: page.page,
                      contextOnly: page.contextOnly,
                      image: imageRefs.get(page.page)!,
                    }
                  : page,
              ]),
            ),
          },
          ...(staged ? { assets: staged.assets } : {}),
          questions,
          trace: traceId ? { traceId } : undefined,
        },
        { telemetry: ctx },
      );

      for (const page of batchPages) {
        const kindAnswer = result.answers[`kind_${page}`];
        const boundaryAnswer = result.answers[`boundary_${page}`];
        const confidence =
          kindAnswer?.type === "choice"
            ? Math.min(
                kindAnswer.confidence,
                kindAnswer.probabilities[kindAnswer.choice] ?? 0,
              )
            : 0;
        const kind =
          kindAnswer?.type === "choice" &&
          isPolicySectionKind(kindAnswer.choice) &&
          jevProceeds(confidence)
            ? kindAnswer.choice
            : "other";
        const startsNewDocument =
          deterministicBoundary(page) ??
          (boundaryAnswer?.type === "noul" && jevProceeds(boundaryAnswer.noul));
        labels[page - 1] = {
          page,
          kind,
          startsNewDocument,
          ...(getDigest(page).formNumber
            ? { formNumber: getDigest(page).formNumber }
            : {}),
          confidence,
          source: "classifier",
        };
      }
    } catch (error) {
      if (isClRouterPayloadTooLarge(error) && batchPages.length > 1) throw error;
      for (const page of batchPages) {
        labels[page - 1] = {
          page,
          kind: "other",
          startsNewDocument: deterministicBoundary(page) ?? false,
          ...(getDigest(page).formNumber
            ? { formNumber: getDigest(page).formNumber }
            : {}),
          confidence: 0,
          source: "fallback",
        };
      }
    } finally {
      await staged?.cleanup().catch((error: unknown) => {
        console.warn(
          "Jev image cleanup unavailable",
          error instanceof Error ? error.message : String(error),
        );
      });
    }
  }
}

type SectionDraft = {
  kind: PolicySectionKind;
  pageStart: number;
  pageEnd: number;
  confidence: number;
  formNumber?: string;
  part?: { index: number; count: number };
};

/** Groups consecutive same-kind, non-boundary pages into draft sections, merging low-confidence pages into a neighbor. */
function groupPagesIntoSections(labels: PolicyPageLabel[]): SectionDraft[] {
  const n = labels.length;
  if (n === 0) return [];

  const eventualKind: PolicySectionKind[] = new Array(n);
  const eventualFormNumber: (string | undefined)[] = new Array(n);
  const boundary: boolean[] = new Array(n).fill(false);
  let current: { kind: PolicySectionKind; formNumber?: string } | null = null;

  for (let i = 0; i < n; i++) {
    const label = labels[i];
    const confident = jevProceeds(label.confidence);

    if (!confident) {
      if (current) {
        eventualKind[i] = current.kind;
        eventualFormNumber[i] = current.formNumber;
        boundary[i] = false;
      } else {
        // Leading low-confidence run: placeholder, resolved once a confident page is found (or at EOF).
        eventualKind[i] = label.kind;
        eventualFormNumber[i] = label.formNumber;
        boundary[i] = i === 0;
      }
      continue;
    }

    if (!current) {
      // First confident page folds any leading low-confidence pages into its own section.
      for (let j = 0; j < i; j++) {
        eventualKind[j] = label.kind;
        eventualFormNumber[j] = label.formNumber;
        boundary[j] = j === 0;
      }
      eventualKind[i] = label.kind;
      eventualFormNumber[i] = label.formNumber;
      boundary[i] = i === 0;
      current = { kind: label.kind, formNumber: label.formNumber };
      continue;
    }

    const formChanged =
      (label.formNumber ?? null) !== (current.formNumber ?? null);
    boundary[i] =
      label.kind !== current.kind || label.startsNewDocument || formChanged;
    eventualKind[i] = label.kind;
    eventualFormNumber[i] = label.formNumber;
    current = { kind: label.kind, formNumber: label.formNumber };
  }

  if (!current) {
    // Every page was low-confidence: fall back to a single section using page 1's kind.
    for (let j = 0; j < n; j++) {
      eventualKind[j] = labels[0].kind;
      eventualFormNumber[j] = labels[0].formNumber;
      boundary[j] = j === 0;
    }
  }

  // Printed form boundaries survive even when page-kind decisions are uncertain.
  for (let i = 0; i < n; i++) {
    const form = labels[i].formNumber;
    const previous = labels[i - 1]?.formNumber;
    if (form) eventualFormNumber[i] = form;
    if (form && previous && form !== previous) boundary[i] = true;
  }

  const sections: SectionDraft[] = [];
  for (let i = 0; i < n; i++) {
    if (boundary[i] || sections.length === 0) {
      sections.push({
        kind: eventualKind[i],
        pageStart: labels[i].page,
        pageEnd: labels[i].page,
        confidence: labels[i].confidence,
        formNumber: eventualFormNumber[i],
      });
    } else {
      const section = sections[sections.length - 1];
      section.pageEnd = labels[i].page;
      section.confidence = Math.min(section.confidence, labels[i].confidence);
    }
  }
  return sections;
}

function maxPagesPerPart(pageCount: number, pdfByteLength: number): number {
  if (pageCount <= 0) return MAX_SECTION_PAGES;
  const bytesPerPage = pdfByteLength / pageCount;
  if (bytesPerPage <= 0) return MAX_SECTION_PAGES;
  const byBytes = Math.floor(MAX_SECTION_BYTES / bytesPerPage);
  return Math.max(1, Math.min(MAX_SECTION_PAGES, byBytes));
}

function splitSectionDraft(draft: SectionDraft, limit: number): SectionDraft[] {
  const totalPages = draft.pageEnd - draft.pageStart + 1;
  if (totalPages <= limit) return [draft];
  const ranges: Array<[number, number]> = [];
  let start = draft.pageStart;
  while (start <= draft.pageEnd) {
    const end = Math.min(start + limit - 1, draft.pageEnd);
    ranges.push([start, end]);
    start = end + 1;
  }
  return ranges.map(([pageStart, pageEnd], index) => ({
    ...draft,
    pageStart,
    pageEnd,
    part: { index, count: ranges.length },
  }));
}

function toPolicySection(draft: SectionDraft): PolicySection {
  return {
    sectionId: `${draft.kind}-${draft.pageStart}-${draft.pageEnd}`,
    kind: draft.kind,
    pageStart: draft.pageStart,
    pageEnd: draft.pageEnd,
    confidence: draft.confidence,
    ...(draft.formNumber ? { formNumber: draft.formNumber } : {}),
    ...(draft.part ? { part: draft.part } : {}),
  };
}

function assertCoverage(pageCount: number, sections: PolicySection[]): void {
  if (pageCount === 0) {
    if (sections.length !== 0) {
      throw new Error(
        "planPolicySections: internal invariant violated — sections present for an empty document",
      );
    }
    return;
  }
  let expected = 1;
  for (const section of sections) {
    if (section.pageStart !== expected || section.pageEnd < section.pageStart) {
      throw new Error(
        `planPolicySections: internal invariant violated — expected section starting at page ${expected}, got ${section.pageStart}-${section.pageEnd}`,
      );
    }
    expected = section.pageEnd + 1;
  }
  if (expected !== pageCount + 1) {
    throw new Error(
      `planPolicySections: internal invariant violated — sections cover pages 1-${expected - 1}, expected 1-${pageCount}`,
    );
  }
}

/** Builds the final, validated section list (with oversize splitting) from a complete set of page labels. */
export function buildPolicySections(
  labels: PolicyPageLabel[],
  pdfByteLength: number,
): PolicySection[] {
  const drafts = groupPagesIntoSections(labels);
  const limit = maxPagesPerPart(labels.length, pdfByteLength);
  const sections = drafts
    .flatMap((draft) => splitSectionDraft(draft, limit))
    .map(toPolicySection);
  assertCoverage(labels.length, sections);
  return sections;
}

function computePlanHash(pageCount: number, sections: PolicySection[]): string {
  const tuples = sections.map((section) => [
    section.kind,
    section.pageStart,
    section.pageEnd,
    section.part?.index ?? null,
    section.part?.count ?? null,
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ pageCount, sections: tuples }))
    .digest("hex");
}

function buildFallbackPlan(
  pageCount: number,
  pdfByteLength: number,
): PolicySectionPlan {
  if (pageCount <= 0) {
    return {
      version: "policy-section-plan-v1",
      pageCount: 0,
      pageLabels: [],
      sections: [],
      planHash: computePlanHash(0, []),
    };
  }
  const limit = maxPagesPerPart(pageCount, pdfByteLength);
  const sections = splitSectionDraft(
    { kind: "other", pageStart: 1, pageEnd: pageCount, confidence: 0 },
    limit,
  ).map(toPolicySection);
  assertCoverage(pageCount, sections);
  const pageLabels: PolicyPageLabel[] = [];
  for (const section of sections) {
    for (let page = section.pageStart; page <= section.pageEnd; page++) {
      pageLabels.push({
        page,
        kind: "other",
        startsNewDocument: page === section.pageStart,
        confidence: 0,
        source: "fallback",
      });
    }
  }
  return {
    version: "policy-section-plan-v1",
    pageCount,
    pageLabels,
    sections,
    planHash: computePlanHash(pageCount, sections),
  };
}

export async function planPolicySections(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  pageCount: number;
  pages: PdfPageText[];
  /** Original PDF size, used with page count to respect MAX_SECTION_BYTES. */
  pdfByteLength: number;
  pdfBytes?: Uint8Array;
  traceId?: string;
  policyId?: string;
}): Promise<PolicySectionPlan> {
  const { ctx, orgId, pageCount, pages, pdfByteLength, traceId } = args;

  if (pageCount <= 0) {
    return buildFallbackPlan(0, pdfByteLength);
  }

  const digests = new Map<number, PolicyPageDigest>();
  for (const page of pages) digests.set(page.page, buildPageDigest(page));
  const getDigest = (page: number): PolicyPageDigest =>
    digests.get(page) ?? { page, headings: [], headLines: [], footLines: [] };

  const hasText = pages.some((page) => nonEmptyLines(page.text).length > 0);
  if (!hasText && !args.pdfBytes) {
    return buildFallbackPlan(pageCount, pdfByteLength);
  }

  const labels: PolicyPageLabel[] = new Array(pageCount);
  const remaining: number[] = [];

  let page = 1;
  while (page <= pageCount) {
    const digest = getDigest(page);
    if (!digest.formNumber) {
      remaining.push(page);
      page += 1;
      continue;
    }
    let runEnd = page;
    while (
      runEnd + 1 <= pageCount &&
      getDigest(runEnd + 1).formNumber === digest.formNumber
    ) {
      runEnd += 1;
    }
    const run: PolicyPageDigest[] = [];
    for (let p = page; p <= runEnd; p++) run.push(getDigest(p));
    const classified = classifyFormRun(run);
    if (classified) {
      for (let p = page; p <= runEnd; p++) {
        labels[p - 1] = {
          page: p,
          kind: classified.kind,
          startsNewDocument: p === page,
          formNumber: digest.formNumber,
          confidence: classified.confidence,
          source: "form_number",
        };
      }
    } else {
      for (let p = page; p <= runEnd; p++) remaining.push(p);
    }
    page = runEnd + 1;
  }

  if (remaining.length > 0) {
    await classifyRemainingPages({
      ctx,
      orgId,
      pageCount,
      remaining,
      pdfBytes: args.pdfBytes,
      getDigest,
      labels,
      traceId,
    });
  }

  const sections = buildPolicySections(labels, pdfByteLength);
  return {
    version: "policy-section-plan-v1",
    pageCount,
    pageLabels: labels,
    sections,
    planHash: computePlanHash(pageCount, sections),
  };
}

/** Copy pages [pageStart, pageEnd] (1-based inclusive) into a new PDF. */
export async function slicePdfPages(
  pdfBytes: Uint8Array,
  pageStart: number,
  pageEnd: number,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(pageStart) ||
    !Number.isInteger(pageEnd) ||
    pageStart < 1 ||
    pageEnd < pageStart
  ) {
    throw new Error(`slicePdfPages: invalid page range ${pageStart}-${pageEnd}`);
  }
  const source = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (pageEnd > pageCount) {
    throw new Error(
      `slicePdfPages: page range ${pageStart}-${pageEnd} exceeds document page count ${pageCount}`,
    );
  }
  const output = await PDFDocument.create();
  const indices = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, i) => pageStart - 1 + i,
  );
  const copiedPages = await output.copyPages(source, indices);
  for (const copiedPage of copiedPages) output.addPage(copiedPage);
  return output.save();
}
