"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import dayjs from "dayjs";
import { ArrowLeft, Copy, Inbox, Loader2, Search } from "lucide-react";

import { ProcurementEmailMessage } from "@/components/procurement/procurement-shared";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProcurementEmailCategory } from "@/convex/lib/procurement";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";

type InboxThread = {
  _id: Id<"procurementEmailThreads">;
  subject: string;
  category: ProcurementEmailCategory;
  participantEmails: string[];
  latestMessageAt: number;
  messageCount: number;
  source: "resend" | "forwarded";
  latestDirection: "inbound" | "outbound" | "unknown";
  needsReply: boolean;
  sequenceStatus:
    | "active"
    | "reply_check"
    | "responded"
    | "completed"
    | "stopped"
    | "failed"
    | null;
  preview: string;
  fromName: string | null;
  fromEmail: string | null;
};
const PAGE_SIZE = 40;

type Filter = "all" | "needs_reply" | "sent";
const FILTER_LABELS: Record<Filter, string> = {
  all: "All mail",
  needs_reply: "Needs reply",
  sent: "Sent",
};

const SEQUENCE_LABELS: Record<
  NonNullable<InboxThread["sequenceStatus"]>,
  string
> = {
  active: "Follow-ups active",
  reply_check: "Checking reply",
  responded: "Replied",
  completed: "Follow-ups finished",
  stopped: "Follow-ups stopped",
  failed: "Follow-ups failed",
};

function listTime(value: number) {
  const date = dayjs(value);
  return date.isSame(dayjs(), "day")
    ? date.format("h:mm A")
    : date.format("MMM D");
}

function participant(thread: InboxThread) {
  return (
    thread.fromName ||
    thread.fromEmail ||
    thread.participantEmails[0] ||
    "Unknown sender"
  );
}

function matches(thread: InboxThread, term: string) {
  if (!term) return true;
  const haystack = [
    thread.subject,
    thread.preview,
    thread.fromName,
    thread.fromEmail,
    ...thread.participantEmails,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-thread-id={thread._id}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`block w-full border-b border-l-2 border-border px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 ${selected ? "border-l-foreground bg-muted" : "border-l-transparent"}`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {thread.needsReply ? (
            <span
              className="size-1.5 shrink-0 self-center rounded-full bg-primary"
              role="img"
              aria-label="Needs reply"
            />
          ) : null}
          <span
            className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}
          >
            {participant(thread)}
          </span>
          {thread.messageCount > 1 ? (
            <span
              className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {thread.messageCount}
            </span>
          ) : null}
        </span>
        <span
          className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
          title={formatDisplayDateTime(thread.latestMessageAt, "—")}
        >
          {listTime(thread.latestMessageAt)}
        </span>
      </span>
      <span
        className={`mt-0.5 block truncate text-foreground ${typeStyle("body.default")}`}
      >
        {thread.subject}
      </span>
      {thread.preview ? (
        <span
          className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {thread.preview}
        </span>
      ) : null}
    </button>
  );
}

function Reader({
  requestId,
  thread,
  readOnly,
  onBack,
  onDetails,
}: {
  requestId: Id<"procurementRequests">;
  thread: InboxThread;
  readOnly: boolean;
  onBack: () => void;
  onDetails: (threadId: Id<"procurementEmailThreads">) => void;
}) {
  const result = useQuery(api.procurementRequests.getEmailThread, {
    emailThreadId: thread._id,
    requestId,
  });
  const loaded = result?.thread._id === thread._id ? result : undefined;
  const meta = [
    thread.needsReply ? "Needs reply" : null,
    thread.source === "resend" ? "Provider outreach" : "Forwarded mail",
    thread.sequenceStatus ? SEQUENCE_LABELS[thread.sequenceStatus] : null,
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
        <div className="min-w-0">
          <PillButton
            type="button"
            variant="ghost"
            size="xs"
            className="mb-2 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            Inbox
          </PillButton>
          <h2
            className={`break-words text-foreground ${typeStyle("heading.section")}`}
          >
            {thread.subject}
          </h2>
          <p
            className={`mt-1 break-words text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {[
              thread.participantEmails.join(", ") || "No participants recorded",
              ...meta,
            ].join(" · ")}
          </p>
        </div>
        <PillButton
          type="button"
          variant="ghost"
          size="xs"
          className="shrink-0"
          onClick={() => onDetails(thread._id)}
        >
          {readOnly ? "View details" : "Details"}
        </PillButton>
      </div>
      <div className="max-w-3xl px-6 pb-8">
        {result === undefined ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !loaded ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            This conversation is no longer available.
          </p>
        ) : (
          loaded.messages.map((message) => (
            <ProcurementEmailMessage
              key={message._id}
              message={message}
              variant="flat"
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The request's mailbox, newest first. Selection is owned by the caller (the
 * `thread` URL parameter) so deep links work; it is only honored when the
 * thread is in this request's loaded list.
 */
export function RequestInbox({
  requestId,
  forwardingAddress,
  selectedThreadId,
  readOnly,
  onSelect,
  onDetails,
  onCopyAddress,
}: {
  requestId: Id<"procurementRequests">;
  forwardingAddress: string;
  selectedThreadId: string | null;
  readOnly: boolean;
  onSelect: (
    threadId: Id<"procurementEmailThreads"> | null,
    options?: { replace?: boolean },
  ) => void;
  onDetails: (threadId: Id<"procurementEmailThreads">) => void;
  onCopyAddress: () => void;
}) {
  const {
    results: threads,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.procurementRequests.getInbox,
    { requestId },
    { initialNumItems: PAGE_SIZE },
  );
  const inboxThreads: InboxThread[] = threads;
  const exhausted = status === "Exhausted";
  const canLoadMore = status === "CanLoadMore";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // A deep link missing from the fully loaded list is dropped. While older
  // mail is still unloaded it may just not have arrived yet, so it is kept.
  const unknownSelection =
    exhausted &&
    !!selectedThreadId &&
    !inboxThreads.some((thread) => thread._id === selectedThreadId);
  useEffect(() => {
    if (unknownSelection) onSelect(null, { replace: true });
  }, [unknownSelection, onSelect]);

  if (status === "LoadingFirstPage")
    return (
      <OperationalPanel as="section">
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </OperationalPanel>
    );

  const term = search.trim();
  const visible = inboxThreads.filter(
    (thread) =>
      (filter === "all" ||
        (filter === "needs_reply"
          ? thread.needsReply
          : thread.latestDirection === "outbound")) &&
      matches(thread, term),
  );
  const selected =
    inboxThreads.find((thread) => thread._id === selectedThreadId) ?? null;

  // Arrow keys move through the list, Escape leaves the conversation. The
  // handler lives on the list, so search and the filter keep their own keys.
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      if (selected) onSelect(null);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const focusedId = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-thread-id]",
    )?.dataset.threadId;
    const current = visible.findIndex(
      (thread) => thread._id === (focusedId ?? selected?._id),
    );
    const next =
      visible[
        Math.min(
          visible.length - 1,
          Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
        )
      ];
    if (!next) return;
    onSelect(next._id, { replace: true });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-thread-id="${next._id}"]`)
      ?.focus();
  }

  const forwarding = (
    <div
      className={`space-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>This request’s mailbox address:</span>
        <span
          className={`break-all text-foreground ${typeStyle("technical.codeCompact")}`}
        >
          {forwardingAddress}
        </span>
        <PillButton
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCopyAddress}
        >
          <Copy className="size-3.5" />
          Copy
        </PillButton>
      </p>
      <p>
        Forward or copy mail here to file it in this Inbox. Provider outreach is
        sent from the operator’s own inbox, not this address.
      </p>
    </div>
  );

  if (exhausted && !inboxThreads.length)
    return (
      <div className="space-y-3">
        <EmptyStateCard
          title="No conversations yet"
          description="Provider outreach, replies and forwarded mail for this request appear here."
          icon={<Inbox className="size-6" />}
        />
        {forwarding}
      </div>
    );

  return (
    <div className="space-y-3">
      <OperationalPanel
        as="section"
        className="grid lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]"
      >
        <div
          className={`min-w-0 flex-col border-border lg:flex lg:border-r ${selected ? "hidden" : "flex"}`}
        >
          <div className="flex gap-2 border-b border-border p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search conversations"
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
              />
            </div>
            <Select
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
            >
              <SelectTrigger
                aria-label="Filter conversations"
                className="w-32 shrink-0"
              >
                <SelectValue>{FILTER_LABELS[filter]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FILTER_LABELS) as Filter[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {FILTER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            role="list"
            aria-label="Conversations"
            onKeyDown={onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-16rem)]"
          >
            {visible.length ? (
              visible.map((thread) => (
                <ThreadRow
                  key={thread._id}
                  thread={thread}
                  selected={thread._id === selected?._id}
                  onSelect={() => onSelect(thread._id)}
                />
              ))
            ) : (
              <div className="space-y-2 p-4">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  No conversations match
                </p>
                <p
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {term
                    ? `Nothing in the loaded conversations matches “${term}”.`
                    : filter === "needs_reply"
                      ? "No conversation needs a reply."
                      : "No conversation ends with a message sent from this request."}
                </p>
                {term || filter !== "all" ? (
                  <PillButton
                    type="button"
                    variant="secondary"
                    size="default"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear search and filters
                  </PillButton>
                ) : null}
              </div>
            )}
          </div>
          {canLoadMore || status === "LoadingMore" ? (
            <div
              className={`space-y-2 border-t border-border px-4 py-3 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              <p>Search and filters cover only the mail loaded so far.</p>
              <PillButton
                type="button"
                variant="secondary"
                size="xs"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(PAGE_SIZE)}
              >
                {status === "LoadingMore"
                  ? "Loading…"
                  : "Load more conversations"}
              </PillButton>
            </div>
          ) : null}
        </div>
        <div className={`min-w-0 lg:block ${selected ? "block" : "hidden"}`}>
          {selected ? (
            <Reader
              key={selected._id}
              requestId={requestId}
              thread={selected}
              readOnly={readOnly}
              onBack={() => onSelect(null)}
              onDetails={onDetails}
            />
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                {selectedThreadId && !exhausted
                  ? "This conversation is older than the mail loaded so far."
                  : "Select a conversation to read it."}
              </p>
              {selectedThreadId && canLoadMore ? (
                <PillButton
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => loadMore(PAGE_SIZE)}
                >
                  Load more conversations
                </PillButton>
              ) : null}
            </div>
          )}
        </div>
      </OperationalPanel>
      {forwarding}
    </div>
  );
}
