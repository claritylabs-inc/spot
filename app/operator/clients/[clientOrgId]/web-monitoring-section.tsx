"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@claritylabs-inc/ui/components/alert-dialog";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { SuggestionSources } from "@/components/procurement/information/suggestion";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type WebMonitor = FunctionReturnType<typeof api.clientWebMonitors.forClient>;
type MonitorEvent = WebMonitor["events"][number];

const FREQUENCY_LABELS: Record<string, string> = {
  "1h": "hourly",
  "1d": "daily",
  "1w": "weekly",
};

function frequencyLabel(frequency: string) {
  return FREQUENCY_LABELS[frequency] ?? `every ${frequency}`;
}

function categoryLabel(category: string | undefined) {
  const text = (category ?? "other").replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function monitorState(monitor: WebMonitor["monitor"]) {
  if (monitor?.status === "pending")
    return { label: "Starting…", running: true, failed: false };
  if (monitor?.status === "active")
    return {
      label: `Active · ${frequencyLabel(monitor.frequency)}`,
      running: true,
      failed: false,
    };
  if (monitor?.status === "failed")
    return {
      label: `Failed${monitor.error ? `: ${monitor.error}` : ""}`,
      running: false,
      failed: true,
    };
  return { label: "Off", running: false, failed: false };
}

const MATERIALITY_TONES = {
  high: "danger",
  medium: "warning",
  low: "neutral",
} as const;

function MonitorEventRow({
  event,
  orgId,
  readOnly,
}: {
  event: MonitorEvent;
  orgId: Id<"organizations">;
  readOnly: boolean;
}) {
  const acknowledge = useMutation(api.clientWebMonitors.acknowledgeEvents);
  const [busy, setBusy] = useState(false);
  const date =
    formatDisplayDate(event.eventDate) || formatDisplayDate(event.receivedAt);
  return (
    <li
      className={`flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3 ${event.acknowledged ? "text-muted-foreground" : ""}`}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        {/* Headlines and summaries are untrusted web text: plain text only. */}
        <p className="break-words">{event.headline}</p>
        <p
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          <span>{categoryLabel(event.category)}</span>
          {event.materiality && (
            <StatusTag tone={MATERIALITY_TONES[event.materiality]}>
              {categoryLabel(event.materiality)}
            </StatusTag>
          )}
          <span>{date}</span>
        </p>
        <SuggestionSources citations={event.citations.slice(0, 1)} />
      </div>
      {!readOnly && !event.acknowledged && (
        <PillButton
          variant="secondary"
          size="compact"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            acknowledge({ orgId, eventIds: [event.eventId] })
              .catch((error) =>
                toast.error(
                  getUserFacingErrorMessage(
                    error,
                    "Could not acknowledge event",
                  ),
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Acknowledge
        </PillButton>
      )}
    </li>
  );
}

/** Opt-in public web monitoring for one client: status, start/stop and recent events. */
export function WebMonitoringSection({
  orgId,
  readOnly,
}: {
  orgId: Id<"organizations">;
  readOnly: boolean;
}) {
  const data = useQuery(api.clientWebMonitors.forClient, { orgId });
  const start = useAction(api.actions.clientWebMonitors.start);
  const stop = useAction(api.actions.clientWebMonitors.stop);
  const [working, setWorking] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  if (!data) return <Skeleton className="h-24 w-full" />;
  const state = monitorState(data.monitor);
  async function run(work: () => Promise<unknown>, failure: string) {
    setWorking(true);
    try {
      await work();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, failure));
    } finally {
      setWorking(false);
    }
  }
  return (
    <section aria-label="Web monitoring" className="space-y-3">
      <InlineFieldCard
        title="Web monitoring"
        actions={
          !readOnly &&
          (state.running ? (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={working || data.monitor?.status === "pending"}
              onClick={() => setConfirmStop(true)}
            >
              Stop
            </PillButton>
          ) : (
            <PillButton
              variant="secondary"
              size="compact"
              disabled={working}
              onClick={() =>
                void run(async () => {
                  await start({ orgId });
                  toast.success("Web monitoring started");
                }, "Could not start web monitoring")
              }
            >
              {working ? "Starting…" : state.failed ? "Retry" : "Start"}
            </PillButton>
          ))
        }
      >
        <InlineFieldRow label="Status">
          <span
            className={`block px-3 py-2 break-words ${state.failed ? "text-destructive" : ""}`}
          >
            {state.label}
          </span>
        </InlineFieldRow>
        <InlineFieldRow label="Last event">
          <span className="block px-3 py-2">
            {data.monitor?.lastEventAt
              ? formatDisplayDate(data.monitor.lastEventAt)
              : "None yet"}
          </span>
        </InlineFieldRow>
      </InlineFieldCard>
      {data.events.length > 0 && (
        <ul
          aria-label="Recent web events"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
        >
          {data.events.map((event) => (
            <MonitorEventRow
              key={event.eventId}
              event={event}
              orgId={orgId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      {data.eventsBounded && (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Showing the 10 most recent events.
        </p>
      )}
      <AlertDialog
        open={confirmStop}
        onOpenChange={(open) => {
          if (!working) setConfirmStop(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop web monitoring?</AlertDialogTitle>
            <AlertDialogDescription>
              Spot stops watching public sources for this client. Existing
              events stay on this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PillButton
              variant="secondary"
              disabled={working}
              onClick={() => setConfirmStop(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={working}
              onClick={() =>
                void run(async () => {
                  await stop({ orgId });
                  setConfirmStop(false);
                  toast.success("Web monitoring stopped");
                }, "Could not stop web monitoring")
              }
            >
              {working ? "Stopping…" : "Stop monitoring"}
            </PillButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
