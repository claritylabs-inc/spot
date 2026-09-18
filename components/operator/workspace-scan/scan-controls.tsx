"use client";

import { ScanQueryBoundary } from "./scan-query-boundary";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { GoogleWorkspaceScanPhase } from "@/convex/lib/googleWorkspaceScan";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
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
import { formatDisplayDateTime } from "@/lib/date-format";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import {
  SCAN_INTERVAL_LABELS,
  ScanSettingsDrawer,
} from "./scan-settings-drawer";

const PHASE_LABELS: Record<GoogleWorkspaceScanPhase, string> = {
  discovery: "Finding mailboxes",
  collection: "Reading mail",
  reconciliation: "Updating records",
  completed: "Completed",
  partial: "Partially completed",
  paused: "Paused",
};

type ScanControlsProps = {
  ready: boolean;
  onRightPanel: (node: ReactNode) => void;
};
export function WorkspaceScanControls(props: ScanControlsProps) {
  return (
    <ScanQueryBoundary>
      <ScanControls {...props} />
    </ScanQueryBoundary>
  );
}

function ScanControls({ ready, onRightPanel }: ScanControlsProps) {
  const status = useQuery(api.operatorGoogleWorkspaceScan.getStatus, {});
  const current = useCachedOperatorCurrent();
  const save = useMutation(api.operatorGoogleWorkspaceScan.updateSettings);
  const start = useMutation(api.operatorGoogleWorkspaceScan.startScan);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function change(action: "pause" | "start") {
    if (!status || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === "pause") {
        await save({
          enabled: false,
          expectedAuthorizationRevision: status.config.authorizationRevision,
          expectedSettingsUpdatedAt: status.config.settingsUpdatedAt,
          intervalMinutes: status.config.intervalMinutes,
        });
        toast.success("Automatic updates paused");
      } else {
        const result = await start({});
        toast.success(
          result.alreadyRunning ? "A scan is already running" : "Scan started",
        );
      }
    } catch (cause) {
      setError(
        getUserFacingErrorMessage(cause, "The scan could not be updated."),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!status || !current)
    return (
      <OperationalPanel className="p-4">
        <p role="status">Loading scan settings…</p>
      </OperationalPanel>
    );
  const run = status.latestRun;
  const running =
    run && ["discovery", "collection", "reconciliation"].includes(run.phase);
  const enabled = status.config.enabled;
  const configure = () =>
    onRightPanel(
      <ScanSettingsDrawer
        key={`${status.config.authorizationRevision}:${status.config.settingsUpdatedAt}`}
        config={status.config}
        currentOperatorId={current.user._id}
        ready={ready}
        onSave={save}
        onClose={() => onRightPanel(null)}
      />,
    );

  return (
    <section className="space-y-3" aria-label="Automatic email updates">
      <OperationalPanel>
        <OperationalPanelHeader
          title="Automatic updates"
          action={
            <StatusTag tone={enabled ? "info" : "neutral"} indicator={enabled ? "complete" : "inactive"}>
              {enabled ? "Enabled" : "Paused"}
            </StatusTag>
          }
        />
        <dl>
          <OperationalLabelValueRow
            label="Authorized by"
            value={
              status.config.authorizingOperatorLabel ?? "No authorization yet"
            }
          />
          <OperationalLabelValueRow
            label="Schedule"
            value={SCAN_INTERVAL_LABELS[status.config.intervalMinutes]}
          />
          <OperationalLabelValueRow
            label="Current scan"
            value={run ? PHASE_LABELS[run.phase] : "Not started"}
          />
          <OperationalLabelValueRow
            label="Last successful scan"
            value={formatDisplayDateTime(
              status.lastSuccessAt,
              "No successful scan yet",
            )}
          />
          <OperationalLabelValueRow
            label="Next scan"
            value={
              enabled
                ? formatDisplayDateTime(
                    status.nextRunAt,
                    running ? "After the current scan" : "Waiting to start",
                  )
                : "Paused"
            }
          />
        </dl>
        {status.config.pausedReason ? (
          <p
            role="status"
            className={`px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {status.config.pausedReason}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className={`px-4 py-3 text-destructive ${typeStyle("body.default")}`}
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          <PillButton variant="secondary" disabled={busy} onClick={configure}>
            {enabled ? "Edit schedule" : "Enable automatic updates"}
          </PillButton>
          {enabled ? (
            <>
              <PillButton
                variant="secondary"
                disabled={busy}
                onClick={() => void change("pause")}
              >
                Pause
              </PillButton>
              <PillButton
                disabled={busy || !ready || Boolean(running)}
                onClick={() => void change("start")}
              >
                Scan now
              </PillButton>
            </>
          ) : null}
        </div>
      </OperationalPanel>
      {run ? (
        <>
          <OperationalLabelValueList title="Scan coverage">
            <OperationalLabelValueRow
              label="Mail since"
              value={formatDisplayDateTime(
                run.coverage.windowStartAt,
                "Preparing the initial 90-day scan",
              )}
            />
            <OperationalLabelValueRow
              label="Mailboxes"
              value={`${run.coverage.completedMailboxes} of ${run.coverage.discoveredMailboxes} completed${run.coverage.directoryComplete ? "" : " · Finding more mailboxes"}`}
            />
            <OperationalLabelValueRow
              label="Messages read"
              value={run.coverage.collectedMessages.toLocaleString()}
            />
            <OperationalLabelValueRow
              label="Updates processed"
              value={`${run.coverage.reconciledSources.toLocaleString()} processed · ${run.coverage.pendingSources.toLocaleString()} pending`}
            />
            {run.coverage.failedMailboxes > 0 ? (
              <OperationalLabelValueRow
                label="Mailbox failures"
                value={
                  <span className="text-destructive">
                    {run.coverage.failedMailboxes} mailboxes could not be
                    completed
                  </span>
                }
              />
            ) : null}
            {run.error ? (
              <OperationalLabelValueRow
                label="Scan error"
                value={<span className="text-destructive">{run.error}</span>}
              />
            ) : null}
          </OperationalLabelValueList>
          <ScanMailboxes />
        </>
      ) : null}
    </section>
  );
}

function ScanMailboxes() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.operatorGoogleWorkspaceScan.listMailboxes,
    {},
    { initialNumItems: 20 },
  );
  return (
    <OperationalPanel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mailbox</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Last success</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status === "LoadingFirstPage" ? (
            <TableRow>
              <TableCell colSpan={3}>
                <span role="status">Loading mailbox coverage…</span>
              </TableCell>
            </TableRow>
          ) : results.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3}>No mailboxes discovered yet.</TableCell>
            </TableRow>
          ) : (
            results.map((mailbox) => (
              <TableRow key={mailbox.id}>
                <TableCell className="whitespace-normal break-all">
                  {mailbox.mailbox}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <StatusTag
                    indicator={mailbox.status === "pending" ? "waiting" : undefined}
                    tone={
                      mailbox.status === "failed"
                        ? "danger"
                        : mailbox.status === "completed"
                          ? "success"
                          : "info"
                    }
                  >
                    {mailbox.status === "completed"
                      ? "Completed"
                      : mailbox.status === "failed"
                        ? "Failed"
                        : mailbox.status === "pending"
                          ? "Waiting"
                          : mailbox.phase === "baseline"
                            ? "Reading past mail"
                            : "Reading new mail"}
                  </StatusTag>
                  <p className="mt-1 text-muted-foreground">
                    {mailbox.collectedMessages.toLocaleString()} messages
                  </p>
                  {mailbox.error ? (
                    <p className="mt-1 text-destructive">{mailbox.error}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  {formatDisplayDateTime(
                    mailbox.lastSuccessAt,
                    "Not completed",
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="flex justify-end border-t border-border px-4 py-3">
          <PillButton
            variant="secondary"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(20)}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more mailboxes"}
          </PillButton>
        </div>
      ) : null}
    </OperationalPanel>
  );
}
