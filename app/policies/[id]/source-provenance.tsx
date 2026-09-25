"use client";

import { useMemo } from "react";
import { FileSearch } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

export type SourceSpanDoc = {
  spanId: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?: Record<string, unknown>;
  text?: string;
  bbox?: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  metadata?: Record<string, unknown>;
};

export type SourceNodeEvidenceDoc = {
  nodeId: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type SourceEvidenceTarget = {
  page: number;
  highlightBoxes: PdfHighlightBox[];
};

export function sourceSpanIdsFrom(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { sourceSpanIds?: unknown }).sourceSpanIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

export function collectSourceSpanIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    for (const id of sourceSpanIdsFrom(item)) ids.add(id);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    for (const child of Object.values(item as Record<string, unknown>))
      visit(child);
  };
  visit(value);
  return [...ids];
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relatedParentId(span: SourceSpanDoc): string | undefined {
  const parent =
    span.parentSpanId ??
    span.table?.rowSpanId ??
    span.table?.tableSpanId;
  return typeof parent === "string" && parent.length > 0 ? parent : undefined;
}

function sourceUnit(span: SourceSpanDoc): string | undefined {
  return span.sourceUnit;
}

export function usePolicySourceSpans(
  policyId: Id<"policies"> | undefined,
  sourceSpanIds: string[],
  options?: { allowOperatorAccess?: boolean; maxIds?: number },
) {
  const maxIds = options?.maxIds ?? 256;
  const uniqueIds = useMemo(
    () => [...new Set(sourceSpanIds)].sort().slice(0, maxIds),
    [sourceSpanIds, maxIds],
  );
  return useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.policy-detail",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    policyId && uniqueIds.length > 0
      ? {
          policyId,
          spanIds: uniqueIds,
          ...(options?.allowOperatorAccess ? { allowOperatorAccess: true } : {}),
        }
      : "skip",
  ) as SourceSpanDoc[] | undefined;
}

export function usePolicySourceNodes(
  policyId: Id<"policies"> | undefined,
  sourceNodeIds: string[],
) {
  const uniqueIds = useMemo(
    () => [...new Set(sourceNodeIds)].sort().slice(0, 128),
    [sourceNodeIds],
  );
  return useCachedQuery(
    "sourceNodes.listByPolicyAndNodeIds.policy-detail",
    api.sourceNodes.listByPolicyAndNodeIds,
    policyId && uniqueIds.length > 0
      ? { policyId, nodeIds: uniqueIds }
      : "skip",
  ) as SourceNodeEvidenceDoc[] | undefined;
}

export function evidenceSpansForIds(
  spans: SourceSpanDoc[] | undefined,
  sourceSpanIds: string[],
) {
  if (!spans?.length || sourceSpanIds.length === 0) return [];
  const requested = new Set(sourceSpanIds);
  const direct = spans.filter((span) => requested.has(span.spanId));
  const parentIds = new Set(
    direct.map(relatedParentId).filter((id): id is string => Boolean(id)),
  );
  const parentRows = spans.filter((span) => parentIds.has(span.spanId));
  if (parentRows.length > 0) return parentRows;

  const exactNonPage = direct.filter((span) => sourceUnit(span) !== "page");
  return exactNonPage.length > 0 ? exactNonPage : direct;
}

export function highlightBoxesForSpans(
  spans: SourceSpanDoc[],
): PdfHighlightBox[] {
  return spans.flatMap((span) =>
    (span.bbox ?? []).map((box) => ({
      ...box,
      coordinateWidth: readNumber(
        span.metadata?.bboxCoordinateWidth,
      ),
      coordinateHeight: readNumber(
        span.metadata?.bboxCoordinateHeight,
      ),
    })),
  );
}

export function firstEvidencePage(
  spans: SourceSpanDoc[],
  fallbackPage?: number,
) {
  return (
    spans.find((span) => typeof span.pageStart === "number")?.pageStart ??
    spans
      .flatMap((span) => span.bbox ?? [])
      .find((box) => typeof box.page === "number")?.page ??
    fallbackPage
  );
}

export function sourceEvidenceTarget(
  sourceSpanIds: string[],
  sourceSpans: SourceSpanDoc[] | undefined,
  fallbackPage?: number,
): SourceEvidenceTarget | null {
  const evidenceSpans = evidenceSpansForIds(sourceSpans, sourceSpanIds);
  const page = firstEvidencePage(evidenceSpans, fallbackPage);
  if (page == null) return null;
  return {
    page,
    highlightBoxes: highlightBoxesForSpans(evidenceSpans),
  };
}

export function SourceEvidenceButton({
  sourceSpanIds,
  sourceSpans,
  fallbackPage,
  fileUrl,
  className = "",
}: {
  sourceSpanIds?: string[];
  sourceSpans?: SourceSpanDoc[];
  fallbackPage?: number;
  fileUrl?: string;
  className?: string;
}) {
  const pdf = usePdf();
  const activeFileUrl = fileUrl ?? pdf.fileUrl;
  const target = sourceEvidenceTarget(
    sourceSpanIds ?? [],
    sourceSpans,
    fallbackPage,
  );
  const page = target?.page;

  if (!activeFileUrl || page == null) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        pdf.openWithUrl(activeFileUrl, page, target?.highlightBoxes ?? []);
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-border-emphasized bg-background px-2 py-0.5 text-muted-foreground transition-colors hover:border-border-focus hover:bg-foreground/4 ${typeStyle("label.tag")} ${className}`}
      aria-label={`Open source on page ${page}`}
    >
      <FileSearch className="size-3" />
      p. {page}
    </button>
  );
}
