"use client";

import { useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ExtractionRunSectionView,
  ExtractionRunView,
} from "@/convex/lib/extractionRunView";
import { usePdf } from "@/components/pdf-context";
import { PillButton } from "@/components/ui/pill-button";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
  OperationalSkeletonList,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplayDateTime } from "@/lib/date-format";
import { useCachedOperatorExtractionRuns } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { SourceEvidenceButton } from "./source-provenance";

const RUN_STATUS: Record<
  ExtractionRunView["status"],
  StatusPresentation & { label: string }
> = {
  running: { label: "Running", tone: "info", indicator: "progress" },
  succeeded: { label: "Succeeded", tone: "success", indicator: "complete" },
  failed: { label: "Failed", tone: "danger", indicator: "error" },
  cancelled: { label: "Cancelled", tone: "neutral", indicator: "cancelled" },
  rejected: { label: "Not a policy", tone: "warning", indicator: "warning" },
};

const SECTION_STATUS: Record<
  ExtractionRunSectionView["status"],
  StatusPresentation & { label: string }
> = {
  pending: { label: "Pending", tone: "neutral", indicator: "pending" },
  running: { label: "Running", tone: "info", indicator: "progress" },
  succeeded: { label: "Succeeded", tone: "success", indicator: "complete" },
  failed: { label: "Failed", tone: "danger", indicator: "error" },
};

function humanize(value: string) {
  const text = value.replaceAll("_", " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function formatCost(value?: number) {
  if (value === undefined) return "—";
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatPages(section: ExtractionRunSectionView) {
  return section.pageStart === section.pageEnd
    ? `p. ${section.pageStart}`
    : `pp. ${section.pageStart}–${section.pageEnd}`;
}

/** The model-call log for one run, using the log page's search and range filters. */
function modelCallsHref(run: ExtractionRunView) {
  if (!run.traceId) return undefined;
  const from = run.startedAt - 60_000;
  const to = (run.finishedAt ?? run.startedAt + 86_400_000) + 60_000;
  const params = new URLSearchParams({
    search: run.traceId,
    from: String(from),
    to: String(Math.min(to, from + 30 * 86_400_000)),
  });
  return `/operator/logs?${params}`;
}

function StatusCell({ status }: { status: StatusPresentation & { label: string } }) {
  const { label, ...presentation } = status;
  return <StatusTag {...presentation}>{label}</StatusTag>;
}

function selectableRowProps(selected: boolean, onSelect: () => void) {
  return {
    tabIndex: 0,
    role: "button",
    "data-state": selected ? "selected" : undefined,
    className:
      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
    onClick: onSelect,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    },
  };
}

function RunsTable({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: ExtractionRunView[];
  selectedRunId?: string;
  onSelect: (runId: string) => void;
}) {
  return (
    <OperationalPanel>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">Started</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="px-4 text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.runId}
              aria-label={`Show run started ${formatDisplayDateTime(run.startedAt)}`}
              {...selectableRowProps(run.runId === selectedRunId, () =>
                onSelect(run.runId),
              )}
            >
              <TableCell className="px-4">
                {formatDisplayDateTime(run.startedAt)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {humanize(run.trigger)}
              </TableCell>
              <TableCell>
                <StatusCell status={RUN_STATUS[run.status]} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDuration(run.durationMs)}
              </TableCell>
              <TableCell className="px-4 text-right text-muted-foreground">
                {formatCost(run.costUsd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function SectionFacts({
  runId,
  section,
  fileUrl,
}: {
  runId: string;
  section: ExtractionRunSectionView;
  fileUrl?: string | null;
}) {
  const detail = useQuery(api.operator.getExtractionRunSection, {
    runId,
    sectionId: section.sectionId,
  });
  const title = `${humanize(section.kind)} · ${formatPages(section)}`;

  if (detail === undefined) {
    return <OperationalSkeletonList rows={3} showTrailing={false} />;
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader title={title} />
      {!detail || detail.facts.length === 0 ? (
        <OperationalPanelBody
          className={`text-muted-foreground ${typeStyle("body.default")}`}
        >
          No facts were extracted from this section.
        </OperationalPanelBody>
      ) : (
        detail.facts.map((fact, index) => (
          <OperationalItem
            key={`${fact.label}-${index}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
          >
            <span
              className={`min-w-40 text-muted-foreground ${typeStyle("label.metadata")}`}
            >
              {fact.label}
            </span>
            <span
              className={`min-w-0 flex-1 break-words text-foreground ${typeStyle("body.default")}`}
            >
              {fact.value}
            </span>
            {fact.citations.map((citation, citationIndex) => {
              const spanId =
                citation.sourceSpanIds[0] ?? `page-${citation.page}`;
              return (
                <SourceEvidenceButton
                  key={`${spanId}-${citationIndex}`}
                  sourceSpanIds={[spanId]}
                  sourceSpans={[
                    { spanId, pageStart: citation.page, bbox: citation.bbox },
                  ]}
                  fallbackPage={citation.page}
                  fileUrl={fileUrl ?? undefined}
                />
              );
            })}
          </OperationalItem>
        ))
      )}
    </OperationalPanel>
  );
}

function RunDetail({
  run,
  fileUrl,
}: {
  run: ExtractionRunView;
  fileUrl?: string | null;
}) {
  const pdf = usePdf();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null,
  );
  const selectedSection = run.sections?.find(
    (section) => section.sectionId === selectedSectionId,
  );
  const logsHref = modelCallsHref(run);

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Sections"
          action={
            logsHref ? (
              <PillButton size="compact" variant="secondary" href={logsHref}>
                View model calls
              </PillButton>
            ) : undefined
          }
        />
        {run.sections === null ? (
          <OperationalPanelBody
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            Section details aren&apos;t available for this run.
          </OperationalPanelBody>
        ) : run.sections.length === 0 ? (
          <OperationalPanelBody
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            No sections planned yet.
          </OperationalPanelBody>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Kind</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="px-4 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.sections.map((section) => (
                <TableRow
                  key={section.sectionId}
                  aria-label={`Show ${humanize(section.kind)} ${formatPages(section)}`}
                  {...selectableRowProps(
                    section.sectionId === selectedSectionId,
                    () => {
                      setSelectedSectionId(section.sectionId);
                      if (fileUrl) pdf.openWithUrl(fileUrl, section.pageStart);
                    },
                  )}
                >
                  <TableCell className="px-4">
                    {humanize(section.kind)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatPages(section)}
                  </TableCell>
                  <TableCell>
                    <StatusCell status={SECTION_STATUS[section.status]} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(section.durationMs)}
                  </TableCell>
                  <TableCell className="px-4 text-right text-muted-foreground">
                    {formatCost(section.costUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </OperationalPanel>
      {selectedSection ? (
        <SectionFacts
          runId={run.runId}
          section={selectedSection}
          fileUrl={fileUrl}
        />
      ) : null}
    </div>
  );
}

export function PolicySectionsTab({
  policyId,
  fileUrl,
}: {
  policyId: Id<"policies">;
  fileUrl?: string | null;
}) {
  const runs = useCachedOperatorExtractionRuns(policyId);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const runParam = searchParams.get("run");
  const traceParam = searchParams.get("traceId");
  const selectedRun =
    runs?.find((run) => run.runId === runParam) ??
    runs?.find((run) => !!traceParam && run.traceId === traceParam) ??
    runs?.[0];

  if (runs === undefined) {
    return <OperationalSkeletonList rows={3} showTrailing={false} />;
  }
  if (runs.length === 0) {
    return (
      <OperationalPanel>
        <OperationalPanelBody
          className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}
        >
          No extraction runs yet.
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  return (
    <div className="space-y-4">
      <RunsTable
        runs={runs}
        selectedRunId={selectedRun?.runId}
        onSelect={(runId) => {
          const query = new URLSearchParams(searchParams);
          query.set("tab", "sections");
          query.set("run", runId);
          query.delete("traceId");
          router.replace(`${pathname}?${query}`, { scroll: false });
        }}
      />
      {selectedRun ? (
        <RunDetail key={selectedRun.runId} run={selectedRun} fileUrl={fileUrl} />
      ) : null}
    </div>
  );
}
