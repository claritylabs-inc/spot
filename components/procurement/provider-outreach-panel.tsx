"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { toast } from "sonner";

import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "@/convex/lib/brokerProfileValidation";
import {
  buildOutreachSchedule,
  MAX_LAUNCH_PROVIDERS,
  MAX_OUTREACH_FOLLOW_UPS,
  OUTREACH_INTERVAL_OPTIONS,
  type OutreachCadence,
} from "@/convex/lib/providerOutreachSchedule";
import type {
  ProviderCandidateView,
  SequenceView,
} from "@/convex/providerOutreach";
import { formatDisplayDate } from "@/lib/date-format";
import {
  coverageOption,
  type CoverageId,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@claritylabs-inc/ui/components/tabs";

type CadenceField = keyof OutreachCadence;
type CadenceSource = "jev" | "default" | "operator";
type CandidateTab = "matched" | "unknown" | "excluded";

const STYLE_LABELS: Record<OutreachCadence["style"], string> = {
  brief_nudge: "Brief nudge",
  concise_recap: "Concise recap",
  detailed_recap: "Detailed recap",
};

const BANNER_COPY: Record<string, string> = {
  geography_undeterminable:
    "Request locations could not be determined, so geography is not used to match providers.",
  lines_undeterminable:
    "Requested coverages could not be determined, so coverage lines are not used to match providers.",
  lines_partly_unevaluated:
    "Other or unknown coverage types cannot be matched to provider lines and are ignored.",
};

const REASON_COPY: Record<string, string> = {
  blacklisted: "Blacklisted provider",
  inactive: "Inactive provider",
  no_profile: "No appetite profile yet",
  request_not_evaluable: "Request details are too thin to match",
  geography_primary_not_serviced: "Does not write the primary location",
  geography_none_serviced: "Does not write any requested location",
  geography_partial: "Writes only some requested locations",
  geography_appetite_empty: "No service area on file",
  geography_region_unknown: "State or province needed",
  lines_none_covered: "Covers none of the requested lines",
  lines_partial: "Covers only some requested lines",
  lines_appetite_empty: "No coverage lines on file",
};

const SKIP_COPY: Record<string, string> = {
  excluded: "Does not fit this request",
  unknown_fit_requires_explicit_selection: "Fit is unknown",
  sequence_exists: "Already has outreach in progress",
  outreach_status_progressed: "Already past the outreach stage",
  no_contact_email: "No contact email on file",
  spot_owned_contact: "Contact is a Spot address",
  provider_not_found: "Provider not found",
  duplicate_selection: "Selected twice",
};

const humanize = (code: string) => code.replaceAll("_", " ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function placeLabel(place: { country: string; region?: string }) {
  if (place.region)
    return (
      (USPS_STATE_NAMES as Record<string, string>)[place.region] ??
      (CANADIAN_PROVINCES as Record<string, string>)[place.region] ??
      place.region
    );
  return countryNames.of(place.country) ?? place.country;
}

const lineLabel = (coverage: CoverageId) => coverageOption(coverage).label;

/** A live or handed-off sequence outranks a newer finished one. */
export function sequenceForOutreach(
  sequences: SequenceView[] | undefined,
  outreachId: Id<"procurementBrokerOutreaches">,
) {
  const rank = (status: SequenceView["status"]) =>
    status === "active" || status === "reply_check"
      ? 2
      : status === "responded"
        ? 1
        : 0;
  return (
    sequences
      ?.filter((sequence) => sequence.outreachId === outreachId)
      .sort(
        (a, b) => rank(b.status) - rank(a.status) || b.createdAt - a.createdAt,
      )[0] ?? null
  );
}

export function isLiveSequence(sequence: Pick<SequenceView, "status">) {
  return sequence.status === "active" || sequence.status === "reply_check";
}

function launchSummary(
  skipped: { brokerName: string | null; reason: string }[],
) {
  const shown = skipped
    .slice(0, 5)
    .map(
      (row) =>
        `${row.brokerName ?? "A provider"}: ${SKIP_COPY[row.reason] ?? humanize(row.reason)}`,
    );
  return skipped.length > shown.length
    ? [...shown, `and ${skipped.length - shown.length} more`].join("; ")
    : shown.join("; ");
}

/**
 * Panel data, the cadence the operator is composing, and the launch/stop
 * actions. The workspace owns one instance so the panel, the header action and
 * the contacted table stay in step.
 */
export function useProviderOutreach(
  requestId: Id<"procurementRequests">,
  readOnly: boolean,
) {
  const panel = useQuery(
    api.providerOutreach.getPanel,
    readOnly ? "skip" : { requestId },
  );
  const launch = useMutation(api.providerOutreach.launch);
  const stop = useMutation(api.providerOutreach.stop);
  const requestSuggestion = useMutation(
    api.providerOutreach.requestCadenceSuggestion,
  );
  const [overrides, setOverrides] = useState<{
    requestId: Id<"procurementRequests">;
    values: Partial<OutreachCadence>;
  }>({ requestId, values: {} });
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [sendingAll, setSendingAll] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const busyRef = useRef(false);
  const suggestedFor = useRef<string | null>(null);

  const edited = overrides.requestId === requestId ? overrides.values : {};

  // The suggestion is keyed server-side by a fingerprint of the request's
  // coverages, effective date and geography, which the panel does not expose.
  // Rebuild a stable key from those same facts: each distinct set is asked for
  // once (the server never replays an unchanged fingerprint), so a changed
  // request is picked up even after a failed attempt, and nothing loops.
  const cadenceState = panel?.cadence;
  const canLaunch = panel?.request.canLaunch ?? false;
  const cadenceCurrent = cadenceState?.current ?? false;
  const factsKey = panel
    ? JSON.stringify([
        panel.needs.lines.map((line) => line.coverage).sort(),
        [...panel.needs.unevaluated].sort(),
        panel.request.targetEffectiveDate,
        panel.geography.places
          .map((place) => `${place.country}:${place.region ?? ""}`)
          .sort(),
      ])
    : null;
  useEffect(() => {
    if (!factsKey || !canLaunch || cadenceCurrent) return;
    const key = `${requestId}:${factsKey}`;
    if (suggestedFor.current === key) return;
    suggestedFor.current = key;
    void requestSuggestion({ requestId }).catch(() => {
      // Defaults apply; the suggestion is optional.
    });
  }, [factsKey, canLaunch, cadenceCurrent, requestId, requestSuggestion]);

  const picks =
    cadenceState?.current && cadenceState.status === "ready"
      ? cadenceState.picks
      : null;
  const resolve = <K extends CadenceField>(field: K) => {
    const operator = edited[field];
    if (operator !== undefined)
      return {
        value: operator as OutreachCadence[K],
        source: "operator" as CadenceSource,
      };
    const pick = picks?.[field];
    if (pick?.source === "jev")
      return {
        value: pick.value as OutreachCadence[K],
        source: "jev" as CadenceSource,
      };
    return {
      value: panel?.defaultCadence[field] as OutreachCadence[K],
      source: "default" as CadenceSource,
    };
  };
  const fields = {
    followUpCount: resolve("followUpCount"),
    intervalBusinessDays: resolve("intervalBusinessDays"),
    style: resolve("style"),
  };
  const cadence: OutreachCadence | null = panel
    ? {
        followUpCount: fields.followUpCount.value,
        intervalBusinessDays: fields.intervalBusinessDays.value,
        style: fields.style.value,
      }
    : null;
  const cadenceSource = {
    followUpCount: fields.followUpCount.source,
    intervalBusinessDays: fields.intervalBusinessDays.source,
    style: fields.style.source,
  };

  const setCadenceField = <K extends CadenceField>(
    field: K,
    value: OutreachCadence[K],
  ) =>
    setOverrides((current) => ({
      requestId,
      values: {
        ...(current.requestId === requestId ? current.values : {}),
        [field]: value,
      },
    }));

  const eligible = (panel?.candidates.matched ?? []).filter(
    (candidate) => !candidate.launchBlock && candidate.recipient,
  );
  const sendAllCount = Math.min(eligible.length, MAX_LAUNCH_PROVIDERS);

  async function run(
    brokerOrgIds: Id<"organizations">[],
    matchedOnly: boolean,
  ) {
    if (!cadence || !panel?.request.canLaunch || busyRef.current) return;
    busyRef.current = true;
    setSending(new Set(brokerOrgIds));
    setSendingAll(matchedOnly);
    try {
      const result = await launch({
        requestId,
        brokerOrgIds,
        cadence,
        cadenceSource,
        matchedOnly,
      });
      const launched = result.launched.length;
      const skipped = result.skipped.length;
      if (launched) {
        toast.success(
          `Outreach started for ${launched} provider${launched === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}`,
          {
            description: skipped ? launchSummary(result.skipped) : undefined,
          },
        );
      } else {
        toast.error(`No outreach started · ${skipped} skipped`, {
          description: launchSummary(result.skipped) || undefined,
        });
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not send provider outreach"),
      );
    } finally {
      busyRef.current = false;
      setSending(new Set());
      setSendingAll(false);
    }
  }

  async function stopSequence(sequenceId: Id<"procurementOutreachSequences">) {
    setStopping(sequenceId);
    try {
      const result = await stop({ sequenceId });
      toast.success(
        result.stopped ? "Outreach stopped" : "Outreach was already finished",
      );
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not stop outreach"));
    } finally {
      setStopping(null);
    }
  }

  return {
    panel,
    cadence,
    fields,
    setCadenceField,
    sending,
    sendingAll,
    sendAllCount,
    send: (brokerOrgId: Id<"organizations">) => run([brokerOrgId], false),
    sendAll: () =>
      run(
        eligible.slice(0, MAX_LAUNCH_PROVIDERS).map((row) => row.brokerOrgId),
        true,
      ),
    stopping,
    stopSequence,
  };
}
export type ProviderOutreachController = ReturnType<typeof useProviderOutreach>;

function SourceTag({ source }: { source: CadenceSource }) {
  if (source === "jev") return <Badge variant="secondary">Suggested</Badge>;
  if (source === "operator") return <Badge variant="outline">Edited</Badge>;
  return (
    <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
      default
    </span>
  );
}

function schedulePreview(
  cadence: OutreachCadence,
  effectiveDate: string | null,
) {
  const schedule = buildOutreachSchedule({
    launchAt: dayjs().valueOf(),
    cadence,
    limits: { effectiveDate },
  });
  const steps = schedule.steps.map((step, position) => {
    const label = position === 0 ? "Now" : dayjs(step.dueAt).format("MMM D");
    return step.isFinal && schedule.steps.length > 1
      ? `${label} (final)`
      : label;
  });
  return { text: steps.join(" · "), dropped: schedule.droppedFollowUps };
}

function CadenceCard({
  controller,
}: {
  controller: ProviderOutreachController;
}) {
  const { panel, cadence, fields, setCadenceField } = controller;
  if (!panel || !cadence) return null;
  const disabled = !panel.request.canLaunch;
  const preview = schedulePreview(cadence, panel.request.targetEffectiveDate);
  const intervals = Array.from(
    new Set<number>([
      ...OUTREACH_INTERVAL_OPTIONS,
      cadence.intervalBusinessDays,
    ]),
  ).sort((a, b) => a - b);
  const label = (text: string, source: CadenceSource) => (
    <span className="flex flex-wrap items-center gap-2">
      {text}
      <SourceTag source={source} />
    </span>
  );
  return (
    <section className="space-y-2" aria-label="Follow-up cadence">
      <InlineFieldCard
        title="Follow-up cadence"
        actions={
          panel.cadence?.status === "pending" && !panel.cadence.picks ? (
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Suggesting…
            </span>
          ) : undefined
        }
      >
        <InlineFieldRow
          label={label("Follow-ups", fields.followUpCount.source)}
        >
          <Select
            value={String(cadence.followUpCount)}
            disabled={disabled}
            onValueChange={(value) =>
              setCadenceField("followUpCount", Number(value))
            }
          >
            <SelectTrigger aria-label="Follow-ups" className="w-full">
              <SelectValue>
                {cadence.followUpCount === 0
                  ? "None"
                  : `${cadence.followUpCount} follow-up${cadence.followUpCount === 1 ? "" : "s"}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Array.from(
                { length: MAX_OUTREACH_FOLLOW_UPS + 1 },
                (_, count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count === 0
                      ? "None"
                      : `${count} follow-up${count === 1 ? "" : "s"}`}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </InlineFieldRow>
        <InlineFieldRow
          label={label("Every", fields.intervalBusinessDays.source)}
        >
          <Select
            value={String(cadence.intervalBusinessDays)}
            disabled={disabled}
            onValueChange={(value) =>
              setCadenceField("intervalBusinessDays", Number(value))
            }
          >
            <SelectTrigger
              aria-label="Business days between follow-ups"
              className="w-full"
            >
              <SelectValue>
                {cadence.intervalBusinessDays} business days
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {intervals.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} business days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InlineFieldRow>
        <InlineFieldRow label={label("Style", fields.style.source)}>
          <Select
            value={cadence.style}
            disabled={disabled}
            onValueChange={(value) =>
              setCadenceField("style", value as OutreachCadence["style"])
            }
          >
            <SelectTrigger aria-label="Follow-up style" className="w-full">
              <SelectValue>{STYLE_LABELS[cadence.style]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STYLE_LABELS) as OutreachCadence["style"][]).map(
                (style) => (
                  <SelectItem key={style} value={style}>
                    {STYLE_LABELS[style]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </InlineFieldRow>
        <InlineFieldRow label="Schedule">
          <p className={`px-3 py-1.5 ${typeStyle("body.default")}`}>
            {preview.text}
            {preview.dropped
              ? ` · ${preview.dropped} follow-up${preview.dropped === 1 ? "" : "s"} dropped before the target date`
              : ""}
          </p>
        </InlineFieldRow>
      </InlineFieldCard>
    </section>
  );
}

function FitChips({ candidate }: { candidate: ProviderCandidateView }) {
  const chips = [
    ...candidate.lines.covered.map((line) => ({
      key: `c-${line}`,
      text: lineLabel(line),
      ok: true,
    })),
    ...candidate.lines.missing.map((line) => ({
      key: `m-${line}`,
      text: `No ${lineLabel(line)}`,
      ok: false,
    })),
    ...candidate.geography.serviced.map((place) => ({
      key: `s-${place.country}-${place.region ?? ""}`,
      text: placeLabel(place),
      ok: true,
    })),
    ...candidate.geography.unserviced.map((place) => ({
      key: `u-${place.country}-${place.region ?? ""}`,
      text: `Not ${placeLabel(place)}`,
      ok: false,
    })),
  ];
  if (!chips.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <Badge key={chip.key} variant={chip.ok ? "secondary" : "destructive"}>
          {chip.text}
        </Badge>
      ))}
    </div>
  );
}

function CandidateRow({
  candidate,
  tab,
  sequence,
  sendingId,
  canLaunch,
  onSend,
}: {
  candidate: ProviderCandidateView;
  tab: CandidateTab;
  sequence: SequenceView | null;
  sendingId: boolean;
  canLaunch: boolean;
  onSend: () => void;
}) {
  const reasons = candidate.reasons
    .map((reason) => REASON_COPY[reason] ?? humanize(reason))
    .join(" · ");
  const recipient = candidate.recipient
    ? [candidate.recipient.name, candidate.recipient.email]
        .filter(Boolean)
        .join(" · ")
    : null;
  const blocked = candidate.launchBlock;
  const status = sequence
    ? sequenceStatusText(sequence)
    : candidate.outreach
      ? "Already on this request"
      : null;
  return (
    <OperationalItem className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p
          className={`flex flex-wrap items-center gap-2 text-foreground ${typeStyle("body.medium")}`}
        >
          {candidate.name}
          {candidate.partial ? (
            <Badge variant="outline">Partial fit</Badge>
          ) : null}
        </p>
        {tab !== "excluded" && recipient ? (
          <p
            className={`mt-0.5 break-words text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {recipient}
          </p>
        ) : null}
        {tab !== "excluded" && !recipient && candidate.skipReason ? (
          <p
            className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {SKIP_COPY[candidate.skipReason] ?? humanize(candidate.skipReason)}
          </p>
        ) : null}
        {reasons && (tab !== "matched" || candidate.partial) ? (
          <p
            className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {reasons}
          </p>
        ) : null}
        {tab !== "excluded" ? <FitChips candidate={candidate} /> : null}
      </div>
      {tab === "excluded" ? null : (
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0 sm:justify-end">
          {status ? (
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {status}
            </span>
          ) : null}
          {blocked === "sequence_exists" ||
          blocked === "outreach_status_progressed" ? null : (
            <PillButton
              type="button"
              size="default"
              variant={tab === "matched" ? "primary" : "secondary"}
              disabled={!!blocked || !canLaunch || sendingId}
              onClick={onSend}
            >
              {sendingId ? "Sending…" : "Send"}
            </PillButton>
          )}
        </div>
      )}
    </OperationalItem>
  );
}

export function sequenceStatusText(sequence: SequenceView) {
  switch (sequence.status) {
    case "active":
      return sequence.nextDueAt
        ? `Active · next ${formatDisplayDate(sequence.nextDueAt, "soon")}`
        : "Active";
    case "reply_check":
      return "Checking reply";
    case "responded":
      return "Replied · manual";
    case "completed":
      return "Finished";
    case "failed":
      return `Failed${sequence.stopReason ? `: ${humanize(sequence.stopReason)}` : ""}`;
    case "stopped":
      return `Stopped${sequence.stopReason ? ` · ${humanize(sequence.stopReason)}` : ""}`;
  }
}

/** Sequence column cell for the contacted table. */
export function OutreachSequenceCell({
  sequence,
  stopping,
  readOnly,
  onStop,
  onOpenThread,
}: {
  sequence: SequenceView | null;
  stopping: boolean;
  readOnly: boolean;
  onStop: (sequenceId: Id<"procurementOutreachSequences">) => void;
  onOpenThread: (threadId: Id<"procurementEmailThreads">) => void;
}) {
  if (!sequence) return <span className="text-muted-foreground">—</span>;
  // Captured steps were never delivered; a recorded sentAt survives a later cancel.
  const captured = sequence.steps.filter(
    (step) => step.status === "captured",
  ).length;
  const sent = sequence.steps.filter(
    (step) =>
      step.status === "sent" ||
      (step.status !== "captured" && step.sentAt !== null),
  ).length;
  return (
    <div className="flex min-w-40 flex-wrap items-center gap-x-3 gap-y-1">
      <div>
        <p className={typeStyle("body.default")}>
          {sequenceStatusText(sequence)}
        </p>
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {[
            `${sent} sent`,
            captured ? `${captured} captured` : "",
            `${sequence.steps.length} total`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {isLiveSequence(sequence) && !readOnly ? (
        <PillButton
          type="button"
          size="xs"
          variant="secondary"
          disabled={stopping}
          onClick={(event) => {
            event.stopPropagation();
            onStop(sequence.sequenceId);
          }}
        >
          {stopping ? "Stopping…" : "Stop"}
        </PillButton>
      ) : null}
      {sequence.procurementEmailThreadId ? (
        <PillButton
          type="button"
          size="xs"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onOpenThread(sequence.procurementEmailThreadId!);
          }}
        >
          View thread
        </PillButton>
      ) : null}
    </div>
  );
}

export function ProviderOutreachPanel({
  controller,
}: {
  controller: ProviderOutreachController;
}) {
  const { panel, sending, send } = controller;
  const [selected, setSelected] = useState<CandidateTab>("matched");
  if (!panel) return null;
  const tabs: { value: CandidateTab; label: string }[] = [
    { value: "matched", label: "Matched" },
    { value: "unknown", label: "Unknown fit" },
    { value: "excluded", label: "Excluded" },
  ];
  // Matched always shows; the secondary tabs only exist when they have rows.
  const visible = tabs.filter(
    (tab) => tab.value === "matched" || panel.candidates[tab.value].length,
  );
  const tab = visible.some((item) => item.value === selected)
    ? selected
    : "matched";
  const rows: ProviderCandidateView[] = panel.candidates[tab];
  return (
    <div className="space-y-4">
      {panel.request.closedReason ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This request is{" "}
          {humanize(panel.request.closedReason).replace("request ", "")}, so
          outreach cannot be sent.
        </p>
      ) : null}
      {panel.banners.map((banner) => (
        <p
          key={banner}
          role="status"
          className={`rounded-lg border border-border px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}
        >
          {BANNER_COPY[banner] ?? humanize(banner)}
        </p>
      ))}
      <CadenceCard controller={controller} />
      <div className="sm:hidden">
        <PillButton
          type="button"
          disabled={!panel.request.canLaunch || !controller.sendAllCount || sending.size > 0}
          onClick={() => void controller.sendAll()}
        >
          {sending.size > 0 ? "Starting…" : `Send to all matched (${controller.sendAllCount})`}
        </PillButton>
      </div>
      <OperationalPanel as="section">
        <OperationalPanelHeader
          className="flex-col sm:flex-row"
          title="Providers"
          description={`Fit for ${panel.needs.lines.map((line) => line.label).join(", ") || "this request"}${panel.geography.places.length ? ` in ${panel.geography.places.map(placeLabel).join(", ")}` : ""}.`}
          action={
            visible.length > 1 ? (
              <Tabs
                value={tab}
                onValueChange={(value) => setSelected(value as CandidateTab)}
              >
                <TabsList variant="pill" aria-label="Provider fit">
                  {visible.map((item) => (
                    <TabsTrigger key={item.value} value={item.value}>
                      {item.label} · {panel.candidates[item.value].length}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : undefined
          }
        />
        {rows.length ? (
          rows.map((candidate) => (
            <CandidateRow
              key={candidate.brokerOrgId}
              candidate={candidate}
              tab={tab}
              sequence={
                candidate.sequenceId
                  ? (panel.sequences.find(
                      (row) => row.sequenceId === candidate.sequenceId,
                    ) ?? null)
                  : null
              }
              sendingId={sending.has(candidate.brokerOrgId)}
              canLaunch={panel.request.canLaunch && sending.size === 0}
              onSend={() => void send(candidate.brokerOrgId)}
            />
          ))
        ) : (
          <OperationalItem
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            No matched providers yet.
          </OperationalItem>
        )}
        {panel.providersBounded ? (
          <OperationalItem
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Showing the first{" "}
            {panel.candidates.matched.length +
              panel.candidates.unknown.length +
              panel.candidates.excluded.length}{" "}
            providers.
          </OperationalItem>
        ) : null}
      </OperationalPanel>
    </div>
  );
}
