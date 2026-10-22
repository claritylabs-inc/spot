"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { toast } from "sonner";

import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableNameLink,
} from "@/components/ui/table";
import { PillButton } from "@/components/ui/pill-button";
import { OutreachStatusTag } from "./procurement-shared";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import {
  coverageOption,
  type CoverageId,
} from "@/lib/insurance-intake-details";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";

type CadenceField = keyof OutreachCadence;
type CadenceSource = "jev" | "default" | "operator";

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

function candidateRecipient(
  candidate: ProviderCandidateView,
  contactId?: Id<"brokerContacts">,
) {
  return contactId
    ? (candidate.contactOptions.find(
        (contact) => contact.contactId === contactId,
      ) ?? null)
    : candidate.recipient;
}

function candidateLaunchBlock(
  candidate: ProviderCandidateView,
  contactId?: Id<"brokerContacts">,
) {
  if (!contactId) return candidate.launchBlock;
  if (!candidateRecipient(candidate, contactId)) return "no_contact_email";
  return candidate.launchBlock === "no_contact_email" ||
    candidate.launchBlock === "spot_owned_contact"
    ? null
    : candidate.launchBlock;
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
  const requestSuggestion = useMutation(
    api.providerOutreach.requestCadenceSuggestion,
  );
  const [overrides, setOverrides] = useState<{
    requestId: Id<"procurementRequests">;
    values: Partial<OutreachCadence>;
  }>({ requestId, values: {} });
  const [contactSelection, setContactSelection] = useState<{
    requestId: Id<"procurementRequests">;
    choices: Record<string, Id<"brokerContacts">>;
  }>({ requestId, choices: {} });
  const selectedContacts =
    contactSelection.requestId === requestId ? contactSelection.choices : {};
  const selectContact = (
    brokerOrgId: Id<"organizations">,
    contactId: Id<"brokerContacts"> | null,
  ) =>
    setContactSelection((current) => {
      const choices = {
        ...(current.requestId === requestId ? current.choices : {}),
      };
      if (contactId) choices[brokerOrgId] = contactId;
      else delete choices[brokerOrgId];
      return { requestId, choices };
    });
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [sendingAll, setSendingAll] = useState(false);
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
    (candidate) =>
      !candidateLaunchBlock(
        candidate,
        selectedContacts[candidate.brokerOrgId],
      ) &&
      candidateRecipient(candidate, selectedContacts[candidate.brokerOrgId]),
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
        selectedContacts: brokerOrgIds.flatMap((brokerOrgId) =>
          selectedContacts[brokerOrgId]
            ? [{ brokerOrgId, contactId: selectedContacts[brokerOrgId] }]
            : [],
        ),
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

  return {
    panel,
    cadence,
    fields,
    setCadenceField,
    sending,
    sendingAll,
    selectedContacts,
    selectContact,
    sendAllCount,
    send: (brokerOrgId: Id<"organizations">) => run([brokerOrgId], false),
    sendAll: () =>
      run(
        eligible.slice(0, MAX_LAUNCH_PROVIDERS).map((row) => row.brokerOrgId),
        true,
      ),
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

export function ProviderOutreachCadence({
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

export function FitChips({ candidate }: { candidate: ProviderCandidateView }) {
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
  ];
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
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
  selectedContactId,
  onSelectContact,
  sendingId,
  canLaunch,
  onSend,
}: {
  candidate: ProviderCandidateView;
  selectedContactId?: Id<"brokerContacts">;
  onSelectContact: (contactId: Id<"brokerContacts"> | null) => void;
  sendingId: boolean;
  canLaunch: boolean;
  onSend: () => void;
}) {
  const recipient = candidateRecipient(candidate, selectedContactId);
  const blocked = candidateLaunchBlock(candidate, selectedContactId);
  const contactLocked =
    !canLaunch ||
    sendingId ||
    blocked === "sequence_exists" ||
    blocked === "outreach_status_progressed";
  const options = candidate.contactOptions;
  const contactValue =
    selectedContactId ?? candidate.recipient?.contactId ?? "request";
  const explicitRecipient =
    candidate.recipient && !candidate.recipient.contactId;
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="flex items-center gap-3">
          <OrgBrandIcon
            name={candidate.name}
            iconUrl={candidate.iconUrl}
            website={candidate.website}
            size="md"
          />
          <div className="min-w-0">
            <TableNameLink href={`/operator/brokers/${candidate.brokerOrgId}`}>
              {candidate.name}
            </TableNameLink>
          </div>
        </div>
      </TableCell>
      <TableCell className="min-w-64 whitespace-normal">
        {options.length > 0 || explicitRecipient ? (
          <div>
            <Select
              value={contactValue}
              disabled={contactLocked}
              onValueChange={(value) => {
                if (value)
                  onSelectContact(
                    value === "request"
                      ? null
                      : (value as Id<"brokerContacts">),
                  );
              }}
            >
              <SelectTrigger aria-label={`Contact for ${candidate.name}`}>
                <SelectValue>
                  {recipient?.email ?? "Select contact"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
                {explicitRecipient ? (
                  <SelectItem
                    value="request"
                    label={candidate.recipient!.email}
                  >
                    <span className="flex min-w-0 flex-col whitespace-normal">
                      <span>
                        {candidate.recipient!.name ?? "Request contact"}
                      </span>
                      <span
                        className={`break-all text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {candidate.recipient!.email} · Current request contact
                      </span>
                    </span>
                  </SelectItem>
                ) : null}
                {options.map((contact) => (
                  <SelectItem
                    key={contact.contactId}
                    value={contact.contactId}
                    label={`${contact.name} ${contact.email}`}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal py-1">
                      <span>{contact.name}</span>
                      <span
                        className={`break-all text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {contact.email}
                      </span>
                      {contact.lineOfBusinessCodes.length ? (
                        <span
                          className={`text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Best for {contact.lineOfBusinessCodes.join(", ")}
                        </span>
                      ) : null}
                      {contact.context ? (
                        <span
                          className={`line-clamp-2 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {contact.context}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recipient?.name ? (
              <p
                className={`px-3 text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {recipient.name}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">
            {SKIP_COPY[candidate.skipReason ?? "no_contact_email"] ??
              humanize(candidate.skipReason ?? "no_contact_email")}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <FitChips candidate={candidate} />
      </TableCell>
      <TableCell>
        {candidate.outreach ? (
          <OutreachStatusTag status={candidate.outreach.status} />
        ) : (
          <span className="text-muted-foreground">Not contacted</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0 sm:justify-end">
          {blocked === "sequence_exists" ||
          blocked === "outreach_status_progressed" ? null : (
            <PillButton
              type="button"
              size="default"
              variant="primary"
              disabled={!!blocked || !canLaunch || sendingId}
              onClick={onSend}
            >
              {sendingId ? "Sending…" : "Send"}
            </PillButton>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Controls for an existing outreach sequence. */
export function OutreachSequenceActions({
  sequence,
  onOpenThread,
}: {
  sequence: SequenceView | null;
  onOpenThread: (threadId: Id<"procurementEmailThreads">) => void;
}) {
  if (!sequence) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
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
  submittedProviders = [],
  readOnly = false,
}: {
  controller: ProviderOutreachController;
  submittedProviders?: {
    key: string;
    brokerOrgId?: Id<"organizations">;
    row: ReactNode;
  }[];
  readOnly?: boolean;
}) {
  const { panel, sending, send, selectedContacts, selectContact } = controller;
  if (!panel && !readOnly) return null;
  const submittedIds = new Set(
    submittedProviders.map((row) => row.brokerOrgId),
  );
  const rows = (panel?.candidates.matched ?? []).filter(
    (candidate) => !submittedIds.has(candidate.brokerOrgId),
  );
  return (
    <div className="space-y-4">
      {panel?.request.closedReason ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This request is{" "}
          {humanize(panel.request.closedReason).replace("request ", "")}, so
          outreach cannot be sent.
        </p>
      ) : null}
      {panel?.banners.map((banner) => (
        <p
          key={banner}
          role="status"
          className={`rounded-lg border border-border px-4 py-3 text-muted-foreground ${typeStyle("body.default")}`}
        >
          {BANNER_COPY[banner] ?? humanize(banner)}
        </p>
      ))}
      {!readOnly && panel ? (
        <div className="sm:hidden">
          <PillButton
            type="button"
            disabled={
              !panel.request.canLaunch ||
              !controller.sendAllCount ||
              sending.size > 0
            }
            onClick={() => void controller.sendAll()}
          >
            {sending.size > 0
              ? "Starting…"
              : `Send to all matched (${controller.sendAllCount})`}
          </PillButton>
        </div>
      ) : null}
      <section aria-label="Providers" className="space-y-3">
        <OperationalPanel as="div" data-operator-inline-fields>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submittedProviders.map((provider) => provider.row)}
              {rows.length ? (
                rows.map((candidate) => (
                  <CandidateRow
                    key={candidate.brokerOrgId}
                    candidate={candidate}
                    selectedContactId={selectedContacts[candidate.brokerOrgId]}
                    onSelectContact={(contactId) =>
                      selectContact(candidate.brokerOrgId, contactId)
                    }
                    sendingId={sending.has(candidate.brokerOrgId)}
                    canLaunch={!!panel?.request.canLaunch && sending.size === 0}
                    onSend={() => void send(candidate.brokerOrgId)}
                  />
                ))
              ) : !submittedProviders.length ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No providers match the recorded coverage and service area.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </OperationalPanel>
        {panel?.providersBounded ? (
          <p
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Matching is limited to the first{" "}
            {panel.candidates.matched.length +
              panel.candidates.unknown.length +
              panel.candidates.excluded.length}{" "}
            providers in the directory.
          </p>
        ) : null}
      </section>
    </div>
  );
}
