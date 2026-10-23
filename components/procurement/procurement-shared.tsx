"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { FileInput, FolderInput, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { PresenceAvatars } from "@/components/app-top-bar";
import { ChatAvatar } from "@/components/chat/chat-message";
import {
  LinkSuggestionBar,
  LinkThreadAction,
} from "@/components/inbox/link-thread-action";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@claritylabs-inc/ui/components/popover";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
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

/**
 * One stored message, laid out like a mail client: sender, recipients and
 * date in the header, then the body, forwarded history and files. Collapsed
 * messages show a single line until opened.
 */
export function ProcurementEmailMessage({
  message,
  fromSpot,
  collapsed,
  onExpand,
}: {
  message: ProcurementEmailMessageData;
  fromSpot: boolean;
  collapsed: boolean;
  onExpand: () => void;
}) {
  const forwardedEmail = (message.forwarded as ForwardedEmail | undefined)
    ?.email;
  // Mail we sent is shown as the operator who sent it, not as the sender address.
  const sender = fromSpot
    ? (message.sentBy?.name ?? "Spot")
    : (message.fromName ?? message.fromEmail);
  const files = message.files.flatMap((file) => (file?.url ? [file] : []));
  const unfiledFiles = message.unfiledFiles.flatMap((file) =>
    file.url ? [{ ...file, url: file.url }] : [],
  );
  const body =
    message.currentText ||
    (forwardedEmail ? "" : "(No message text)");
  const header = (
    <div className="flex min-w-0 items-start gap-3">
      {fromSpot && message.sentBy ? (
        <ChatAvatar
          name={message.sentBy.name}
          imageUrl={message.sentBy.avatarUrl}
          className="mt-0.5 size-8 shrink-0"
        />
      ) : fromSpot ? (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <LogoIcon size={18} />
        </span>
      ) : (
        <OrgBrandIcon name={sender} size="lg" className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate">
            <span className={`text-foreground ${typeStyle("body.medium")}`}>
              {sender}
            </span>
            {message.fromName && !collapsed && !fromSpot ? (
              <span
                className={`ml-1.5 text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {message.fromEmail}
              </span>
            ) : null}
          </p>
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
            ? body.replace(/\s+/g, " ") ||
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

  if (collapsed)
    return (
      <button
        type="button"
        onClick={onExpand}
        className="block w-full px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted"
      >
        {header}
      </button>
    );

  return (
    <article className="space-y-3 px-4 py-4">
      {header}
      <div className="space-y-3 pl-11">
        {body ? (
          <p
            className={`whitespace-pre-wrap break-words text-foreground ${typeStyle("body.default")}`}
          >
            {body}
          </p>
        ) : null}
        {forwardedEmail ? (
          <blockquote className="space-y-2 border-l-2 border-border pl-3">
            <div
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              <p>Forwarded message</p>
              {mailboxLabel(forwardedEmail.from) ? (
                <p>From: {mailboxLabel(forwardedEmail.from)}</p>
              ) : null}
              {mailboxList(forwardedEmail.to) ? (
                <p>To: {mailboxList(forwardedEmail.to)}</p>
              ) : null}
              {mailboxList(forwardedEmail.cc) ? (
                <p>Cc: {mailboxList(forwardedEmail.cc)}</p>
              ) : null}
              {forwardedEmail.subject ? (
                <p>Subject: {forwardedEmail.subject}</p>
              ) : null}
            </div>
            {forwardedEmail.body ? (
              <p
                className={`whitespace-pre-wrap break-words text-foreground ${typeStyle("body.default")}`}
              >
                {forwardedEmail.body}
              </p>
            ) : null}
          </blockquote>
        ) : null}
        {files.length ? (
          <div className="flex flex-wrap gap-2">
            {files.map((file) => (
              <FileDownloadButton
                key={file.clientFileId}
                href={file.url!}
                fileName={file.name}
              >
                {file.name}
              </FileDownloadButton>
            ))}
          </div>
        ) : null}
        {unfiledFiles.length ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              {unfiledFiles.map((file) => (
                <FileDownloadButton
                  key={file.storageId}
                  href={file.url}
                  fileName={file.name}
                >
                  {file.name}
                </FileDownloadButton>
              ))}
            </div>
            <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
              Not filed yet. Link this conversation to a client to file them.
            </p>
          </div>
        ) : null}
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

/** Where the conversation is filed, who else has it open, and drafts being written. */
function ConversationContext({
  thread,
  showFiledUnder,
}: {
  thread: ProcurementEmailThreadData;
  /** The request Inbox already says which request this is. */
  showFiledUnder: boolean;
}) {
  const threadId = thread.thread._id;
  const viewers = groupEmailThreadPeople(useActiveOperators()).get(threadId) ?? [];
  const replying = replyingOperators(viewers);
  const drafts = thread.draftsInProgress.slice(0, MAX_SHOWN_DRAFTS);
  const filedUnder = thread.client
    ? [thread.client.name, thread.request?.title].filter(Boolean).join(" · ")
    : "Unlinked";
  if (!showFiledUnder && !viewers.length && !drafts.length) return null;
  return (
    <div className="space-y-1 bg-muted/30 px-4 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className={`min-w-0 truncate text-muted-foreground ${typeStyle("caption.default")}`}>
          {showFiledUnder ? filedUnder : ""}
        </p>
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
          {draft.sender?.name ?? "Someone"} is drafting “
          {draft.subject.slice(0, 80) || "(no subject)"}”
        </p>
      ))}
    </div>
  );
}

/** Earlier messages start collapsed, as in a mail client; the newest stays open. */
function EmailConversation({
  thread,
  readOnly,
  requestScoped,
}: {
  thread: ProcurementEmailThreadData;
  readOnly: boolean;
  requestScoped: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lastId = thread.messages.at(-1)?._id;
  return (
    <div className="-mx-4 -my-4 divide-y divide-border">
      <ConversationContext thread={thread} showFiledUnder={!requestScoped} />
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
          collapsed={message._id !== lastId && !expanded.has(message._id)}
          onExpand={() =>
            setExpanded((current) => new Set(current).add(message._id))
          }
        />
      ))}
    </div>
  );
}

// Unsent replies survive switching conversations within the session.
const replyDrafts = new Map<string, string>();

function ReplyComposer({
  emailThreadId,
  recipient,
  onSendingChange,
  onReplyingChange,
}: {
  emailThreadId: Id<"teamEmailThreads">;
  recipient: string | null;
  onSendingChange: (sending: boolean) => void;
  /** True while the composer is focused with text, for presence. */
  onReplyingChange: (replying: boolean) => void;
}) {
  const reply = useAction(api.actions.providerOutreach.replyToThread);
  const [text, setText] = useState(() => replyDrafts.get(emailThreadId) ?? "");
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const hasText = text.trim().length > 0;
  useEffect(() => {
    onReplyingChange(focused && hasText);
  }, [focused, hasText, onReplyingChange]);
  useEffect(() => () => onReplyingChange(false), [onReplyingChange]);
  // One key per draft, so a retried send cannot deliver twice.
  const sendKey = useRef<string>(crypto.randomUUID());

  function update(value: string) {
    setText(value);
    if (value) replyDrafts.set(emailThreadId, value);
    else replyDrafts.delete(emailThreadId);
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    onSendingChange(true);
    try {
      const result = await reply({
        emailThreadId,
        text,
        idempotencyKey: sendKey.current,
      });
      update("");
      sendKey.current = crypto.randomUUID();
      toast.success(
        result.status === "captured"
          ? "Reply captured locally; nothing was sent"
          : "Reply sent",
      );
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not send reply"));
    } finally {
      setSending(false);
      onSendingChange(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      <Textarea
        aria-label="Reply"
        placeholder={recipient ? `Reply to ${recipient}` : "Write a reply"}
        value={text}
        disabled={sending}
        onChange={(event) => update(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
        className="max-h-60 min-h-20 resize-none field-sizing-content"
      />
      <div className="flex justify-end">
        <PillButton
            size="compact"
          type="button"
          title="Send (Ctrl or ⌘ + Enter)"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Send
        </PillButton>
      </div>
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
  const [open, setOpen] = useState(false);
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
  const [open, setOpen] = useState(false);
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
    if (latestInboundAt === undefined) return;
    if (readAt !== null && readAt >= latestInboundAt) return;
    const key = `${emailThreadId}:${latestInboundAt}`;
    if (markedKey.current === key) return;
    markedKey.current = key;
    markRead({ threadId: emailThreadId }).catch(() => {
      markedKey.current = "";
    });
  }, [emailThreadId, latestInboundAt, markRead, readAt]);

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
            emailThreadId={emailThreadId}
            recipient={
              latestInbound?.fromName ??
              latestInbound?.fromEmail ??
              thread?.followUps?.recipient ??
              null
            }
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
          requestScoped={Boolean(requestId)}
        />
      ) : null}
    </SettingsDrawer>
  );
}
