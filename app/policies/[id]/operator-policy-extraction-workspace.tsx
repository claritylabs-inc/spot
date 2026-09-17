"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  collectSourceSpanIds,
  SourceEvidenceButton,
  type SourceSpanDoc,
  usePolicySourceSpans,
} from "./source-provenance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OperationalItem,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  useCachedOperatorExtractionTraceDetail,
  useCachedOperatorExtractionTraces,
} from "@/lib/sync/operator-cached-queries";
import {
  formatDisplayDateTime,
  formatDisplayDateTimeWithSeconds,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import {
  ExtractionReviewPanel,
  type ExtractionReviewModelStep,
} from "@/components/operator/extraction-review-panel";

type ExtractionOperations = FunctionReturnType<
  typeof api.operator.getPolicyExtractionOperations
>;
type ExtractionTraceList = FunctionReturnType<
  typeof api.operator.listExtractionTraces
>;
type ExtractionTraceDetail = FunctionReturnType<
  typeof api.operator.getExtractionTrace
>;
type ExtractionTraceSession = NonNullable<ExtractionTraceDetail>["session"];
type ExtractionTraceEvent = NonNullable<ExtractionTraceDetail>["events"][number];
type OperatorExtractionOperation =
  | "full"
  | "coverage"
  | "search";

export type OperatorPolicyInspection = {
  title: string;
} &
  (
    | {
      kind: "data";
      value: unknown;
    }
    | {
      kind: "source-evidence";
      spans: SourceSpanDoc[];
    }
    | {
      kind: "trace";
      traceId: string;
    }
  );

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasMeaningfulData(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulData);
  if (typeof value === "object") {
    return Object.values(value).some(hasMeaningfulData);
  }
  return false;
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatTokens(input?: number, output?: number) {
  if (input === undefined && output === undefined) return "—";
  return `${(input ?? 0).toLocaleString()} in / ${(output ?? 0).toLocaleString()} out`;
}

function statusTone(status?: string) {
  if (status === "complete") return "success" as const;
  if (status === "error" || status === "cancelled") return "danger" as const;
  if (status === "running" || status === "queued" || status === "leased") {
    return "info" as const;
  }
  if (status === "paused" || status === "warn" || status === "warning") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function displayStatus(status?: string) {
  return status?.replaceAll("_", " ") ?? "Not started";
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      className={`overflow-auto whitespace-pre-wrap break-words rounded-md border border-foreground/6 bg-foreground/[0.02] p-3 text-foreground/80 ${typeStyle("technical.codeCompact")}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DataRow({
  title,
  onView,
}: {
  title: string;
  onView: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onView}
      aria-label={`View ${title}`}
      className="flex w-full items-center justify-between gap-3 border-t border-foreground/6 px-4 py-3 text-left transition-colors first:border-t-0 hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    >
      <span className={`min-w-0 text-foreground ${typeStyle("body.medium")}`}>
        {title}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}

function OperationRow({
  title,
  actionLabel,
  primary = false,
  pending,
  disabled,
  onRun,
}: {
  title: string;
  actionLabel: string;
  primary?: boolean;
  pending: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <OperationalItem className="flex items-center gap-3 py-3">
      <p className={`min-w-0 flex-1 text-foreground ${typeStyle("body.medium")}`}>
        {title}
      </p>
      <PillButton
        type="button"
        size="compact"
        variant={primary ? "primary" : "secondary"}
        disabled={disabled}
        onClick={onRun}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {actionLabel}
      </PillButton>
    </OperationalItem>
  );
}

function ExtractionOverview({
  policy,
  operations,
  readOnly,
  activeOperation,
  onOperation,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  operations: ExtractionOperations | undefined;
  readOnly: boolean;
  activeOperation?: OperatorExtractionOperation | null;
  onOperation?: (operation: OperatorExtractionOperation) => void;
}) {
  const pipelineStatus = textValue(policy.pipelineStatus);
  const processing = pipelineStatus === "running" || pipelineStatus === "paused";
  const fullBlocked = readOnly || processing || activeOperation !== null;
  const targetedBlocked = fullBlocked || pipelineStatus !== "complete";

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader title="Runtime state" />
        {operations === undefined ? (
          <OperationalPanelBody className={`flex items-center gap-2 text-muted-foreground ${typeStyle("body.default")}`}>
            <Loader2 className="size-4 animate-spin" />
            Loading extraction state…
          </OperationalPanelBody>
        ) : operations === null ? (
          <OperationalPanelBody className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Policy extraction state is unavailable.
          </OperationalPanelBody>
        ) : (
          <dl>
            <OperationalLabelValueRow
              label="Pipeline"
              value={
                <StatusTag tone={statusTone(pipelineStatus)}>
                  {displayStatus(pipelineStatus)}
                </StatusTag>
              }
            />
            <OperationalLabelValueRow
              label="Data stage"
              value={displayStatus(textValue(policy.extractionDataStage))}
            />
            {operations.run?.pipelineError ? (
              <OperationalLabelValueRow
                label="Error"
                value={
                  <span className="break-words text-destructive">
                    {operations.run.pipelineError}
                  </span>
                }
              />
            ) : null}
          </dl>
        )}
      </OperationalPanel>

      {onOperation ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Targeted operations" />
          <div>
            <OperationRow
              title="Full extraction"
              actionLabel="Re-extract all"
              primary
              pending={activeOperation === "full"}
              disabled={fullBlocked}
              onRun={() => onOperation("full")}
            />
            <OperationRow
              title="Coverage recovery"
              actionLabel="Recover coverages"
              pending={activeOperation === "coverage"}
              disabled={targetedBlocked}
              onRun={() => onOperation("coverage")}
            />
            <OperationRow
              title="Search index"
              actionLabel="Rebuild index"
              pending={activeOperation === "search"}
              disabled={targetedBlocked}
              onRun={() => onOperation("search")}
            />
          </div>
        </OperationalPanel>
      ) : null}
    </div>
  );
}

function SourceEvidenceList({
  spans,
  fileUrl,
}: {
  spans: SourceSpanDoc[];
  fileUrl?: string | null;
}) {
  return (
    <div className="divide-y divide-foreground/6">
      {spans.map((span) => (
        <div key={span.spanId} className="space-y-2 py-3 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SourceEvidenceButton
              sourceSpanIds={[span.spanId]}
              sourceSpans={[span]}
              fallbackPage={span.pageStart}
              fileUrl={fileUrl ?? undefined}
            />
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {span.sectionId ?? span.formNumber ?? span.sourceUnit ??
                "Unsectioned"}
            </span>
          </div>
          <p
            className={`whitespace-pre-wrap text-foreground ${typeStyle("body.default")}`}
          >
            {span.text ?? "No source text"}
          </p>
          <code
            className={`block break-all text-muted-foreground ${typeStyle("technical.codeCompact")}`}
          >
            {span.spanId}
          </code>
        </div>
      ))}
    </div>
  );
}

function partyRoleLabel(value: unknown) {
  const role = textValue(value) ?? "other";
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function partyAddress(value: unknown) {
  const direct = textValue(value);
  if (direct) return direct;
  const address = recordValue(value);
  if (!address) return "—";
  return (
    [
      textValue(address.street1) ?? textValue(address.line1),
      textValue(address.street2) ?? textValue(address.line2),
      [
        textValue(address.city),
        textValue(address.state),
        textValue(address.zip) ?? textValue(address.postalCode),
      ]
        .filter(Boolean)
        .join(" "),
      textValue(address.country),
    ]
      .filter(Boolean)
      .join(", ") || textValue(address.formatted) || "—"
  );
}

function OperatorPartiesTable({
  policy,
}: {
  policy: Record<string, unknown>;
}) {
  const parties = resolvePolicyPartyContext(policy).parties;
  if (parties.length === 0) return null;

  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader
        title="Policy parties"
      />
      <div className="overflow-x-auto">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[15%] px-4">Role</TableHead>
              <TableHead className="w-[24%]">Name</TableHead>
              <TableHead className="w-[35%]">Address</TableHead>
              <TableHead className="w-[14%]">Identifier</TableHead>
              <TableHead className="w-[12%] px-4">Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parties.map((party, index) => {
              const identifier =
                textValue(party.naicNumber) ??
                textValue(party.licenseNumber) ??
                "—";
              const evidenceCount = new Set([
                ...(party.sourceNodeIds ?? []),
                ...(party.sourceSpanIds ?? []),
              ]).size;
              return (
                <TableRow key={`${party.role}-${party.name}-${index}`}>
                  <TableCell className="px-4 text-muted-foreground">
                    {partyRoleLabel(party.role)}
                  </TableCell>
                  <TableCell className={typeStyle("body.medium")}>
                    {party.name}
                  </TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    {partyAddress(party.address)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {identifier}
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {evidenceCount.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </OperationalPanel>
  );
}

function CurrentExtractionData({
  policy,
  onInspect,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  onInspect: (inspection: OperatorPolicyInspection) => void;
}) {
  const sourceOutline = useCachedQuery(
    "sourceNodes.listOutlineByPolicy.operator-policy",
    api.sourceNodes.listOutlineByPolicy,
    { policyId: policy._id, allowOperatorAccess: true },
  );
  const sourceSpanIds = useMemo(
    () => collectSourceSpanIds(policy).slice(0, 256),
    [policy],
  );
  const sourceSpans = usePolicySourceSpans(policy._id, sourceSpanIds, {
    allowOperatorAccess: true,
    maxIds: 256,
  });
  const lines = Array.isArray(policy.linesOfBusiness)
    ? policy.linesOfBusiness.join(", ") || undefined
    : undefined;
  const term = formatDisplayPolicyPeriod(
    textValue(policy.effectiveDate),
    textValue(policy.expirationDate),
    textValue(policy.policyTermType),
  );

  const sections = [
    ["Operational profile", policy.operationalProfile],
    ["Carrier identity", policy.carrierIdentity],
    ["Product identity", policy.productIdentity],
    ["Coverage projection", policy.coverages],
    ["Coverage schedules", policy.coverageSchedules],
    ["Parties", policy.parties],
    ["Forms", policy.forms],
    ["Endorsements", policy.endorsements],
    ["Locations", policy.locations],
    ["Supplementary facts", policy.supplementaryFacts],
    ["Extraction review", policy.extractionReview],
  ].filter(([, value]) => hasMeaningfulData(value));

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader title="Current extracted record" />
        <dl>
          <OperationalLabelValueRow label="Policy ID" value={policy._id} />
          <OperationalLabelValueRow label="Organization ID" value={textValue(policy.orgId)} />
          <OperationalLabelValueRow label="Source file" value={textValue(policy.fileName)} />
          <OperationalLabelValueRow label="Carrier" value={textValue(policy.carrier)} />
          <OperationalLabelValueRow label="Named insured" value={textValue(policy.insuredName)} />
          <OperationalLabelValueRow label="Policy number" value={textValue(policy.policyNumber)} />
          <OperationalLabelValueRow label="Term" value={term} />
          <OperationalLabelValueRow label="Lines of business" value={lines} />
          <OperationalLabelValueRow label="Premium" value={textValue(policy.premium)} />
          <OperationalLabelValueRow label="Preview model" value={textValue(policy.extractionPreviewModel)} />
        </dl>
      </OperationalPanel>

      <OperatorPartiesTable policy={policy} />

      <OperationalPanel>
        {sections.map(([title, value]) => (
          <DataRow
            key={title as string}
            title={title as string}
            onView={() =>
              onInspect({
                kind: "data",
                title: title as string,
                value,
              })
            }
          />
        ))}
        <DataRow
          title="Raw policy document"
          onView={() =>
            onInspect({
              kind: "data",
              title: "Raw policy document",
              value: policy,
            })
          }
        />
        {hasMeaningfulData(sourceOutline) ? (
          <DataRow
            title="Source tree outline"
            onView={() =>
              onInspect({
                kind: "data",
                title: "Source tree outline",
                value: sourceOutline,
              })
            }
          />
        ) : null}
        {sourceSpans && sourceSpans.length > 0 ? (
          <DataRow
            title="Referenced source evidence"
            onView={() =>
              onInspect({
                kind: "source-evidence",
                title: "Referenced source evidence",
                spans: sourceSpans,
              })
            }
          />
        ) : null}
      </OperationalPanel>
    </div>
  );
}

function traceTitle(trace: { trigger?: string; startedAt: number }) {
  return trace.trigger
    ? `${displayStatus(trace.trigger)} · ${formatDisplayDateTime(trace.startedAt)}`
    : formatDisplayDateTime(trace.startedAt);
}

function eventTitle(event: ExtractionTraceEvent) {
  return (
    textValue(event.label) ??
    textValue(event.taskKind) ??
    textValue(event.task) ??
    textValue(event.phase) ??
    displayStatus(event.kind)
  );
}

function traceEventSource(event: ExtractionTraceEvent) {
  if (event.kind === "phase") {
    return textValue(event.phase) ?? "phase";
  }
  if (event.kind === "log") {
    return textValue(event.label) ?? "log";
  }
  return displayStatus(event.kind);
}

function traceEventMessage(event: ExtractionTraceEvent) {
  const source = traceEventSource(event);
  const message = textValue(event.error) ?? textValue(event.message);
  if (message) return message;
  const title = eventTitle(event);
  if (title.toLowerCase() !== source.toLowerCase()) return title;
  return displayStatus(
    textValue(event.status) ?? textValue(event.level) ?? event.kind,
  );
}

type TimelineRow = {
  id: string;
  event: ExtractionTraceEvent;
  label: string;
  caption: string;
  kind: ExtractionTraceEvent["kind"];
  startMs: number;
  endMs: number;
  durationMs: number;
};

function eventTiming(
  event: ExtractionTraceEvent,
  session: ExtractionTraceSession,
): TimelineRow {
  if ((event.durationMs ?? 0) > 0) {
    const durationMs = event.durationMs ?? 0;
    return {
      id: event._id,
      event,
      label: traceEventMessage(event),
      caption: traceEventSource(event),
      kind: event.kind,
      startMs: Math.max(session.startedAt, event.timestamp - durationMs),
      endMs: event.timestamp,
      durationMs,
    };
  }
  return {
    id: event._id,
    event,
    label: traceEventMessage(event),
    caption: traceEventSource(event),
    kind: event.kind,
    startMs: event.timestamp,
    endMs: event.timestamp,
    durationMs: 0,
  };
}

function buildTimelineRows(
  events: ExtractionTraceEvent[],
  session: ExtractionTraceSession,
) {
  return events.map((event) => eventTiming(event, session));
}

function timelineColor(event: ExtractionTraceEvent) {
  if (event.kind === "model_call") {
    if (event.error || event.status === "error") return "bg-destructive";
    if (event.status === "soft_failed") return "bg-chart-4";
    return "bg-chart-1";
  }
  if (event.kind === "phase") return "bg-foreground";
  if (event.kind === "embedding_batch") return "bg-chart-3";
  if (event.kind === "worker") return "bg-chart-5";
  if (event.kind === "artifact") return "bg-chart-4";
  return "bg-muted-foreground";
}

function TimelineWaterfall({
  rows,
  session,
}: {
  rows: TimelineRow[];
  session: ExtractionTraceSession;
}) {
  const [labelWidth, setLabelWidth] = useState(150);
  const startAt = session.startedAt;
  const endAt = Math.max(
    session.completedAt ?? 0,
    session.lastEventAt ?? 0,
    ...rows.map((row) => row.endMs),
    startAt + 1,
  );
  const durationMs = Math.max(1, endAt - startAt);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const gridTemplateColumns = `${labelWidth}px minmax(0, 1fr)`;

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = labelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setLabelWidth(
        Math.max(
          110,
          Math.min(280, startWidth + moveEvent.clientX - startX),
        ),
      );
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div className="flex h-[28rem] min-h-80 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize event column"
            onPointerDown={startResize}
            className="absolute inset-y-0 z-20 w-1 cursor-col-resize hover:bg-foreground/8 active:bg-foreground/12"
            style={{ left: `${labelWidth - 2}px` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid"
            style={{ gridTemplateColumns }}
          >
            <div className="border-r border-foreground/6" />
            <div className="relative min-w-0">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute inset-y-0 border-l border-foreground/6"
                  style={{ left: `${tick * 100}%` }}
                />
              ))}
            </div>
          </div>
          <div
            className="relative z-10 grid border-b border-foreground/6 bg-foreground/[0.02]"
            style={{ gridTemplateColumns }}
          >
            <div
              className={`px-2.5 py-2 text-muted-foreground ${typeStyle("caption.medium")}`}
            >
              Event
            </div>
            <div className="relative h-8 min-w-0 overflow-hidden">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className={`absolute top-2 ml-1 text-muted-foreground ${typeStyle("caption.default")}`}
                  style={{ left: `${tick * 100}%` }}
                >
                  {formatDuration(durationMs * tick)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative z-10 min-h-0 overflow-y-auto">
            <div className="min-h-full">
              {rows.length > 0 ? (
                rows.map((row) => {
                  const left = ((row.startMs - startAt) / durationMs) * 100;
                  const hasDuration = row.durationMs > 0;
                  const width = hasDuration
                    ? Math.max(1.5, (row.durationMs / durationMs) * 100)
                    : 0;
                  const constrainedLeft = Math.max(0, Math.min(100, left));
                  const constrainedWidth = Math.min(
                    100 - constrainedLeft,
                    width,
                  );
                  const durationLabel = formatDuration(row.durationMs);
                  const showDurationInside =
                    hasDuration && constrainedWidth >= 8;
                  const showOutsideAfter =
                    constrainedLeft + constrainedWidth <= 88;
                  return (
                    <div
                      key={row.id}
                      className="grid min-h-10 border-b border-foreground/6 text-left hover:bg-foreground/[0.025]"
                      style={{ gridTemplateColumns }}
                    >
                      <div className="min-w-0 px-2.5 py-1.5">
                        <p
                          className={`min-w-0 truncate text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {row.caption}
                        </p>
                        <p
                          className={`min-w-0 truncate text-foreground ${typeStyle("caption.medium")}`}
                        >
                          {row.label}
                        </p>
                      </div>
                      <div className="relative min-w-0 overflow-hidden py-1.5">
                        {hasDuration ? (
                          <div
                            className={`absolute top-3 flex h-4 -translate-y-1/2 items-center justify-center rounded-sm px-1 ${timelineColor(row.event)}`}
                            style={{
                              left: `${constrainedLeft}%`,
                              width: `${constrainedWidth}%`,
                            }}
                            title={`${row.label} · ${durationLabel}`}
                          >
                            {showDurationInside ? (
                              <span
                                className={`truncate text-background ${typeStyle("caption.medium")}`}
                              >
                                {durationLabel}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span
                            className={`absolute top-1.5 h-4 w-px ${timelineColor(row.event)}`}
                            style={{ left: `${constrainedLeft}%` }}
                            title={`${row.caption} · ${row.label}`}
                          />
                        )}
                        {hasDuration && !showDurationInside ? (
                          <span
                            className={`pointer-events-none absolute top-1/2 max-w-14 -translate-y-1/2 truncate px-1 text-foreground ${typeStyle("caption.medium")}`}
                            style={
                              showOutsideAfter
                                ? {
                                    left: `${
                                      constrainedLeft + constrainedWidth
                                    }%`,
                                  }
                                : { right: `${100 - constrainedLeft}%` }
                            }
                          >
                            {durationLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p
                  className={`px-3 py-3 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  No trace events recorded yet.
                </p>
              )}
            </div>
          </div>
        </div>
        <div
          className={`flex flex-wrap gap-3 border-t border-foreground/6 px-3 py-2 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-foreground" />
            phase
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-chart-1" />
            model call
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-chart-4" />
            model fallback
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-destructive" />
            model error
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-chart-3" />
            embedding
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-sm bg-chart-5" />
            worker
          </span>
        </div>
      </div>
    </div>
  );
}

function TraceEventList({ events }: { events: ExtractionTraceEvent[] }) {
  if (events.length === 0) {
    return (
      <OperationalPanelBody className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}>
        No trace events were retained for this run.
      </OperationalPanelBody>
    );
  }

  return (
    <div className="divide-y divide-foreground/6">
      {events.map((event) => (
        <TraceEventRow key={event._id} event={event} />
      ))}
    </div>
  );
}

function traceEventSeverity(event: ExtractionTraceEvent) {
  const value = (
    textValue(event.level) ??
    textValue(event.status) ??
    "info"
  ).toLowerCase();
  if (event.error || value === "error" || value === "failed") {
    return "error" as const;
  }
  if (
    value === "warn" ||
    value === "warning" ||
    value === "soft_failed"
  ) {
    return "warning" as const;
  }
  return "info" as const;
}

function traceEventHasDetails(event: ExtractionTraceEvent) {
  return Boolean(
    event.details ||
      event.routing ||
      event.error ||
      event.provider ||
      event.model ||
      event.durationMs !== undefined ||
      event.inputTokens !== undefined ||
      event.outputTokens !== undefined,
  );
}

function TraceEventSummary({
  event,
  expandable,
}: {
  event: ExtractionTraceEvent;
  expandable: boolean;
}) {
  const severity = traceEventSeverity(event);
  return (
    <div className="grid min-h-10 grid-cols-[5.75rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      <time
        dateTime={dayjs(event.timestamp).toISOString()}
        title={formatDisplayDateTimeWithSeconds(event.timestamp)}
        className={`text-muted-foreground ${typeStyle("technical.codeCompact")}`}
      >
        {dayjs(event.timestamp).format("HH:mm:ss.SSS")}
      </time>
      <div className="grid min-w-0 gap-x-3 sm:grid-cols-[minmax(7rem,0.24fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <span
            className={`truncate text-muted-foreground ${typeStyle("caption.medium")}`}
          >
            {traceEventSource(event)}
          </span>
        </div>
        <p
          className={`min-w-0 truncate ${
            severity === "error" ? "text-destructive" : "text-foreground"
          } ${typeStyle("body.default")}`}
          title={traceEventMessage(event)}
        >
          {traceEventMessage(event)}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 text-muted-foreground">
        {severity !== "info" ? (
          <span
            className={`hidden sm:inline ${
              severity === "error" ? "text-destructive" : "text-warning"
            } ${typeStyle("caption.medium")}`}
          >
            {severity}
          </span>
        ) : null}
        {event.durationMs !== undefined ? (
          <span className={typeStyle("technical.numeric")}>
            {formatDuration(event.durationMs)}
          </span>
        ) : null}
        {expandable ? (
          <ChevronRight
            className="size-3.5 shrink-0 group-open/trace-event:rotate-90"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : (
          <span className="size-3.5" />
        )}
      </div>
    </div>
  );
}

function TraceEventDetails({ event }: { event: ExtractionTraceEvent }) {
  const rows = [
    ["Time", formatDisplayDateTimeWithSeconds(event.timestamp)],
    [
      "State",
      displayStatus(textValue(event.status) ?? textValue(event.level) ?? event.kind),
    ],
    event.phase ? ["Phase", event.phase] : null,
    event.durationMs !== undefined
      ? ["Duration", formatDuration(event.durationMs)]
      : null,
    event.inputTokens !== undefined || event.outputTokens !== undefined
      ? ["Tokens", formatTokens(event.inputTokens, event.outputTokens)]
      : null,
    event.provider || event.model
      ? ["Model", [event.provider, event.model].filter(Boolean).join(" / ")]
      : null,
    event.routeSource || event.transport
      ? [
          "Route",
          [event.routeSource, event.transport].filter(Boolean).join(" · "),
        ]
      : null,
  ].filter((row): row is [string, string] => Boolean(row));

  return (
    <div className="border-t border-foreground/6 bg-foreground/[0.02] px-3 py-3 sm:pl-[7.25rem]">
      <dl
        className={`grid gap-x-6 gap-y-1.5 sm:grid-cols-2 ${typeStyle("caption.default")}`}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {event.error ? (
        <p className={`mt-3 whitespace-pre-wrap text-destructive ${typeStyle("body.default")}`}>
          {event.error}
        </p>
      ) : null}
      {event.error && event.message ? (
        <p className={`mt-3 whitespace-pre-wrap text-foreground ${typeStyle("body.default")}`}>
          {event.message}
        </p>
      ) : null}
      {event.details || event.routing ? (
        <div className="mt-3">
          <JsonBlock value={{ routing: event.routing, details: event.details }} />
        </div>
      ) : null}
    </div>
  );
}

function TraceEventRow({ event }: { event: ExtractionTraceEvent }) {
  const expandable = traceEventHasDetails(event);
  if (!expandable) {
    return <TraceEventSummary event={event} expandable={false} />;
  }
  return (
    <details className="group/trace-event">
      <summary className="cursor-pointer list-none hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <TraceEventSummary event={event} expandable />
      </summary>
      <TraceEventDetails event={event} />
    </details>
  );
}

function ExtractionDiagnostics({
  traces,
  selectedTraceId,
  onSelectTrace,
}: {
  traces: ExtractionTraceList | undefined;
  selectedTraceId: string | null;
  onSelectTrace: (traceId: string) => void;
}) {
  return (
    <OperationalPanel>
      {traces === undefined ? (
        <OperationalPanelBody className={`flex items-center gap-2 text-muted-foreground ${typeStyle("body.default")}`}>
          <Loader2 className="size-4 animate-spin" />
          Loading extraction runs…
        </OperationalPanelBody>
      ) : traces.length === 0 ? (
        <OperationalPanelBody
          className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}
        >
          No extraction traces are retained for this policy.
        </OperationalPanelBody>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[780px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Started</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Model calls</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Trace ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((trace) => (
                <TableRow
                  key={trace.traceId}
                  tabIndex={0}
                  aria-selected={selectedTraceId === trace.traceId}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  onClick={() => onSelectTrace(trace.traceId)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelectTrace(trace.traceId);
                  }}
                >
                  <TableCell>{formatDisplayDateTime(trace.startedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {displayStatus(trace.trigger)}
                  </TableCell>
                  <TableCell>
                    <StatusTag tone={statusTone(trace.status)}>
                      {displayStatus(trace.status)}
                    </StatusTag>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(trace.totalDurationMs)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {trace.modelCallCount?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTokens(trace.inputTokens, trace.outputTokens)}
                  </TableCell>
                  <TableCell className="max-w-52 truncate text-muted-foreground">
                    <code className={typeStyle("technical.codeCompact")}>
                      {trace.traceId}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </OperationalPanel>
  );
}

function TraceInspection({ traceId }: { traceId: string }) {
  const detail = useCachedOperatorExtractionTraceDetail(traceId) as
    | ExtractionTraceDetail
    | undefined;

  if (detail === undefined) {
    return (
      <OperationalPanel>
        <OperationalPanelBody className={`flex items-center gap-2 text-muted-foreground ${typeStyle("body.default")}`}>
          <Loader2 className="size-4 animate-spin" />
          Loading run details…
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  if (detail === null) {
    return (
      <OperationalPanel>
        <OperationalPanelBody className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}>
          This trace is no longer available.
        </OperationalPanelBody>
      </OperationalPanel>
    );
  }

  const timelineRows = buildTimelineRows(detail.events, detail.session);
  const reviewModelSteps = detail.events.reduce<ExtractionReviewModelStep[]>(
    (steps, event) => {
      if (
        event.kind !== "model_call" ||
        !event.routerRequestId ||
        event.error ||
        event.status === "error" ||
        steps.some((step) => step.requestId === event.routerRequestId)
      ) {
        return steps;
      }
      steps.push({
        requestId: event.routerRequestId,
        label: [
          event.taskKind ?? event.label ?? event.task ?? "Model call",
          event.provider && event.model
            ? `${event.provider}/${event.model}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      return steps;
    },
    [],
  );

  return (
    <Tabs defaultValue="overview" className="gap-4">
      <TabsList variant="pill" aria-label="Extraction trace details">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-4">
        <ExtractionReviewPanel
          targetKind="policy_extraction"
          targetId={detail.session.traceId}
          modelSteps={reviewModelSteps}
        />
        <OperationalPanel>
          <dl>
            <OperationalLabelValueRow
              label="Status"
              value={
                <StatusTag tone={statusTone(detail.session.status)}>
                  {displayStatus(detail.session.status)}
                </StatusTag>
              }
            />
            <OperationalLabelValueRow
              label="Trace ID"
              value={
                <code className={typeStyle("technical.codeCompact")}>
                  {detail.session.traceId}
                </code>
              }
            />
            <OperationalLabelValueRow
              label="Duration"
              value={formatDuration(detail.session.totalDurationMs)}
            />
            <OperationalLabelValueRow
              label="Model calls"
              value={detail.session.modelCallCount?.toLocaleString() ?? "0"}
            />
            <OperationalLabelValueRow
              label="Model time"
              value={formatDuration(detail.session.modelDurationMs)}
            />
            <OperationalLabelValueRow
              label="Tokens"
              value={formatTokens(
                detail.session.inputTokens,
                detail.session.outputTokens,
              )}
            />
          </dl>
        </OperationalPanel>
        <OperationalPanel>
          <TimelineWaterfall rows={timelineRows} session={detail.session} />
        </OperationalPanel>
      </TabsContent>
      <TabsContent value="logs">
        <OperationalPanel>
          {detail.eventsTruncated ? (
            <div
              className={`flex items-start gap-2 border-b border-foreground/6 px-4 py-3 text-warning ${typeStyle("body.default")}`}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              This trace is large, so only the retained event cap is shown.
            </div>
          ) : null}
          <TraceEventList events={detail.events} />
        </OperationalPanel>
      </TabsContent>
    </Tabs>
  );
}

export function OperatorPolicyInspectionPanel({
  inspection,
  fileUrl,
  onClose,
}: {
  inspection: OperatorPolicyInspection;
  fileUrl?: string | null;
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={inspection.title}
    >
      {inspection.kind === "data" ? (
        <JsonBlock value={inspection.value} />
      ) : inspection.kind === "source-evidence" ? (
        <SourceEvidenceList spans={inspection.spans} fileUrl={fileUrl} />
      ) : (
        <TraceInspection traceId={inspection.traceId} />
      )}
    </SettingsDrawer>
  );
}

export function OperatorPolicyWorkspace({
  policy,
  onInspect,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  onInspect: (inspection: OperatorPolicyInspection) => void;
}) {
  return <CurrentExtractionData policy={policy} onInspect={onInspect} />;
}

export function OperatorPolicyExtractionHistory({
  policyId,
  initialTraceId,
  inspection,
  onInspect,
}: {
  policyId: Id<"policies">;
  initialTraceId?: string | null;
  inspection?: OperatorPolicyInspection | null;
  onInspect: (inspection: OperatorPolicyInspection) => void;
}) {
  const traces = useCachedOperatorExtractionTraces({
    policyId,
    range: "all",
    limit: 50,
  }) as ExtractionTraceList | undefined;
  const openedInitialTraceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialTraceId || !traces?.length) return;
    if (openedInitialTraceRef.current === initialTraceId) return;
    const trace = traces.find((row) => row.traceId === initialTraceId);
    if (!trace) return;
    openedInitialTraceRef.current = initialTraceId;
    onInspect({
      kind: "trace",
      title: traceTitle(trace),
      traceId: trace.traceId,
    });
  }, [initialTraceId, onInspect, traces]);

  const selectedTraceId =
    inspection?.kind === "trace" ? inspection.traceId : null;

  return (
    <ExtractionDiagnostics
      traces={traces}
      selectedTraceId={selectedTraceId}
      onSelectTrace={(traceId) => {
        const trace = traces?.find((row) => row.traceId === traceId);
        onInspect({
          kind: "trace",
          title: trace ? traceTitle(trace) : "Extraction run",
          traceId,
        });
      }}
    />
  );
}

export function OperatorPolicyExtractionPanel({
  policy,
  readOnly,
  onClose,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  readOnly: boolean;
  onClose: () => void;
}) {
  const operations = useCachedQuery(
    "operator.getPolicyExtractionOperations",
    api.operator.getPolicyExtractionOperations,
    { policyId: policy._id },
  ) as ExtractionOperations | undefined;
  const [activeOperation, setActiveOperation] =
    useState<OperatorExtractionOperation | null>(null);
  const [stopping, setStopping] = useState(false);
  const [confirmFullExtraction, setConfirmFullExtraction] = useState(false);
  const rerunExtraction = useAction(api.operator.rerunExtraction);
  const recoverCoverages = useAction(api.operator.backfillCoverageRecovery);
  const rebuildSearchIndex = useAction(api.operator.rebuildPolicySearchIndex);
  const stopExtraction = useMutation(api.operator.stopExtraction);

  const runOperation = useCallback(
    async (operation: OperatorExtractionOperation) => {
      if (operation === "full") {
        setConfirmFullExtraction(true);
        return;
      }
      setActiveOperation(operation);
      try {
        if (operation === "coverage") {
          const result = await recoverCoverages({
            policyId: policy._id,
            force: true,
          });
          if (recordValue(result)?.ok === false) {
            throw new Error(
              textValue(recordValue(result)?.status) ??
                "Coverage recovery did not complete",
            );
          }
          toast.success("Coverage recovery complete");
        } else {
          const result = await rebuildSearchIndex({ policyId: policy._id });
          const row = recordValue(result);
          const chunks = row?.newChunks;
          toast.success(
            typeof chunks === "number"
              ? `Search index rebuilt · ${chunks} chunks`
              : "Search index rebuilt",
          );
        }
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Extraction operation failed"),
        );
      } finally {
        setActiveOperation(null);
      }
    }, [policy._id, rebuildSearchIndex, recoverCoverages],
  );

  const confirmFullRerun = useCallback(async () => {
    setActiveOperation("full");
    try {
      await rerunExtraction({ policyId: policy._id });
      toast.success("Full extraction started");
      setConfirmFullExtraction(false);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Re-extraction failed"));
    } finally {
      setActiveOperation(null);
    }
  }, [policy._id, rerunExtraction]);

  const stopCurrentRun = useCallback(async () => {
    const traceId = operations?.latestTrace?.traceId;
    if (!traceId) return;
    setStopping(true);
    try {
      const result = await stopExtraction({ traceId });
      toast.success(result.stopped ? "Extraction stopped" : "Run was already stopped");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not stop extraction"));
    } finally {
      setStopping(false);
    }
  }, [operations?.latestTrace?.traceId, stopExtraction]);

  return (
    <>
      <Dialog
        open={confirmFullExtraction}
        onOpenChange={(open) => {
          if (!activeOperation) setConfirmFullExtraction(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rerun the complete extraction?</DialogTitle>
            <DialogDescription>
              Spot will reparse the original PDF and replace the current
              extracted fields, source tree, chunks, and operational profile
              when the run completes. Existing policy history remains intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              type="button"
              variant="secondary"
              disabled={activeOperation === "full"}
              onClick={() => setConfirmFullExtraction(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              type="button"
              disabled={activeOperation === "full"}
              onClick={confirmFullRerun}
            >
              {activeOperation === "full" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Start full extraction
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Extraction operations"
      >
        <div className="space-y-4">
          {operations?.latestTrace?.status === "running" ? (
            <OperationalPanel as="div">
              <OperationalPanelHeader
                title="Extraction running"
                action={
                  <PillButton
                    type="button"
                    size="compact"
                    variant="secondary"
                    disabled={readOnly || stopping}
                    onClick={stopCurrentRun}
                  >
                    {stopping ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Stop run
                  </PillButton>
                }
              />
            </OperationalPanel>
          ) : null}
          <ExtractionOverview
            policy={policy}
            operations={operations}
            readOnly={readOnly}
            activeOperation={activeOperation}
            onOperation={runOperation}
          />
        </div>
      </SettingsDrawer>
    </>
  );
}
