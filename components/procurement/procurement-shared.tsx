"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { FileInput, FolderInput, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PresenceAvatars } from "@/components/app-top-bar";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import {
  AddThreadContact,
  type ThreadContactSuggestion,
} from "@/components/broker-network/add-thread-contact";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import {
  LinkSuggestionBar,
  LinkThreadAction,
} from "@/components/inbox/link-thread-action";
import { EmailHtmlBody, EmailTextBody } from "@/components/inbox/email-html-body";
import { splitQuotedText } from "@/lib/email-quote";
import { ReplyComposer } from "@/components/inbox/reply-composer";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@claritylabs-inc/ui/components/popover";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  StatusLabel,
  StatusTag,
} from "@claritylabs-inc/ui/components/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  groupEmailThreadPeople,
  replyingOperators,
  useActiveOperators,
  useReportEmailThreadPresence,
} from "@/hooks/use-operator-presence";
import { useFollowedOpen, useFollowedState } from "@/hooks/use-followed-state";
import { usePageContext } from "@/hooks/use-page-context";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";

export const REQUEST_STATUS_OPTIONS = [
  {
    value: "draft",
    label: "Draft",
    tone: "neutral",
    indicator: "draft",
    progress: 0,
  },
  {
    value: "submitted",
    label: "Submitted",
    tone: "success",
    indicator: "pending",
    progress: 0,
  },
  {
    value: "gathering_information",
    label: "Gathering information",
    tone: "info",
    indicator: "progress",
    progress: 0.25,
  },
  {
    value: "marketing",
    label: "Marketing",
    tone: "info",
    indicator: "progress",
    progress: 0.5,
  },
  {
    value: "proposal_review",
    label: "Proposal review",
    tone: "info",
    indicator: "progress",
    progress: 0.7,
  },
  {
    value: "binding",
    label: "Binding",
    tone: "info",
    indicator: "progress",
    progress: 0.88,
  },
  {
    value: "completed",
    label: "Completed",
    tone: "success",
    indicator: "complete",
    progress: 1,
  },
  {
    value: "cancelled",
    label: "Cancelled",
    tone: "danger",
    indicator: "cancelled",
    progress: 0,
  },
] as const;

export type ProcurementRequestStatus =
  (typeof REQUEST_STATUS_OPTIONS)[number]["value"];

export const OUTREACH_STATUS_OPTIONS = [
  {
    value: "observed",
    label: "Observed",
    tone: "neutral",
    indicator: "pending",
    progress: 0,
  },
  {
    value: "request_sent",
    label: "Request sent",
    tone: "info",
    indicator: "progress",
    progress: 0.25,
  },
  {
    value: "can_handle",
    label: "Can handle",
    tone: "success",
    indicator: "progress",
    progress: 0.5,
  },
  {
    value: "cannot_handle",
    label: "Can’t handle",
    tone: "danger",
    indicator: "cancelled",
    progress: 0,
  },
  {
    value: "quote_received",
    label: "Quote received",
    tone: "info",
    indicator: "progress",
    progress: 0.75,
  },
  {
    value: "quote_accepted",
    label: "Accepted by client",
    tone: "success",
    indicator: "complete",
    progress: 1,
  },
  {
    value: "quote_rejected",
    label: "Rejected by client",
    tone: "danger",
    indicator: "cancelled",
    progress: 0,
  },
] as const;

export type ProcurementOutreachStatus =
  (typeof OUTREACH_STATUS_OPTIONS)[number]["value"];

const EMAIL_CATEGORY_OPTIONS = [
  { value: "broker", label: "Provider" },
  { value: "client", label: "Client" },
  { value: "internal", label: "Internal" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
] as const;

export type ProcurementEmailCategory =
  (typeof EMAIL_CATEGORY_OPTIONS)[number]["value"];

function optionForValue<T extends readonly { value: string; label: string }[]>(
  options: T,
  value: string,
): T[number] | undefined {
  return options.find((option) => option.value === value) as
    | T[number]
    | undefined;
}

export function RequestStatusTag({
  status,
}: {
  status: ProcurementRequestStatus;
}) {
  const option = optionForValue(REQUEST_STATUS_OPTIONS, status);
  return (
    <StatusTag
      tone={option?.tone ?? "neutral"}
      indicator={option?.indicator}
      progress={option?.progress}
    >
      {procurementRequestStatusLabel(status)}
    </StatusTag>
  );
}

export function OutreachStatusTag({
  status,
}: {
  status: ProcurementOutreachStatus;
}) {
  const option = optionForValue(OUTREACH_STATUS_OPTIONS, status);
  return (
    <StatusTag
      tone={option?.tone ?? "neutral"}
      indicator={option?.indicator}
      progress={option?.progress}
    >
      {procurementOutreachStatusLabel(status)}
    </StatusTag>
  );
}

export function RequestStatusLabel({
  status,
}: {
  status: ProcurementRequestStatus;
}) {
  const option = optionForValue(REQUEST_STATUS_OPTIONS, status);
  return (
    <StatusLabel
      tone={option?.tone}
      indicator={option?.indicator}
      progress={option?.progress}
    >
      {procurementRequestStatusLabel(status)}
    </StatusLabel>
  );
}

export function OutreachStatusLabel({
  status,
}: {
  status: ProcurementOutreachStatus;
}) {
  const option = optionForValue(OUTREACH_STATUS_OPTIONS, status);
  return (
    <StatusLabel
      tone={option?.tone}
      indicator={option?.indicator}
      progress={option?.progress}
    >
      {procurementOutreachStatusLabel(status)}
    </StatusLabel>
  );
}

export function EmailCategoryBadge({
  category,
}: {
  category: ProcurementEmailCategory;
}) {
  return (
    <Badge variant="outline">{procurementEmailCategoryLabel(category)}</Badge>
  );
}

function procurementRequestStatusLabel(value: string) {
  return optionForValue(REQUEST_STATUS_OPTIONS, value)?.label ?? value;
}

function procurementOutreachStatusLabel(value: string) {
  return optionForValue(OUTREACH_STATUS_OPTIONS, value)?.label ?? value;
}

function procurementEmailCategoryLabel(value: string) {
  return optionForValue(EMAIL_CATEGORY_OPTIONS, value)?.label ?? value;
}

type ProcurementRequestOption = {
  _id: Id<"procurementRequests">;
  title: string;
};

type ForwardedMailbox = { name?: string; address?: string };
type ForwardedEmail = {
  email?: {
    from?: ForwardedMailbox;
    to?: ForwardedMailbox[];
    cc?: ForwardedMailbox[];
    subject?: string;
    date?: string;
    body?: string;
  };
};

function mailboxLabel(mailbox: ForwardedMailbox | undefined) {
  if (!mailbox) return null;
  return mailbox.name && mailbox.address
    ? `${mailbox.name} <${mailbox.address}>`
    : (mailbox.address ?? mailbox.name ?? null);
}

function mailboxList(mailboxes: ForwardedMailbox[] | undefined) {
  return (mailboxes ?? [])
    .map(mailboxLabel)
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function messageTime(value: number) {
  const date = dayjs(value);
  if (date.isSame(dayjs(), "day")) return date.format("h:mm A");
  if (date.isSame(dayjs(), "year")) return date.format("MMM D, h:mm A");
  return date.format("MMM D, YYYY");
}

type ProcurementEmailThreadData = NonNullable<
  FunctionReturnType<typeof api.teamInbox.getThread>
>;
export type ProcurementEmailMessageData =
  ProcurementEmailThreadData["messages"][number];

function ForwardedEmailCard({ email }: { email: NonNullable<ForwardedEmail["email"]> }) {
  const rows = [
    ["From", mailboxLabel(email.from)],
    ["To", mailboxList(email.to)],
    ["Cc", mailboxList(email.cc)],
    ["Date", email.date && dayjs(email.date).isValid() ? formatDisplayDateTime(dayjs(email.date).valueOf(), email.date) : email.date],
    ["Subject", email.subject],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className={`space-y-0.5 bg-muted/40 px-3 py-2 ${typeStyle("caption.default")}`}>
        <p className="text-muted-foreground">Forwarded message</p>
        <dl className="space-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {email.body ? (
        <p
          className={`whitespace-pre-wrap break-words border-t border-border px-3 py-2.5 text-foreground ${typeStyle("body.default")}`}
        >
          {email.body}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One stored message, laid out like a mail client: sender, recipients and
 * date in the header, then the body, forwarded history and files. Collapsed
 * messages show a single line until opened; the avatar collapses an open one.
 */
export function ProcurementEmailMessage({
  message,
  fromSpot,
  collapsed,
  onToggle,
  contactSuggestion,
}: {
  message: ProcurementEmailMessageData;
  fromSpot: boolean;
  collapsed: boolean;
  onToggle: () => void;
  /** The sender is new to this conversation's provider and can be saved as its contact. */
  contactSuggestion?: ThreadContactSuggestion;
}) {
  const forwardedEmail = (message.forwarded as ForwardedEmail | undefined)
    ?.email;
  // Mail we sent is shown as the operator who sent it, not as the sender address.
  const person = fromSpot ? message.sentBy : message.fromOperator;
  const sender = fromSpot
    ? (message.sentBy?.name ?? "Spot")
    : (message.fromName ?? person?.name ?? message.fromEmail);
  // Inline images render inside the HTML body, and signature images Jev flagged are hidden.
  const attachments = [
    ...message.files.flatMap((file) =>
      file?.url && !file.decorative && !(message.hasHtml && file.inline)
        ? [{ key: String(file.clientFileId), name: file.name, contentType: file.contentType, url: file.url }]
        : [],
    ),
    ...message.unfiledFiles.flatMap((file) =>
      file.url && !file.decorative && !(message.hasHtml && file.inline)
        ? [{ key: String(file.storageId), name: file.name, contentType: file.contentType, url: file.url }]
        : [],
    ),
  ];
  const body =
    message.currentText ||
    (forwardedEmail ? "" : "(No message text)");
  const avatar =
    fromSpot && !person ? (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
        <LogoIcon size={16} />
      </span>
    ) : (
      <Avatar
        name={person?.name ?? sender}
        imageUrl={person?.avatarUrl}
        className="size-8 shrink-0"
      />
    );
  const header = (
    <div className="flex min-w-0 items-start gap-3">
      {collapsed ? (
        <span className="mt-0.5">{avatar}</span>
      ) : (
        <button
          type="button"
          aria-label="Collapse message"
          title="Collapse"
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <p className="min-w-0 truncate">
              <span className={`text-foreground ${typeStyle("body.medium")}`}>
                {sender}
              </span>
              {!collapsed && !fromSpot && sender !== message.fromEmail ? (
                <span
                  className={`ml-1.5 text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {message.fromEmail}
                </span>
              ) : null}
            </p>
            {!collapsed && contactSuggestion ? (
              <AddThreadContact
                threadId={message.threadId}
                name={message.fromName ?? undefined}
                suggestion={contactSuggestion}
              />
            ) : null}
          </div>
          <time
            dateTime={dayjs(message.receivedAt).toISOString()}
            title={formatDisplayDateTime(message.receivedAt, "—")}
            className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {messageTime(message.receivedAt)}
          </time>
        </div>
        <p
          className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {collapsed
            ? splitQuotedText(body, message.quotedHistoryStart).current.replace(/\s+/g, " ") ||
              forwardedEmail?.subject ||
              "Forwarded message"
            : `to ${message.toAddresses.join(", ") || "—"}${
                message.ccAddresses.length
                  ? ` · cc ${message.ccAddresses.join(", ")}`
                  : ""
              }`}
        </p>
      </div>
    </div>
  );

  const textBody = (
    <>
      {body ? (
        <EmailTextBody
          text={body}
          historyStart={message.quotedHistoryStart}
          className={`whitespace-pre-wrap break-words text-foreground ${typeStyle("body.default")}`}
        />
      ) : null}
      {forwardedEmail ? <ForwardedEmailCard email={forwardedEmail} /> : null}
    </>
  );

  if (collapsed)
    return (
      <button
        type="button"
        onClick={onToggle}
        className="block w-full px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted"
      >
        {header}
      </button>
    );

  return (
    <article className="space-y-3 px-4 py-4">
      {header}
      <div className="space-y-3 pl-11">
        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <ChatAttachmentChip
                key={file.key}
                attachment={{ filename: file.name, contentType: file.contentType }}
                url={file.url}
              />
            ))}
          </div>
        ) : null}
        {message.hasHtml ? (
          <EmailHtmlBody
            messageId={message._id}
            keepQuoted={Boolean(forwardedEmail)}
            historyStart={message.quotedHistoryStart}
            fallback={textBody}
          />
        ) : (
          textBody
        )}
      </div>
    </article>
  );
}

/** Live automated follow-ups on this conversation, with the shared stop action. */
function FollowUpStatus({
  followUps,
  readOnly,
}: {
  followUps: NonNullable<ProcurementEmailThreadData["followUps"]>;
  readOnly: boolean;
}) {
  const stop = useMutation(api.providerOutreach.stop);
  const [stopping, setStopping] = useState(false);
  const live = followUps.status === "active" || followUps.status === "reply_check";
  if (!live) return null;
  const text =
    followUps.status === "reply_check"
      ? "Reply received; checking it before any follow-up"
      : followUps.remaining && followUps.nextDueAt
        ? `Follow-ups to ${followUps.recipient}: ${followUps.remaining} left · next ${dayjs(followUps.nextDueAt).format("MMM D, h:mm A")}`
        : `Follow-ups to ${followUps.recipient} running`;
  return (
    <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2">
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        {text}
      </p>
      {!readOnly ? (
        <PillButton
          type="button"
          size="compact"
          variant="ghost"
          disabled={stopping}
          onClick={async () => {
            setStopping(true);
            try {
              await stop({ sequenceId: followUps.sequenceId });
              toast.success("Follow-ups stopped");
            } catch (error) {
              toast.error(
                getUserFacingErrorMessage(error, "Could not stop follow-ups"),
              );
            } finally {
              setStopping(false);
            }
          }}
        >
          {stopping ? "Stopping…" : "Stop follow-ups"}
        </PillButton>
      ) : null}
    </div>
  );
}

const MAX_SHOWN_DRAFTS = 3;

/** Who else has the conversation open, and drafts being written. */
function ConversationContext({ thread }: { thread: ProcurementEmailThreadData }) {
  const threadId = thread.thread._id;
  const viewers = groupEmailThreadPeople(useActiveOperators()).get(threadId) ?? [];
  const replying = replyingOperators(viewers);
  const drafts = thread.draftsInProgress.slice(0, MAX_SHOWN_DRAFTS);
  // The server bounds the list too, so a full list may hide more than it counts.
  const hiddenDrafts = thread.draftsInProgress.length - drafts.length;
  const moreDrafts = thread.draftsLimited
    ? `${hiddenDrafts > 0 ? `${hiddenDrafts}+` : "More"} drafts not shown`
    : hiddenDrafts > 0
      ? `+${hiddenDrafts} more draft${hiddenDrafts === 1 ? "" : "s"}`
      : null;
  if (!viewers.length && !drafts.length && !moreDrafts) return null;
  return (
    <div className="space-y-1 px-4 py-2">
      <div className="flex min-w-0 items-center justify-end gap-3">
        {viewers.length ? (
          <span className="flex shrink-0 items-center gap-2">
            {replying.length ? (
              <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                {replying.map((person) => person.name).join(", ")} replying
              </span>
            ) : null}
            <PresenceAvatars users={viewers} max={3} size="sm" />
          </span>
        ) : null}
      </div>
      {drafts.map((draft) => (
        <p
          key={draft._id}
          className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {draft.sender?.name ?? "Someone"}{" "}
          {draft.status === "pending" ? "is sending" : "is drafting"} “
          {draft.subject.slice(0, 80) || "(no subject)"}”
        </p>
      ))}
      {moreDrafts ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {moreDrafts}
        </p>
      ) : null}
    </div>
  );
}

/** Earlier messages start collapsed, as in a mail client; the newest stays open. */
function EmailConversation({
  thread,
  readOnly,
}: {
  thread: ProcurementEmailThreadData;
  readOnly: boolean;
}) {
  // Messages flipped from their default: the newest opens, earlier ones start collapsed.
  const [toggledIds, setToggledIds] = useFollowedState<string[]>(
    `procurement:email:${thread.thread._id}:toggled`,
    [],
  );
  const toggled = useMemo(() => new Set(toggledIds), [toggledIds]);
  const lastId = thread.messages.at(-1)?._id;
  const contactSuggestions = useQuery(
    api.brokerContacts.suggestionsForThread,
    readOnly ? "skip" : { threadId: thread.thread._id },
  );
  return (
    <div className="-mx-4 -my-4 divide-y divide-border">
      <ConversationContext thread={thread} />
      {thread.linkSuggestion && !thread.client && !readOnly ? (
        <LinkSuggestionBar
          threadId={thread.thread._id}
          suggestion={thread.linkSuggestion}
        />
      ) : null}
      {thread.followUps ? (
        <FollowUpStatus followUps={thread.followUps} readOnly={readOnly} />
      ) : null}
      {thread.messagesTruncated ? (
        <p className={`px-4 py-2 text-muted-foreground ${typeStyle("caption.default")}`}>
          Long conversation: showing the latest messages.
        </p>
      ) : null}
      {thread.messages.map((message) => (
        <ProcurementEmailMessage
          key={message._id}
          message={message}
          fromSpot={message.direction === "outbound"}
          contactSuggestion={
            message.direction === "inbound" && !message.fromOperator
              ? contactSuggestions?.find(
                  (suggestion) =>
                    suggestion.email === message.fromEmail.trim().toLowerCase(),
                )
              : undefined
          }
          collapsed={(message._id === lastId) === toggled.has(message._id)}
          onToggle={() =>
            setToggledIds((current) =>
              current.includes(message._id)
                ? current.filter((id) => id !== message._id)
                : [...current, message._id],
            )
          }
        />
      ))}
    </div>
  );
}

function FileQuoteAction({
  emailThreadId,
  readOnly,
  onFilingChange,
}: {
  emailThreadId: Id<"teamEmailThreads">;
  readOnly: boolean;
  onFilingChange: (filing: boolean) => void;
}) {
  const brokers = useCachedOperatorBrokers();
  const fileEmailQuote = useMutation(api.procurementProposals.fileEmailQuote);
  const inference = useQuery(
    api.procurementRequests.previewEmailReconciliation,
    { emailThreadId },
  );
  const [outreachChoice, setOutreachChoice] = useState<string | null>(null);
  // Signature images and logos can be excluded; everything else files.
  const [excludedFileIds, setExcludedFileIds] = useState<string[]>([]);
  const [filing, setFiling] = useState(false);
  const { open, onOpenChange: setOpen } = useFollowedOpen(
    `procurement:email:${emailThreadId}:file-quote-open`,
  );
  const outreachOptions = useMemo(
    () =>
      (inference?.outreaches ?? []).map((outreach) => ({
        value: String(outreach.outreachId),
        label: outreach.contactName
          ? `${outreach.brokerName} · ${outreach.contactName}`
          : outreach.brokerName,
        icon: (
          <OrgBrandIcon
            name={outreach.brokerName}
            {...brokers?.find((broker) => broker._id === outreach.brokerOrgId)}
            size="xs"
          />
        ),
      })),
    [brokers, inference],
  );
  const inferredOutreachId =
    inference?.outreachInference.status === "exact"
      ? String(inference.outreachInference.candidates[0]?.outreachId ?? "")
      : "";
  const pendingOutreachId = outreachChoice ?? inferredOutreachId;
  const selectedOutreachId = outreachOptions.some(
    (option) => option.value === pendingOutreachId,
  )
    ? pendingOutreachId
    : "";
  const reconciliation = useQuery(
    api.procurementRequests.previewEmailReconciliation,
    selectedOutreachId
      ? {
          emailThreadId,
          outreachId: selectedOutreachId as Id<"procurementBrokerOutreaches">,
        }
      : { emailThreadId },
  );
  const proposals = useQuery(
    api.procurementProposals.list,
    open && inference ? { requestId: inference.requestId } : "skip",
  );
  const currentProposal = proposals?.find(
    (proposal) =>
      proposal.outreachId === selectedOutreachId &&
      proposal.status !== "archived" &&
      proposal.status !== "withdrawn",
  );
  const isRevision = !!currentProposal && currentProposal.status !== "draft";
  const unfiled = reconciliation?.unfiledFiles ?? [];
  const selectedFiles = unfiled.filter(
    (file) => !excludedFileIds.includes(String(file.clientFileId)),
  );
  if (readOnly || !reconciliation?.filable || !unfiled.length) return null;

  async function fileQuote() {
    if (!selectedOutreachId || !selectedFiles.length) return;
    setFiling(true);
    onFilingChange(true);
    try {
      const filed = await fileEmailQuote({
        emailThreadId,
        outreachId: selectedOutreachId as Id<"procurementBrokerOutreaches">,
        clientFileIds: selectedFiles.map((file) => file.clientFileId),
        supersedesProposalId: isRevision ? currentProposal._id : undefined,
      });
      toast.success(
        filed.status === "already_filed"
          ? "Email attachments were already filed"
          : "Email quote filed",
      );
      setOpen(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to file email quote"),
      );
    } finally {
      setFiling(false);
      onFilingChange(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<PillButton
            size="compact" type="button" variant="secondary" />}>
        <FileInput className="size-3.5" />
        File quote
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <SearchableSelect
          ariaLabel="Provider"
          typographyRole="control.menu"
          value={selectedOutreachId}
          options={outreachOptions}
          onChange={setOutreachChoice}
          disabled={filing}
          placeholder="Choose provider"
        />
        <div className="space-y-1">
          {unfiled.map((file) => (
            <label
              key={String(file.clientFileId)}
              className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted/50"
            >
              <Checkbox
                checked={!excludedFileIds.includes(String(file.clientFileId))}
                disabled={filing}
                onCheckedChange={(checked) =>
                  setExcludedFileIds((current) =>
                    checked
                      ? current.filter(
                          (id) => id !== String(file.clientFileId),
                        )
                      : [...current, String(file.clientFileId)],
                  )
                }
              />
              <span
                className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}
              >
                {file.name}
              </span>
            </label>
          ))}
        </div>
        {currentProposal?.status === "selected" ? (
          <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
            The selected proposal cannot be replaced.
          </p>
        ) : isRevision ? (
          <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
            Replaces the current proposal; the previous one stays in history.
          </p>
        ) : null}
        <PillButton
            size="compact"
          type="button"
          className="w-full"
          onClick={() => void fileQuote()}
          disabled={
            filing ||
            proposals === undefined ||
            currentProposal?.status === "selected" ||
            !selectedOutreachId ||
            !selectedFiles.length
          }
        >
          {filing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isRevision ? "File revision" : "File quote"}
        </PillButton>
      </PopoverContent>
    </Popover>
  );
}

function MoveThreadAction({
  emailThreadId,
  requestId,
  requests,
  onMoved,
}: {
  emailThreadId: Id<"teamEmailThreads">;
  requestId: Id<"procurementRequests">;
  requests: ProcurementRequestOption[];
  onMoved: () => void;
}) {
  const updateThread = useMutation(api.procurementRequests.updateEmailThread);
  const { open, onOpenChange: setOpen } = useFollowedOpen(
    `procurement:email:${emailThreadId}:move-open`,
  );
  const options = useMemo(
    () =>
      requests
        .filter((request) => request._id !== requestId)
        .map((request) => ({ value: request._id, label: request.title })),
    [requests, requestId],
  );
  if (!options.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <PillButton
            size="compact"
            type="button"
            variant="ghost"
            label="Move to request"
            aria-label="Move to request"
          />
        }
      >
        <FolderInput className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <SearchableSelect
          ariaLabel="Move to request"
          typographyRole="control.menu"
          value=""
          options={options}
          onChange={async (value) => {
            try {
              await updateThread({
                emailThreadId,
                requestId: value as Id<"procurementRequests">,
              });
              setOpen(false);
              toast.success("Conversation moved");
              onMoved();
            } catch (error) {
              toast.error(
                getUserFacingErrorMessage(error, "Could not move conversation"),
              );
            }
          }}
          placeholder="Move to request"
        />
      </PopoverContent>
    </Popover>
  );
}

export type ProcurementEmailDrawerHandle = { save: () => Promise<boolean> };

/**
 * The Inbox reader in the shared right panel, for the team inbox or one
 * request's. Keep it mounted across conversations (no `key`): only the
 * conversation body is keyed, so switching threads swaps content without
 * replaying the panel's open animation. Opening a conversation marks it read
 * and reports it, and any reply in progress, to presence.
 */
export function ProcurementEmailDrawer({
  ref,
  emailThreadId,
  requestId,
  includeArchived,
  subject,
  replyable,
  requests = [],
  readOnly,
  onClose,
}: {
  ref?: Ref<ProcurementEmailDrawerHandle>;
  emailThreadId: Id<"teamEmailThreads">;
  /** Set when opened from a request's Inbox; the conversation must belong to it. */
  requestId?: Id<"procurementRequests">;
  /** Open an archived conversation of the request (its archive view). */
  includeArchived?: boolean;
  /** List data shown while the conversation loads. */
  subject?: string;
  replyable?: boolean;
  /** Same-client requests a forwarded conversation can move to (request Inbox only). */
  requests?: ProcurementRequestOption[];
  readOnly: boolean;
  onClose: () => void;
}) {
  const result = useQuery(api.teamInbox.getThread, {
    threadId: emailThreadId,
    ...(requestId ? { requestId } : {}),
    ...(requestId && includeArchived ? { includeArchived: true } : {}),
  });
  const markRead = useMutation(api.teamInbox.markRead);
  const busy = useRef(false);
  useImperativeHandle(ref, () => ({ save: async () => !busy.current }));
  const [replying, setReplying] = useState(false);
  useReportEmailThreadPresence(emailThreadId, replying ? "replying" : "viewing");
  // The AI panel works on the open conversation while it is shown.
  const { pushPageContext } = usePageContext();
  const contextSubject = result?.thread.subject ?? subject;
  useEffect(
    () =>
      pushPageContext({
        pageType: "team_email_thread",
        entityId: emailThreadId,
        summary: `Email conversation${contextSubject ? `: ${contextSubject.slice(0, 200)}` : ""}`,
      }),
    [contextSubject, emailThreadId, pushPageContext],
  );
  const thread = result?.thread._id === emailThreadId ? result : undefined;
  const latestInbound = thread?.messages.findLast(
    (message) => message.direction === "inbound",
  );
  const setBusy = (value: boolean) => {
    busy.current = value;
  };

  // Reading moves only the read position, once per newest inbound message.
  const latestInboundAt = thread?.thread.latestInboundAt;
  const readAt = thread?.readAt ?? null;
  const markedKey = useRef("");
  useEffect(() => {
    if (readOnly || latestInboundAt === undefined) return;
    if (readAt !== null && readAt >= latestInboundAt) return;
    const key = `${emailThreadId}:${latestInboundAt}`;
    if (markedKey.current === key) return;
    markedKey.current = key;
    markRead({ threadId: emailThreadId }).catch(() => {
      markedKey.current = "";
    });
  }, [emailThreadId, latestInboundAt, markRead, readAt, readOnly]);

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
      title={thread?.thread.subject ?? subject ?? ""}
      actions={
        thread && !readOnly ? (
          <div className="flex items-center gap-1">
            <FileQuoteAction
              key={emailThreadId}
              emailThreadId={emailThreadId}
              readOnly={readOnly}
              onFilingChange={setBusy}
            />
            <LinkThreadAction
              key={`link:${emailThreadId}`}
              thread={{
                _id: emailThreadId,
                source: thread.thread.source,
                client: thread.client,
                request: thread.request ? { _id: thread.request.requestId } : null,
              }}
            />
            {requestId && thread.request && thread.thread.source !== "outreach" ? (
              <MoveThreadAction
                emailThreadId={emailThreadId}
                requestId={thread.request.requestId}
                requests={requests}
                onMoved={onClose}
              />
            ) : null}
          </div>
        ) : null
      }
      footer={
        (thread ? thread.canReply : replyable) && !readOnly ? (
          <ReplyComposer
            key={emailThreadId}
            threadId={emailThreadId}
            recipient={
              latestInbound?.fromName ??
              latestInbound?.fromEmail ??
              thread?.followUps?.recipient ??
              null
            }
            suggestion={thread?.replySuggestion ?? null}
            onSendingChange={setBusy}
            onReplyingChange={setReplying}
          />
        ) : null
      }
    >
      {result === null ? (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This email is no longer available.
        </p>
      ) : thread ? (
        <EmailConversation
          key={emailThreadId}
          thread={thread}
          readOnly={readOnly}
        />
      ) : null}
    </SettingsDrawer>
  );
}
