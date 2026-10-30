"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ChevronRight, Mail } from "lucide-react";

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
  SortableTableHead,
} from "@/components/ui/table";
import { PillButton } from "@/components/ui/pill-button";
import {
  OUTREACH_STATUS_OPTIONS,
  OutreachStatusTag,
} from "./procurement-shared";
import { FollowUpCountSelect, IntervalSelect } from "./outreach-cadence-selects";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort, type TableSortValue } from "@/hooks/use-table-sort";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  buildOutreachSchedule,
  MAX_LAUNCH_PROVIDERS,
  type OutreachCadence,
} from "@/convex/lib/providerOutreachSchedule";
import type {
  ProviderCandidateView,
  SequenceView,
} from "@/convex/providerOutreach";
import type { ProviderFitReason } from "@/convex/lib/providerOutreachMatch";
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

/** Why matching found nothing, shown in the empty table instead of standing banners. */
const MATCH_GAP_COPY: Record<string, string> = {
  geography_undeterminable: "the application has no country and state/province",
  lines_undeterminable: "its requested coverages could not be read",
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

const REASON_COPY: Record<ProviderFitReason, string> = {
  blacklisted: "Do not contact",
  test_mode: "Not a test provider (test mode)",
  no_profile: "No appetite profile",
  request_not_evaluable: "Request coverage or location unknown",
  geography_primary_not_serviced: "Doesn't serve the main location",
  geography_none_serviced: "Doesn't serve these locations",
  geography_partial: "Serves only some locations",
  geography_region_unknown: "Service area unclear",
  geography_appetite_empty: "No service area recorded",
  lines_none_covered: "Doesn't write these lines",
  lines_partial: "Writes only some lines",
  lines_appetite_empty: "No lines recorded",
};

const humanize = (code: string) => code.replaceAll("_", " ");

const STOP_COPY: Record<string, string> = {
  operator_stopped: "stopped by operator",
  operator_replied: "you replied",
  bounced: "email bounced",
  recipient_unmonitored: "inbox unmonitored",
  proposal_filed: "proposal filed",
  outreach_status_changed: "status changed",
  follow_up_window_closed: "past the target date",
  sequence_finished: "all sent",
};

/** One line of follow-up state for a provider or client sequence. */
type TagPresentation = Pick<
  ComponentProps<typeof StatusTag>,
  "tone" | "indicator"
>;

/** A status tag whose detail shows as a hover hint instead of a second line. */
function DetailStatusTag({
  label,
  details,
  ...presentation
}: TagPresentation & { label: string; details: string[] }) {
  const tag = <StatusTag {...presentation}>{label}</StatusTag>;
  if (!details.length) return tag;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`${label}: ${details.join(", ")}`}
            className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {tag}
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/** Follow-up state of a provider or client sequence as one status tag. */
export function SequenceState({ sequence }: { sequence: SequenceView }) {
  const sent = sequence.steps.filter(
    (step) => step.status === "sent" || step.status === "captured",
  ).length;
  const total = sequence.steps.filter(
    (step) => step.status !== "cancelled",
  ).length;
  const reason = sequence.stopReason
    ? (STOP_COPY[sequence.stopReason] ?? humanize(sequence.stopReason))
    : null;
  const progress = `${sent} of ${total} emails sent`;
  const tag: TagPresentation & { label: string; details: string[] } =
    sequence.status === "active" && sequence.identityHold
      ? {
          tone: "warning",
          indicator: "waiting",
          label: "Waiting for sender",
          details: [sequence.identityHold.message, progress],
        }
      : sequence.status === "active"
      ? {
          tone: "info",
          indicator: "progress",
          label: sequence.nextDueAt
            ? `Follow-up ${dayjs(sequence.nextDueAt).format("MMM D")}`
            : "Sending",
          details: [progress],
        }
      : sequence.status === "reply_check"
        ? {
            tone: "warning",
            indicator: "waiting",
            label: "Checking reply",
            details: [progress],
          }
        : sequence.status === "responded"
          ? {
              tone: "success",
              indicator: "complete",
              label: "Replied",
              details: [progress, "Follow-ups stopped"],
            }
          : sequence.status === "completed"
            ? {
                tone: "neutral",
                indicator: "complete",
                label: "Follow-ups done",
                details: [progress],
              }
            : sequence.status === "failed"
              ? {
                  tone: "danger",
                  indicator: "error",
                  label: "Delivery failed",
                  details: [progress, ...(reason ? [reason] : [])],
                }
              : {
                  tone: "neutral",
                  indicator: "inactive",
                  label: "Follow-ups stopped",
                  details: [progress, ...(reason ? [reason] : [])],
                };
  return <DetailStatusTag {...tag} />;
}

/** Fit of a provider that is not a confirmed match. */
function FitTag({ candidate }: { candidate: ProviderCandidateView }) {
  return (
    <DetailStatusTag
      tone={candidate.verdict === "excluded" ? "danger" : "warning"}
      indicator={candidate.verdict === "excluded" ? "cancelled" : "waiting"}
      label={candidate.verdict === "excluded" ? "Excluded" : "Fit unknown"}
      details={candidate.reasons.map(
        (reason) => REASON_COPY[reason] ?? humanize(reason),
      )}
    />
  );
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

export function launchSummary(
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

type PanelCadence = Pick<
  NonNullable<FunctionReturnType<typeof api.providerOutreach.getPanel>>,
  "cadence" | "defaultCadence"
>;

/** The request's saved cadence: operator choices, then confident Jev picks, then defaults. */
export function requestCadence(panel: PanelCadence) {
  const picks =
    panel.cadence?.current && panel.cadence.status === "ready" ? panel.cadence.picks : null;
  const resolve = <K extends CadenceField>(field: K) => {
    const operator = panel.cadence?.overrides?.[field];
    if (operator !== undefined && operator !== null)
      return { value: operator as OutreachCadence[K], source: "operator" as CadenceSource };
    const pick = picks?.[field];
    if (pick?.source === "jev") return { value: pick.value as OutreachCadence[K], source: "jev" as CadenceSource };
    return { value: panel.defaultCadence[field] as OutreachCadence[K], source: "default" as CadenceSource };
  };
  const followUpCount = resolve("followUpCount");
  const intervalBusinessDays = resolve("intervalBusinessDays");
  const style = resolve("style");
  return {
    cadence: {
      followUpCount: followUpCount.value,
      intervalBusinessDays: intervalBusinessDays.value,
      style: style.value,
    },
    cadenceSource: {
      followUpCount: followUpCount.source,
      intervalBusinessDays: intervalBusinessDays.source,
      style: style.source,
    },
  };
}

/** Who a Send opens the provider email composer for. */
export type ProviderComposeTarget = {
  brokerOrgIds: Id<"organizations">[];
  contacts: Record<string, Id<"brokerContacts">>;
  merge: boolean;
};

/**
 * Panel data, the cadence the operator is composing, and the compose actions.
 * The workspace owns one instance so the panel, the header action and the
 * contacted table stay in step. Send and Send to all matched open the provider
 * email composer (`onCompose`); only the composer launches.
 */
export function useProviderOutreach(
  requestId: Id<"procurementRequests">,
  readOnly: boolean,
  onCompose: (target: ProviderComposeTarget) => void,
) {
  const panel = useQuery(
    api.providerOutreach.getPanel,
    readOnly ? "skip" : { requestId },
  );
  const requestSuggestion = useMutation(
    api.providerOutreach.requestCadenceSuggestion,
  );
  const saveCadence = useMutation(api.providerOutreach.saveCadenceOverride);
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
  const suggestedFor = useRef<string | null>(null);

  // Saved operator choices, with unsaved local edits on top while a save runs.
  const edited: Partial<OutreachCadence> = {
    ...(panel?.cadence?.overrides ?? {}),
    ...(overrides.requestId === requestId ? overrides.values : {}),
  };

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
  const setCadenceField = <K extends CadenceField>(
    field: K,
    value: OutreachCadence[K],
  ) => {
    setOverrides((current) => ({
      requestId,
      values: {
        ...(current.requestId === requestId ? current.values : {}),
        [field]: value,
      },
    }));
    void saveCadence({ requestId, field, value }).catch((error) => {
      setOverrides((current) => {
        const values = { ...current.values };
        delete values[field];
        return { requestId: current.requestId, values };
      });
      toast.error(getUserFacingErrorMessage(error, "Could not save cadence"));
    });
  };

  const eligible = (panel?.candidates.matched ?? []).filter(
    (candidate) =>
      !candidateLaunchBlock(
        candidate,
        selectedContacts[candidate.brokerOrgId],
      ) &&
      candidateRecipient(candidate, selectedContacts[candidate.brokerOrgId]),
  );
  const sendAllCount = Math.min(eligible.length, MAX_LAUNCH_PROVIDERS);

  // The From and Always CC this launch will use. Without a fingerprint to
  // approve there is nothing to launch with, so the whole panel reads as blocked.
  const sender = panel?.sender ?? null;
  const senderBlock = sender
    ? (sender.problem ??
      (sender.fingerprint ? null : "Reload to review the From and CC before sending"))
    : null;

  const contactsFor = (brokerOrgIds: Id<"organizations">[]) =>
    Object.fromEntries(
      brokerOrgIds.flatMap((brokerOrgId) =>
        selectedContacts[brokerOrgId] ? [[brokerOrgId, selectedContacts[brokerOrgId]]] : [],
      ),
    );

  return {
    requestId,
    // The composer shows any From problem when it previews the email.
    panel,
    sender,
    senderBlock,
    requestCanLaunch: panel?.request.canLaunch ?? false,
    cadence,
    fields,
    setCadenceField,
    selectedContacts,
    selectContact,
    sendAllCount,
    send: (brokerOrgId: Id<"organizations">) =>
      onCompose({ brokerOrgIds: [brokerOrgId], contacts: contactsFor([brokerOrgId]), merge: false }),
    sendAll: () => {
      const brokerOrgIds = eligible.slice(0, MAX_LAUNCH_PROVIDERS).map((row) => row.brokerOrgId);
      if (brokerOrgIds.length) onCompose({ brokerOrgIds, contacts: contactsFor(brokerOrgIds), merge: true });
    },
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

export function schedulePreview(
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
  // Cadence stays editable while only the sender profile blocks launching.
  const disabled = !controller.requestCanLaunch;
  const preview = schedulePreview(cadence, panel.request.targetEffectiveDate);
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
          <FollowUpCountSelect
            value={cadence.followUpCount}
            disabled={disabled}
            onChange={(value) => setCadenceField("followUpCount", value)}
          />
        </InlineFieldRow>
        <InlineFieldRow
          label={label("Every", fields.intervalBusinessDays.source)}
        >
          <IntervalSelect
            value={cadence.intervalBusinessDays}
            disabled={disabled}
            onChange={(value) => setCadenceField("intervalBusinessDays", value)}
          />
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

/** A provider contact as a pill: the provider's logo and the contact's name, address on hover. */
export function ProviderContactPill({
  provider,
  name,
  email,
}: {
  provider: { name: string; iconUrl?: string | null; website?: string | null };
  name: string | null | undefined;
  email: string;
}) {
  return (
    <span
      title={`${name ? `${name} <${email}>` : email} · ${provider.name}`}
      className={`inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-muted p-0.5 pr-2.5 ${typeStyle("body.large")}`}
    >
      <OrgBrandIcon
        name={provider.name}
        iconUrl={provider.iconUrl ?? undefined}
        website={provider.website ?? undefined}
        size="xs"
        shape="circle"
      />
      <span className="min-w-0 truncate">{name || email}</span>
    </span>
  );
}

/** The provider contact an email goes to: current external contacts, or the request's own contact. */
export function ProviderContactSelect({
  candidate,
  selectedContactId,
  disabled,
  onSelect,
}: {
  candidate: ProviderCandidateView;
  selectedContactId?: Id<"brokerContacts">;
  disabled: boolean;
  onSelect: (contactId: Id<"brokerContacts"> | null) => void;
}) {
  const recipient = candidateRecipient(candidate, selectedContactId);
  const options = candidate.contactOptions;
  const contactValue =
    selectedContactId ?? candidate.recipient?.contactId ?? "request";
  const explicitRecipient =
    candidate.recipient && !candidate.recipient.contactId;
  if (!options.length && !explicitRecipient)
    return (
      <span className="text-muted-foreground">
        {SKIP_COPY[candidate.skipReason ?? "no_contact_email"] ??
          humanize(candidate.skipReason ?? "no_contact_email")}
      </span>
    );
  return (
    <div className="min-w-0">
      <Select
        value={contactValue}
        disabled={disabled}
        onValueChange={(value) => {
          if (value)
            onSelect(
              value === "request" ? null : (value as Id<"brokerContacts">),
            );
        }}
      >
        <SelectTrigger
          aria-label={`Contact for ${candidate.name}`}
          title={recipient ? `${recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email} · ${candidate.name}` : undefined}
          // The contact's pill is the button: provider logo, name, chevron.
          className={`w-auto max-w-full min-w-0 gap-1 rounded-full border-0 bg-muted p-0.5 pr-2 hover:border-0 focus-visible:ring-2 focus-visible:ring-ring data-[size=default]:h-auto [&>svg]:size-3 ${typeStyle("label.tag")}`}
          data-compact-tag-select
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1">
              <OrgBrandIcon
                name={candidate.name}
                iconUrl={candidate.iconUrl ?? undefined}
                website={candidate.website ?? undefined}
                size="xs"
                shape="circle"
              />
              <span className="min-w-0 truncate">
                {recipient ? (recipient.name ?? recipient.email) : "Select contact"}
              </span>
            </span>
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
    </div>
  );
}

function CandidateRow({
  candidate,
  selectedContactId,
  onSelectContact,
  canLaunch,
  onSend,
}: {
  candidate: ProviderCandidateView;
  selectedContactId?: Id<"brokerContacts">;
  onSelectContact: (contactId: Id<"brokerContacts"> | null) => void;
  canLaunch: boolean;
  onSend: () => void;
}) {
  const blocked = candidateLaunchBlock(candidate, selectedContactId);
  const contactLocked =
    !canLaunch ||
    blocked === "sequence_exists" ||
    blocked === "outreach_status_progressed";
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
        <ProviderContactSelect
          candidate={candidate}
          selectedContactId={selectedContactId}
          disabled={contactLocked}
          onSelect={onSelectContact}
        />
      </TableCell>
      <TableCell className="whitespace-normal">
        <FitChips candidate={candidate} />
      </TableCell>
      <TableCell>
        {candidate.outreach ? (
          <OutreachStatusTag status={candidate.outreach.status} />
        ) : candidate.verdict === "matched" ? (
          <span className="text-muted-foreground">Not contacted</span>
        ) : (
          <FitTag candidate={candidate} />
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0 sm:justify-end">
          {blocked === "sequence_exists" ||
          blocked === "outreach_status_progressed" ||
          blocked === "excluded" ? null : (
            <PillButton
              type="button"
              size="compact"
              variant="primary"
              disabled={!!blocked || !canLaunch}
              onClick={onSend}
            >
              Send
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
  onOpenThread: (threadId: Id<"teamEmailThreads">) => void;
}) {
  if (!sequence) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sequence.teamEmailThreadId ? (
        <PillButton
          type="button"
          size="compact"
          variant="ghost"
          title="Open conversation in Inbox"
          aria-label="Open conversation in Inbox"
          onClick={(event) => {
            event.stopPropagation();
            onOpenThread(sequence.teamEmailThreadId!);
          }}
        >
          <Mail className="size-3.5" />
        </PillButton>
      ) : null}
    </div>
  );
}

type SenderPanel = NonNullable<ProviderOutreachController["sender"]>;

function senderLine(sender: SenderPanel) {
  return `${sender.fromHeader ?? ""}${sender.alwaysCc ? ` · Cc ${sender.alwaysCc}` : ""}`;
}

/**
 * Emails held because the sender's profile changed or needs fixing. Only the
 * sequence's own sender can approve the current From and Always CC.
 */
function IdentityHolds({
  sequences,
  sender,
  block,
}: {
  sequences: SequenceView[];
  sender: SenderPanel;
  block: string | null;
}) {
  const reapprove = useMutation(api.providerOutreach.reapproveIdentity);
  const viewerId = useCachedOperatorCurrent()?.user._id;
  const [approving, setApproving] = useState<string | null>(null);
  const held = sequences.filter(
    (sequence) => sequence.identityHold && isLiveSequence(sequence),
  );
  if (!held.length) return null;

  async function approve(sequence: SequenceView) {
    if (!sender.fingerprint) return;
    setApproving(sequence.sequenceId);
    try {
      await reapprove({
        sequenceId: sequence.sequenceId,
        expectedFingerprint: sender.fingerprint,
      });
      toast.success("Sender approved");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not approve the sender"));
    } finally {
      setApproving(null);
    }
  }

  return (
    <>
      {held.map((sequence) => {
        const owner = sequence.senderUserId === viewerId;
        return (
          <div
            key={sequence.sequenceId}
            role="status"
            className={`space-y-2 rounded-lg border border-border px-4 py-3 ${typeStyle("body.default")}`}
          >
            <p>
              <span className="text-muted-foreground">
                {sequence.audience === "client" ? "Client email" : "Email"} to{" "}
              </span>
              {sequence.recipient.name ?? sequence.recipient.email}
              <span className="text-muted-foreground">
                {" "}
                is on hold: {sequence.identityHold?.message}
              </span>
            </p>
            {owner && !block ? (
              <p className="break-words text-muted-foreground">
                Current sender: {senderLine(sender)}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {owner && block ? (
                <>
                  <span className="min-w-0 flex-1 text-muted-foreground">{block}</span>
                  <PillButton href="/operator/profile" size="compact" variant="ghost">
                    Open Profile
                  </PillButton>
                </>
              ) : owner ? (
                <PillButton
                  size="compact"
                  type="button"
                  disabled={approving !== null}
                  onClick={() => void approve(sequence)}
                >
                  {approving === sequence.sequenceId ? "Approving…" : "Approve updated sender"}
                </PillButton>
              ) : (
                <span className="text-muted-foreground">
                  Only the person who started this email can approve the sender.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Values a provider table row sorts by. */
export type ProviderSortValues = {
  provider: TableSortValue;
  contact: TableSortValue;
  coverage: TableSortValue;
  status: TableSortValue;
};

const OUTREACH_STATUS_ORDER = new Map<string, number>(
  OUTREACH_STATUS_OPTIONS.map((option, index) => [option.value, index]),
);

export function outreachStatusSortValue(status: string) {
  return OUTREACH_STATUS_ORDER.get(status);
}

type ProviderTableRow = {
  group: "submitted" | "matched" | "other";
  sort: ProviderSortValues;
  render: () => ReactNode;
};

const PROVIDER_SORT_COLUMNS = {
  provider: (row: ProviderTableRow) => row.sort.provider,
  contact: (row: ProviderTableRow) => row.sort.contact,
  coverage: (row: ProviderTableRow) => row.sort.coverage,
  status: (row: ProviderTableRow) => row.sort.status,
};

function candidateSortValues(
  candidate: ProviderCandidateView,
): ProviderSortValues {
  return {
    provider: candidate.name,
    contact: candidate.recipient?.email,
    coverage: candidate.lines.covered.length,
    status: candidate.outreach
      ? outreachStatusSortValue(candidate.outreach.status)
      : undefined,
  };
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
    sort: ProviderSortValues;
    row: ReactNode;
  }[];
  readOnly?: boolean;
}) {
  const { requestId, panel, sender, senderBlock, send, selectedContacts, selectContact } =
    controller;
  const [othersOpen, setOthersOpen] = useFollowedState<boolean | null>(
    `procurement:${requestId}:provider-others-open`,
    null,
  );
  const submittedIds = new Set(
    submittedProviders.map((row) => row.brokerOrgId),
  );
  const rows = (panel?.candidates.matched ?? []).filter(
    (candidate) => !submittedIds.has(candidate.brokerOrgId),
  );
  // Unknown fit can be sent one at a time; excluded is listed with its reasons.
  const others = [
    ...(panel?.candidates.unknown ?? []),
    ...(panel?.candidates.excluded ?? []),
  ].filter((candidate) => !submittedIds.has(candidate.brokerOrgId));
  const showOthers = othersOpen ?? (!rows.length && !submittedProviders.length);
  const candidateRow = (candidate: ProviderCandidateView) => (
    <CandidateRow
      key={candidate.brokerOrgId}
      candidate={candidate}
      selectedContactId={selectedContacts[candidate.brokerOrgId]}
      onSelectContact={(contactId) =>
        selectContact(candidate.brokerOrgId, contactId)
      }
      canLaunch={!!panel?.request.canLaunch}
      onSend={() => send(candidate.brokerOrgId)}
    />
  );
  // Submitted, matched and other providers each sort within their group.
  const tableSort = useTableSort(
    `procurement:${requestId}:providers`,
    [
      ...submittedProviders.map((provider) => ({
        group: "submitted" as const,
        sort: provider.sort,
        render: () => provider.row,
      })),
      ...rows.map((candidate) => ({
        group: "matched" as const,
        sort: candidateSortValues(candidate),
        render: () => candidateRow(candidate),
      })),
      ...others.map((candidate) => ({
        group: "other" as const,
        sort: candidateSortValues(candidate),
        render: () => candidateRow(candidate),
      })),
    ],
    PROVIDER_SORT_COLUMNS,
  );
  const renderGroup = (group: ProviderTableRow["group"]) =>
    tableSort.rows
      .filter((row) => row.group === group)
      .map((row) => row.render());
  const matchGaps = (panel?.banners ?? []).flatMap((banner) => MATCH_GAP_COPY[banner] ?? []);
  if (!panel && !readOnly) return null;
  return (
    <div className="space-y-4">
      {panel?.request.closedReason ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This request is{" "}
          {humanize(panel.request.closedReason).replace("request ", "")}, so
          outreach cannot be sent.
        </p>
      ) : null}
      {!readOnly && panel && sender ? (
        <IdentityHolds sequences={panel.sequences} sender={sender} block={senderBlock} />
      ) : null}
      {!readOnly && panel ? (
        <div className="sm:hidden">
          <PillButton
            size="compact"
            type="button"
            disabled={!panel.request.canLaunch || !controller.sendAllCount}
            onClick={() => controller.sendAll()}
          >
            {`Send to all matched (${controller.sendAllCount})`}
          </PillButton>
        </div>
      ) : null}
      <section aria-label="Providers" className="space-y-3">
        <OperationalPanel as="div" data-operator-inline-fields>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead {...tableSort.head("provider")}>
                  Provider
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("contact")}>
                  Contact
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("coverage")}>
                  Coverage
                </SortableTableHead>
                <SortableTableHead {...tableSort.head("status")}>
                  Status
                </SortableTableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderGroup("submitted")}
              {renderGroup("matched")}
              {!rows.length && !submittedProviders.length ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-16 text-center text-muted-foreground"
                  >
                    {others.length
                      ? `No confirmed matches yet${matchGaps.length ? ` because ${matchGaps.join(" and ")}` : ""}. Providers with unknown fit are listed below and can be sent individually.`
                      : "No providers in the directory yet."}
                  </TableCell>
                </TableRow>
              ) : null}
              {others.length ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <button
                      type="button"
                      aria-expanded={showOthers}
                      onClick={() => setOthersOpen(!showOthers)}
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-muted-foreground hover:text-foreground ${typeStyle("body.default")}`}
                    >
                      <ChevronRight
                        className={`size-3.5 transition-transform ${showOthers ? "rotate-90" : ""}`}
                      />
                      Other providers ({others.length}) · fit unknown or
                      excluded
                    </button>
                  </TableCell>
                </TableRow>
              ) : null}
              {showOthers ? renderGroup("other") : null}
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
