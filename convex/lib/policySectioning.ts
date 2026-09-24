"use node";

// Owner: P2 (docs/architecture/convex-section-extraction.md).
// Plans policy sections from page text (form numbers first, then Jev per-page
// classification) and slices the original PDF per section.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PdfPageText } from "./pdfText";

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

export async function planPolicySections(_args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  pageCount: number;
  pages: PdfPageText[];
  /** Original PDF size, used with page count to respect MAX_SECTION_BYTES. */
  pdfByteLength: number;
  traceId?: string;
  policyId?: string;
}): Promise<PolicySectionPlan> {
  throw new Error("planPolicySections: not implemented (P2)");
}

/** Copy pages [pageStart, pageEnd] (1-based inclusive) into a new PDF. */
export async function slicePdfPages(
  _pdfBytes: Uint8Array,
  _pageStart: number,
  _pageEnd: number,
): Promise<Uint8Array> {
  throw new Error("slicePdfPages: not implemented (P2)");
}
