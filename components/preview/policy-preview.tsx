"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  buildCoverageBreakdown,
  type CoverageBreakdown,
} from "@/convex/lib/coverageBreakdown";
import { policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { PolicyListItem } from "@/components/policy-list-item";
import { PillButton } from "@/components/ui/pill-button";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { usePdf } from "@/components/pdf-context";
import { useCachedPolicyDetail } from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  evidenceSpansForIds,
  highlightBoxesForSpans,
  sourceEvidenceTarget,
  type SourceNodeEvidenceDoc,
  type SourceSpanDoc,
  usePolicySourceNodes,
} from "@/app/policies/[id]/source-provenance";
import {
  coverageFallbackPage,
  coverageSourceNodeIds,
  coverageSourceSpanIds,
} from "@/app/policies/[id]/policy-coverage-breakdown";
import { formatDisplayDate } from "@/lib/date-format";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import { typeStyle } from "@/lib/typography";

type CoverageBreakdownRow = CoverageBreakdown["all"][number];

interface PolicyPreviewProps {
  id: string;
  page?: number;
  citedSections?: string[];
  citedCoverageNames?: string[];
  citedSourceSpanIds?: string[];
  onFooterActions?: (actions: {
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      coordinateWidth?: number;
      coordinateHeight?: number;
    }>;
  }) => void;
}

type MetadataRow = {
  label: string;
  value: string;
};

function realText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "-" || text === "\u2014") return undefined;
  return text;
}

function taxesAndFeesTotal(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const total = value.reduce((sum, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return sum;
    const row = entry as Record<string, unknown>;
    if (typeof row.amountValue === "number") return sum + row.amountValue;
    const amount = Number(realText(row.amount)?.replace(/[^\d.-]/g, ""));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  return total > 0
    ? `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : undefined;
}

function moneyValue(value: string | undefined) {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function supportingDetailRows(
  record: Record<string, unknown>,
  insuredName: string | undefined,
): MetadataRow[] {
  const premium = realText(record.premium);
  const taxesAndFees = taxesAndFeesTotal(record.taxesAndFees);
  const totalPayable = realText(record.totalCost);
  const premiumAmount = moneyValue(premium);
  const totalPayableAmount = moneyValue(totalPayable);
  const repeatsPremium =
    premiumAmount !== undefined &&
    totalPayableAmount !== undefined &&
    premiumAmount === totalPayableAmount &&
    !taxesAndFees;

  return [
    { label: "Named insured", value: insuredName },
    { label: "Premium", value: premium },
    { label: "Taxes & fees", value: taxesAndFees },
    {
      label: "Total payable",
      value: repeatsPremium ? undefined : totalPayable,
    },
  ].filter((row): row is MetadataRow => Boolean(row.value));
}

function normalizedCoverageText(value: string | undefined) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9$.,/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageTermRows(row: CoverageBreakdownRow) {
  const terms = [...(row.limits ?? [])];
  const seen = new Set(
    terms.map(
      (term) =>
        `${normalizedCoverageText(term.label)}|${normalizedCoverageText(term.value)}`,
    ),
  );
  const hasLabel = (pattern: RegExp) =>
    terms.some((term) =>
      pattern.test(normalizedCoverageText(term.label) ?? ""),
    );
  const push = (label: string, value: string | undefined) => {
    if (!value) return;
    const key = `${normalizedCoverageText(label)}|${normalizedCoverageText(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ label, value });
  };

  if (!row.limits?.length) push("Limit", row.limit);
  if (!hasLabel(/\bdeductible\b|\bretention\b/)) {
    push("Deductible", row.deductible);
  }
  if (!hasLabel(/\bretroactive\b/)) {
    push(
      "Retroactive Date",
      row.retroactiveDate
        ? formatDisplayDate(row.retroactiveDate, row.retroactiveDate)
        : undefined,
    );
  }
  return terms;
}

export function PolicyPreview({
  id,
  page,
  citedSourceSpanIds,
  onFooterActions,
}: PolicyPreviewProps) {
  const policy = useCachedPolicyDetail(id as Id<"policies">);
  const coverageBreakdown = useMemo(
    () => buildCoverageBreakdown(policy),
    [policy],
  );
  const previewSourceSpanIds = useMemo(
    () => [...new Set(citedSourceSpanIds ?? [])].slice(0, 64),
    [citedSourceSpanIds],
  );
  const fileUrl = useCachedQuery(
    "policies.getPolicyFileUrl.preview",
    api.policies.getPolicyFileUrl,
    policy ? { policyId: policy._id } : "skip",
  );
  const coverageSourceNodeIdList = useMemo(
    () => [...new Set(coverageBreakdown.all.flatMap(coverageSourceNodeIds))],
    [coverageBreakdown.all],
  );
  const coverageSourceNodes = usePolicySourceNodes(
    id as Id<"policies">,
    coverageSourceNodeIdList,
  );
  const requestedSourceSpanIds = useMemo(
    () =>
      [
        ...new Set([
          ...previewSourceSpanIds,
          ...coverageBreakdown.all.flatMap((row) =>
            coverageSourceSpanIds(row, coverageSourceNodes),
          ),
        ]),
      ].slice(0, 256),
    [coverageBreakdown.all, coverageSourceNodes, previewSourceSpanIds],
  );
  const sourceSpans = useCachedQuery(
    "sourceSpans.listSpansByPolicyAndSpanIds.preview",
    api.sourceSpans.listSpansByPolicyAndSpanIds,
    requestedSourceSpanIds.length
      ? {
          policyId: id as Id<"policies">,
          spanIds: requestedSourceSpanIds,
        }
      : "skip",
  ) as SourceSpanDoc[] | undefined;
  const citedSourceSpans = useMemo(
    () =>
      citedSourceSpanIds?.length
        ? evidenceSpansForIds(sourceSpans, citedSourceSpanIds)
        : [],
    [citedSourceSpanIds, sourceSpans],
  );

  const record = policy as Record<string, unknown> | undefined;

  const highlightBoxes = useMemo(
    () => highlightBoxesForSpans(citedSourceSpans),
    [citedSourceSpans],
  );
  const citedPage = page ?? highlightBoxes[0]?.page;

  useEffect(() => {
    if (policy && onFooterActions) {
      onFooterActions({
        fileUrl: fileUrl ?? undefined,
        policyId: id,
        page: citedPage,
        highlightBoxes,
      });
    }
  }, [fileUrl, id, citedPage, onFooterActions, highlightBoxes, policy]);

  if (!policy || !record) {
    return <div className="min-h-24" />;
  }

  const types = policyLobCodes(policy).filter((code) => code !== "UN");
  const partyContext = resolvePolicyPartyContext(record);
  const carrier = partyContext.carrierDisplayName ?? "Unknown carrier";
  const supportingRows = supportingDetailRows(record, partyContext.insuredName);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <PolicyListItem
        carrier={carrier}
        carrierIdentity={policy.carrierIdentity}
        policyDetailOverrides={policy.policyDetailOverrides}
        generalAgent={partyContext.generalAgentName}
        policyNumber={realText(record.policyNumber) ?? ""}
        productIdentity={policy.productIdentity}
        programName={realText(record.programName)}
        linesOfBusiness={types}
        effectiveDate={realText(record.effectiveDate)}
        expirationDate={realText(record.expirationDate)}
        policyTermType={realText(record.policyTermType)}
        pipelineStatus={realText(record.pipelineStatus)}
        pipelineError={realText(record.pipelineError)}
        extractionDataStage={realText(record.extractionDataStage)}
      />

      <PolicySupportingDetails rows={supportingRows} />

      {citedSourceSpans.length > 0 && (
        <ExactSourceLocations sourceSpans={citedSourceSpans} />
      )}

      <CoverageListPreview
        breakdown={coverageBreakdown}
        fileUrl={fileUrl}
        sourceNodes={coverageSourceNodes}
        sourceSpans={sourceSpans}
      />
    </div>
  );
}

function PolicySupportingDetails({ rows }: { rows: MetadataRow[] }) {
  if (!rows.length) return null;

  return (
    <section className="min-w-0">
      <p className={`mb-2 text-muted-foreground/60 ${typeStyle("body.medium")}`}>
        Policy details
      </p>
      <OperationalLabelValueList>
        {rows.map((row) => (
          <OperationalLabelValueRow
            key={`${row.label}:${row.value}`}
            label={row.label}
            value={row.value}
            align="right"
          />
        ))}
      </OperationalLabelValueList>
    </section>
  );
}

function ExactSourceLocations({
  sourceSpans,
}: {
  sourceSpans: SourceSpanDoc[];
}) {
  return (
    <section className="min-w-0 rounded-md border border-input bg-foreground/[0.02]">
      <div className="border-b border-border px-3 py-2">
        <p className={`text-foreground ${typeStyle("caption.medium")}`}>
          Exact source locations
        </p>
      </div>
      <div className="divide-y divide-border">
        {sourceSpans.slice(0, 5).map((span) => (
          <div key={span.spanId} className="px-3 py-2">
            <div className="mb-1 flex min-w-0 items-center gap-2">
              <span className={`text-muted-foreground ${typeStyle("caption.medium")}`}>
                p.{span.pageStart ?? span.bbox?.[0]?.page ?? "?"}
              </span>
              <span className={`truncate text-muted-foreground/50 ${typeStyle("caption.default")}`}>
                {span.sectionId ??
                  span.formNumber ??
                  (span.metadata?.elementType as string | undefined) ??
                  "Source span"}
              </span>
            </div>
            <p className={`line-clamp-3 text-foreground/80 ${typeStyle("body.default")}`}>
              {span.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

type CoveragePreviewGroup = {
  key: string;
  title: string;
  rows: CoverageBreakdownRow[];
};

function coveragePreviewGroups(
  breakdown: CoverageBreakdown,
): CoveragePreviewGroup[] {
  return [
    ...breakdown.groups.map((group) => ({
      key: group.lineOfBusiness,
      title: group.label,
      rows: group.items,
    })),
    ...(breakdown.unassigned.length
      ? [
          {
            key: "unassigned",
            title: breakdown.groups.length
              ? "Unassigned"
              : "Coverage schedules",
            rows: breakdown.unassigned,
          },
        ]
      : []),
  ];
}

function visibleCoveragePreviewGroups(
  groups: CoveragePreviewGroup[],
  maxRows: number,
): CoveragePreviewGroup[] {
  let remaining = maxRows;
  const visible: CoveragePreviewGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const rows = group.rows.slice(0, remaining);
    if (rows.length > 0) visible.push({ ...group, rows });
    remaining -= rows.length;
  }
  return visible;
}

function CoverageListPreview({
  breakdown,
  fileUrl,
  sourceNodes,
  sourceSpans,
}: {
  breakdown: CoverageBreakdown;
  fileUrl?: string | null;
  sourceNodes?: SourceNodeEvidenceDoc[];
  sourceSpans?: SourceSpanDoc[];
}) {
  const [showAllCoverages, setShowAllCoverages] = useState(false);
  const groups = coveragePreviewGroups(breakdown);
  const totalRows = breakdown.all.length;
  const visibleGroups = showAllCoverages
    ? groups
    : visibleCoveragePreviewGroups(groups, 8);
  const visibleCount = visibleGroups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );
  const hiddenCount = Math.max(0, totalRows - visibleCount);

  return (
    <section className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <p className={`min-w-0 text-muted-foreground/60 ${typeStyle("body.medium")}`}>
          Coverage schedules
        </p>
        {totalRows > 0 && (
          <span className={`shrink-0 text-muted-foreground/45 ${typeStyle("caption.default")}`}>
            {totalRows}
          </span>
        )}
      </div>
      {totalRows > 0 ? (
        <>
          <div className="space-y-2">
            {visibleGroups.map((group) => {
              const useCoverageNameAsHeader =
                groups.length === 1 && group.rows.length === 1;
              return (
                <CoveragePreviewGroupList
                  key={group.key}
                  group={group}
                  headerTitle={
                    groups.length > 1
                      ? group.title
                      : useCoverageNameAsHeader
                        ? group.rows[0]?.name
                        : undefined
                  }
                  showRowTitles={!useCoverageNameAsHeader}
                  fileUrl={fileUrl}
                  sourceNodes={sourceNodes}
                  sourceSpans={sourceSpans}
                />
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <div className="mt-2 flex justify-end">
              <PillButton
                size="compact"
                variant="secondary"
                onClick={() => setShowAllCoverages(true)}
              >
                Show {hiddenCount} more
              </PillButton>
            </div>
          )}
        </>
      ) : (
        <div className={`rounded-md border border-input bg-card px-3 py-3 text-muted-foreground ${typeStyle("body.default")}`}>
          No coverage schedule extracted yet.
        </div>
      )}
    </section>
  );
}

function CoveragePreviewGroupList({
  group,
  headerTitle,
  showRowTitles,
  fileUrl,
  sourceNodes,
  sourceSpans,
}: {
  group: CoveragePreviewGroup;
  headerTitle?: string;
  showRowTitles: boolean;
  fileUrl?: string | null;
  sourceNodes?: SourceNodeEvidenceDoc[];
  sourceSpans?: SourceSpanDoc[];
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-input bg-card text-card-foreground">
      {headerTitle ? (
        <div className={`border-b border-border px-3 py-2.5 text-foreground [overflow-wrap:anywhere] ${typeStyle("body.medium")}`}>
          {headerTitle}
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {group.rows.map((row, index) => (
          <CoverageScheduleRow
            key={`${row.name}:${row.limit ?? ""}:${index}`}
            row={row}
            fileUrl={fileUrl}
            sourceNodes={sourceNodes}
            sourceSpans={sourceSpans}
            showName={showRowTitles}
          />
        ))}
      </div>
    </div>
  );
}

function CoverageScheduleRow({
  row,
  fileUrl,
  sourceNodes,
  sourceSpans,
  showName,
}: {
  row: CoverageBreakdownRow;
  fileUrl?: string | null;
  sourceNodes?: SourceNodeEvidenceDoc[];
  sourceSpans?: SourceSpanDoc[];
  showName: boolean;
}) {
  const pdf = usePdf();
  const terms = coverageTermRows(row);
  const visibleTerms = terms.length
    ? terms
    : [{ label: "Limit", value: row.limit ?? "\u2014" }];

  const target = sourceEvidenceTarget(
    coverageSourceSpanIds(row, sourceNodes),
    sourceSpans,
    coverageFallbackPage(row, sourceNodes),
  );
  const canOpenSource = Boolean(fileUrl && target);

  function openSource() {
    if (!fileUrl || !target) return;
    pdf.openWithUrl(fileUrl, target.page, target.highlightBoxes);
  }

  return (
    <section
      role={canOpenSource ? "button" : undefined}
      tabIndex={canOpenSource ? 0 : undefined}
      title={canOpenSource ? `Open source on page ${target!.page}` : undefined}
      aria-label={
        canOpenSource
          ? `Open source for ${row.name} on page ${target!.page}`
          : undefined
      }
      onClick={canOpenSource ? openSource : undefined}
      onKeyDown={
        canOpenSource
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openSource();
            }
          : undefined
      }
      className={`min-w-0 px-3 py-3 ${
        canOpenSource
          ? "cursor-pointer transition-colors hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
          : ""
      }`}
    >
      {showName ? (
        <div className={`text-foreground [overflow-wrap:anywhere] ${typeStyle("body.medium")}`}>
          {row.name}
        </div>
      ) : null}
      <dl
        className={
          showName
            ? "mt-2 divide-y divide-border"
            : "divide-y divide-border"
        }
      >
        {visibleTerms.map((term, termIndex) => (
          <div
            key={`${term.label}:${termIndex}`}
            className="grid grid-cols-[minmax(0,1fr)_minmax(6rem,auto)] gap-3 py-1.5 first:pt-0 last:pb-0"
          >
            <dt className={`min-w-0 text-muted-foreground [overflow-wrap:anywhere] ${typeStyle("body.default")}`}>
              {term.label}
            </dt>
            <dd className={`min-w-0 text-right text-foreground [overflow-wrap:anywhere] ${typeStyle("data.numeric")}`}>
              {term.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
