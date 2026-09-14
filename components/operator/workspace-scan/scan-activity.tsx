"use client";

import { ScanQueryBoundary } from "./scan-query-boundary";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { GoogleWorkspaceScanActivityFilter } from "@/convex/lib/googleWorkspaceScan";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import type { Id } from "@/convex/_generated/dataModel";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDateTime } from "@/lib/date-format";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

const STATUS_LABELS = {
  updated: "Updated",
  needs_attention: "Needs attention",
  failed: "Failed",
} as const;
const ACTION_LABELS = {
  resolve: "Resolve match",
  dismiss: "Dismiss",
  retry: "Retry",
  correct: "Restore prior values",
} as const;
type ActivityAction = keyof typeof ACTION_LABELS;

type ActivityListProps = {
  entityId?: string;
  onRightPanel: (panel: ReactNode) => void;
};
export function WorkspaceScanActivity(props: ActivityListProps) {
  return (
    <ScanQueryBoundary key={props.entityId ?? "all"}>
      <ActivityList {...props} />
    </ScanQueryBoundary>
  );
}

function ActivityList({ entityId, onRightPanel }: ActivityListProps) {
  const [filter, setFilter] = useState<
    GoogleWorkspaceScanActivityFilter | undefined
  >(undefined);
  const { results, status, loadMore } = usePaginatedQuery(
    api.operatorGoogleWorkspaceScanActivity.listActivity,
    { status: filter, entityId },
    { initialNumItems: 20 },
  );

  function openActivity(id: string) {
    onRightPanel(
      <WorkspaceScanActivityDrawer
        key={id}
        activityId={id}
        onClose={() => onRightPanel(null)}
      />,
    );
  }

  return (
    <section className="space-y-3" aria-label="Email scan activity">
      <div className="overflow-x-auto">
        <Tabs
          value={filter ?? "all"}
          onValueChange={(value) => {
            if (value === "all") setFilter(undefined);
            else if (
              value === "updated" ||
              value === "needs_attention" ||
              value === "failed"
            )
              setFilter(value);
          }}
        >
          <TabsList variant="pill" aria-label="Filter email scan activity">
            <TabsTrigger value="all">All activity</TabsTrigger>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <OperationalPanel>
        {entityId ? (
          <OperationalPanelHeader title="Email scan activity" />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Change</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Observed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status === "LoadingFirstPage" ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <span role="status" className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading activity…
                  </span>
                </TableCell>
              </TableRow>
            ) : results.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="whitespace-normal text-muted-foreground"
                >
                  {filter
                    ? `No ${STATUS_LABELS[filter].toLowerCase()} activity.`
                    : "No email scan activity yet."}
                </TableCell>
              </TableRow>
            ) : (
              results.map((activity) => (
                <TableRow
                  key={activity.id}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-ring"
                  aria-label={`Open ${activity.title}`}
                  onClick={() => openActivity(activity.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openActivity(activity.id);
                    }
                  }}
                >
                  <TableCell className="min-w-48 whitespace-normal">
                    {activity.title}
                  </TableCell>
                  <TableCell>
                    <StatusTag
                      tone={
                        activity.status === "failed"
                          ? "danger"
                          : activity.status === "needs_attention"
                            ? "warning"
                            : "success"
                      }
                    >
                      {STATUS_LABELS[activity.status]}
                    </StatusTag>
                  </TableCell>
                  <TableCell>
                    {formatDisplayDateTime(activity.createdAt)}
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
              {status === "LoadingMore" ? "Loading…" : "Load more"}
            </PillButton>
          </div>
        ) : null}
      </OperationalPanel>
    </section>
  );
}

type ActivityDrawerProps = { activityId: string; onClose: () => void };
export function WorkspaceScanActivityDrawer(props: ActivityDrawerProps) {
  return (
    <ScanQueryBoundary
      key={props.activityId}
      renderError={(content) => (
        <SettingsDrawer
          open
          title="Email scan activity"
          onOpenChange={(open) => {
            if (!open) props.onClose();
          }}
        >
          {content}
        </SettingsDrawer>
      )}
    >
      <ActivityDrawer {...props} />
    </ScanQueryBoundary>
  );
}

function ActivityDrawer({ activityId, onClose }: ActivityDrawerProps) {
  const activity = useQuery(
    api.operatorGoogleWorkspaceScanActivity.getActivity,
    { activityId },
  );
  const resolve = useMutation(
    api.operatorGoogleWorkspaceScanActivity.resolveActivity,
  );
  const dismiss = useMutation(
    api.operatorGoogleWorkspaceScanActivity.dismissActivity,
  );
  const retry = useMutation(
    api.operatorGoogleWorkspaceScanActivity.retryActivity,
  );
  const correct = useMutation(
    api.operatorGoogleWorkspaceScanActivity.correctActivity,
  );
  const [note, setNote] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations">>();
  const [selectedRequestId, setSelectedRequestId] =
    useState<Id<"procurementRequests">>();
  const [busy, setBusy] = useState<ActivityAction | null>(null);
  const submitting = useRef(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);

  async function act(action: ActivityAction) {
    if (submitting.current || !activity?.availableActions.includes(action))
      return;
    submitting.current = true;
    setBusy(action);
    setFeedback(null);
    try {
      const args = { activityId, note: note.trim() || undefined };
      const result =
        action === "resolve"
          ? await resolve({ ...args, selectedOrgId, selectedRequestId })
          : await { dismiss, retry, correct }[action](args);
      setFeedback({
        message: result.message,
        error: result.status === "conflict",
      });
      if (result.status !== "conflict") setNote("");
    } catch (error) {
      setFeedback({
        message: getUserFacingErrorMessage(
          error,
          "The activity could not be updated.",
        ),
        error: true,
      });
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }

  return (
    <SettingsDrawer
      open
      title={activity?.title ?? "Email scan activity"}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      contentClassName="gap-4"
      footer={
        activity?.availableActions.length
          ? activity.availableActions.map((action) => (
              <PillButton
                key={action}
                variant={action === "correct" ? "destructive" : "secondary"}
                disabled={
                  busy !== null ||
                  (action === "resolve" &&
                    !selectedOrgId &&
                    !selectedRequestId &&
                    !note.trim())
                }
                onClick={() => void act(action)}
              >
                {busy === action ? "Updating…" : ACTION_LABELS[action]}
              </PillButton>
            ))
          : undefined
      }
    >
      {activity === undefined ? (
        <p role="status">Loading activity…</p>
      ) : !activity ? (
        <p role="status">This activity is unavailable.</p>
      ) : (
        <>
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Status"
              value={STATUS_LABELS[activity.status]}
            />
            {activity.importState ? (
              <OperationalLabelValueRow
                label="Policy import"
                value={
                  {
                    queued: "Queued for extraction",
                    extracting: "Extracting",
                    complete: "Extraction completed",
                    error: "Extraction failed",
                  }[activity.importState]
                }
              />
            ) : null}
            <OperationalLabelValueRow
              label="Observed"
              value={formatDisplayDateTime(activity.createdAt)}
            />
            {activity.resolvedAt ? (
              <OperationalLabelValueRow
                label="Resolved"
                value={formatDisplayDateTime(activity.resolvedAt)}
              />
            ) : null}
          </OperationalLabelValueList>
          <p
            className={`whitespace-pre-wrap text-foreground ${typeStyle("body.default")}`}
          >
            {activity.explanation}
          </p>
          {activity.changes.map((change, index) => (
            <OperationalLabelValueList
              key={`${change.field}-${index}`}
              title={change.field}
            >
              <OperationalLabelValueRow
                label="Before"
                layout="stacked"
                value={
                  <span className="whitespace-pre-wrap">
                    {change.before ?? "Not set"}
                  </span>
                }
              />
              <OperationalLabelValueRow
                label="After"
                layout="stacked"
                value={
                  <span className="whitespace-pre-wrap">
                    {change.after ?? "Not set"}
                  </span>
                }
              />
            </OperationalLabelValueList>
          ))}
          {activity.records.length ? (
            <div className="flex flex-wrap gap-2">
              {activity.records.map((record) => (
                <PillButton
                  key={record.href}
                  href={record.href}
                  variant="secondary"
                >
                  {record.label}
                </PillButton>
              ))}
            </div>
          ) : null}
          {activity.sources.map((source) => (
            <OperationalLabelValueList
              key={`${source.sourceId}-${source.mailbox}`}
            >
              <OperationalLabelValueRow
                label="Email"
                value={source.subject ?? "No subject"}
              />
              <OperationalLabelValueRow
                label="Mailbox"
                value={source.mailbox}
              />
              <OperationalLabelValueRow
                label="Sent"
                value={formatDisplayDateTime(source.sentAt, "Unknown date")}
              />
              <OperationalLabelValueRow
                label="Source excerpt"
                layout="stacked"
                value={
                  <blockquote className="whitespace-pre-wrap">
                    {source.excerpt}
                  </blockquote>
                }
              />
              <OperationalLabelValueRow
                label="Thread"
                value={
                  <PillButton
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="secondary"
                  >
                    Open source thread
                  </PillButton>
                }
              />
            </OperationalLabelValueList>
          ))}
          {activity.availableActions.includes("correct") ? (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Restore prior values only if no later changes have replaced them.
              Created records use their normal lifecycle controls.
            </p>
          ) : null}
          {activity.availableActions.includes("resolve") &&
          activity.candidates ? (
            <div className="space-y-3">
              {activity.candidates.organizations.length ? (
                <SearchableSelect
                  ariaLabel="Match organization"
                  placeholder="Choose the exact organization"
                  value={selectedOrgId ?? ""}
                  disabled={busy !== null}
                  options={activity.candidates.organizations.map(
                    (candidate) => ({
                      value: candidate.id,
                      label: candidate.label,
                      icon: <OrgBrandIcon name={candidate.label} size="xs" />,
                    }),
                  )}
                  onChange={(id) => {
                    setSelectedOrgId(
                      activity.candidates?.organizations.find(
                        (candidate) => candidate.id === id,
                      )?.id,
                    );
                    setSelectedRequestId(undefined);
                  }}
                />
              ) : null}
              {activity.candidates.requests.length ? (
                <SearchableSelect
                  ariaLabel="Match request"
                  placeholder="Choose the exact request"
                  value={selectedRequestId ?? ""}
                  disabled={busy !== null}
                  options={activity.candidates.requests.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.label,
                  }))}
                  onChange={(id) => {
                    setSelectedRequestId(
                      activity.candidates?.requests.find(
                        (candidate) => candidate.id === id,
                      )?.id,
                    );
                    setSelectedOrgId(undefined);
                  }}
                />
              ) : null}
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Choosing a match queues another assessment. Without a match, a
                note resolves this finding without changing records.
              </p>
            </div>
          ) : null}
          {activity.availableActions.length ? (
            <label className="space-y-2">
              <span
                className={`block text-muted-foreground ${typeStyle("label.field")}`}
              >
                Resolution note
              </span>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={busy !== null}
                rows={3}
              />
            </label>
          ) : null}
        </>
      )}
      {feedback ? (
        <p
          role={feedback.error ? "alert" : "status"}
          className={`${feedback.error ? "text-destructive" : "text-foreground"} ${typeStyle("body.default")}`}
        >
          {feedback.message}
        </p>
      ) : null}
    </SettingsDrawer>
  );
}
