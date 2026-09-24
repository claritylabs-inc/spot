"use client";

import { useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { formatDisplayDate } from "@/lib/date-format";
import {
  sourceEvidenceTarget,
  type SourceNodeEvidenceDoc,
  type SourceSpanDoc,
  usePolicySourceNodes,
  usePolicySourceSpans,
} from "./source-provenance";
import { typeStyle } from "@/lib/typography";

type CoverageBreakdownRow = CoverageBreakdown["all"][number];

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
    terms.some((term) => pattern.test(normalizedCoverageText(term.label) ?? ""));
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

function CoveredAssetScheduleList({
  schedule,
  fileUrl,
  sourceSpans,
}: {
  schedule: CoverageBreakdown["schedules"][number];
  fileUrl?: string | null;
  sourceSpans?: SourceSpanDoc[];
}) {
  const pdf = usePdf();
  return (
    <OperationalPanel>
      <OperationalPanelHeader title={schedule.name} />
      {schedule.description ? (
        <div className={`border-t border-border px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}>
          {schedule.description}
        </div>
      ) : null}
      <div>
        {schedule.items.map((item, index) => {
          const target = sourceEvidenceTarget(
            item.sourceSpanIds.length ? item.sourceSpanIds : schedule.sourceSpanIds,
            sourceSpans,
            schedule.pageStart,
          );
          const canOpenSource = Boolean(fileUrl && target);
          const openSource = () => {
            if (!fileUrl || !target) return;
            pdf.openWithUrl(fileUrl, target.page, target.highlightBoxes);
          };
          return (
            <section
              key={`${item.label}:${index}`}
              role={canOpenSource ? "button" : undefined}
              tabIndex={canOpenSource ? 0 : undefined}
              onClick={canOpenSource ? openSource : undefined}
              onKeyDown={canOpenSource ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openSource();
              } : undefined}
              className={`border-t border-border px-4 py-3 first:border-t-0 ${
                canOpenSource ? "cursor-pointer transition-colors hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40" : ""
              }`}
            >
              <div className={`text-foreground ${typeStyle("body.medium")}`}>{item.label}</div>
              {item.description ? (
                <div className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>{item.description}</div>
              ) : null}
              {item.values.length ? (
                <dl className="mt-3 divide-y divide-border">
                  {item.values.map((value, valueIndex) => (
                    <div key={`${value.label}:${valueIndex}`} className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)] gap-4 py-2 first:pt-0 last:pb-0">
                      <dt className={`text-muted-foreground ${typeStyle("body.default")}`}>{value.label}</dt>
                      <dd className={`text-right text-foreground ${typeStyle("body.medium")}`}>{value.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          );
        })}
      </div>
    </OperationalPanel>
  );
}

export function coverageSourceNodeIds(row: CoverageBreakdownRow) {
  return [...new Set([
    ...(row.sourceNodeIds ?? []),
    ...(row.documentNodeId ? [row.documentNodeId] : []),
    ...(row.limits ?? []).flatMap((term) => term.sourceNodeIds ?? []),
  ])];
}

export function coverageSourceSpanIds(
  row: CoverageBreakdownRow,
  sourceNodes?: SourceNodeEvidenceDoc[],
) {
  const requestedNodeIds = new Set(coverageSourceNodeIds(row));
  return [...new Set([
    ...(row.sourceSpanIds ?? []),
    ...(row.limits ?? []).flatMap((term) => term.sourceSpanIds ?? []),
    ...(sourceNodes ?? [])
      .filter((node) => requestedNodeIds.has(node.nodeId))
      .flatMap((node) => node.sourceSpanIds),
  ])];
}

export function coverageFallbackPage(
  row: CoverageBreakdownRow,
  sourceNodes?: SourceNodeEvidenceDoc[],
) {
  const requestedNodeIds = new Set(coverageSourceNodeIds(row));
  return (
    sourceNodes?.find(
      (node) => requestedNodeIds.has(node.nodeId) && node.pageStart != null,
    )?.pageStart ??
    row.pageNumber ??
    row.resolvedFromPage
  );
}

function CoverageScheduleList({
  rows,
  title,
  fileUrl,
  sourceNodes,
  sourceSpans,
}: {
  rows: CoverageBreakdownRow[];
  title: string;
  fileUrl?: string | null;
  sourceNodes?: SourceNodeEvidenceDoc[];
  sourceSpans?: SourceSpanDoc[];
}) {
  const pdf = usePdf();
  if (!rows.length) return null;

  return (
    <OperationalPanel>
      <OperationalPanelHeader title={title} />
      <div>
        {rows.map((row, rowIndex) => {
          const terms = coverageTermRows(row);
          const visibleTerms = terms.length
            ? terms
            : [{ label: "Limit", value: row.limit ?? "—" }];
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
              key={`${row.name}:${row.limit ?? ""}:${rowIndex}`}
              role={canOpenSource ? "button" : undefined}
              tabIndex={canOpenSource ? 0 : undefined}
              title={canOpenSource ? `Open source on page ${target?.page}` : undefined}
              aria-label={
                canOpenSource
                  ? `Open source for ${row.name} on page ${target?.page}`
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
              className={`border-t border-border px-4 py-3 first:border-t-0 ${
                canOpenSource
                  ? "cursor-pointer transition-colors hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                  : ""
              }`}
            >
              <div className="min-w-0">
                <div className={`text-foreground [overflow-wrap:anywhere] ${typeStyle("body.medium")}`}>
                  {row.name}
                </div>
              </div>
              <dl className="mt-3 divide-y divide-border">
                {visibleTerms.map((term, termIndex) => (
                  <div
                    key={`${term.label}:${termIndex}`}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,auto)] gap-4 py-2 first:pt-0 last:pb-0"
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
        })}
      </div>
    </OperationalPanel>
  );
}

export function CoverageBreakdownCards({
  breakdown,
  policyId,
  fileUrl,
  showCoveredAssetSchedules = true,
}: {
  breakdown: CoverageBreakdown;
  policyId?: Id<"policies">;
  fileUrl?: string | null;
  showCoveredAssetSchedules?: boolean;
}) {
  const allSourceNodeIds = useMemo(
    () => [...new Set(breakdown.all.flatMap(coverageSourceNodeIds))],
    [breakdown.all],
  );
  const sourceNodes = usePolicySourceNodes(policyId, allSourceNodeIds);
  const allSourceSpanIds = useMemo(
    () => [...new Set(
      [
        ...breakdown.all.flatMap((row) => coverageSourceSpanIds(row, sourceNodes)),
        ...breakdown.schedules.flatMap((schedule) => [
          ...schedule.sourceSpanIds,
          ...schedule.items.flatMap((item) => item.sourceSpanIds),
        ]),
      ],
    )],
    [breakdown.all, breakdown.schedules, sourceNodes],
  );
  const sourceSpans = usePolicySourceSpans(policyId, allSourceSpanIds);

  if (!breakdown.all.length && !breakdown.schedules.length) return null;
  const groups = [
    ...breakdown.groups.map((group) => ({
      key: group.lineOfBusiness,
      title: group.label,
      rows: group.items,
    })),
    ...(breakdown.unassigned.length
      ? [{
          key: "unassigned",
          title: breakdown.groups.length ? "Unassigned coverage schedules" : "Coverage schedules",
          rows: breakdown.unassigned,
        }]
      : []),
  ];
  return (
    <div className="mb-6 space-y-3">
      {groups.map((group) => (
        <CoverageScheduleList
          key={group.key}
          rows={group.rows}
          title={group.title}
          fileUrl={fileUrl}
          sourceNodes={sourceNodes}
          sourceSpans={sourceSpans}
        />
      ))}
      {showCoveredAssetSchedules
        ? breakdown.schedules.map((schedule, index) => (
            <CoveredAssetScheduleList
              key={`${schedule.name}:${schedule.pageStart ?? index}`}
              schedule={schedule}
              fileUrl={fileUrl}
              sourceSpans={sourceSpans}
            />
          ))
        : null}
    </div>
  );
}
