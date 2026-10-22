"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { Copy, Inbox, Loader2, Mail, Search } from "lucide-react";

import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@claritylabs-inc/ui/components/popover";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";

type InboxThread = FunctionReturnType<
  typeof api.procurementRequests.getInbox
>["page"][number];
const PAGE_SIZE = 40;

type Filter = "all" | "needs_reply" | "sent";
const FILTER_LABELS: Record<Filter, string> = {
  all: "All mail",
  needs_reply: "Needs reply",
  sent: "Sent",
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

/**
 * The request's mailbox, newest first. Selection is owned by the caller (the
 * `thread` URL parameter) so deep links work; it is only honored when the
 * thread is in this request's loaded list.
 */
export function RequestInbox({
  requestId,
  forwardingAddress,
  selectedThreadId,
  onSelect,
  onOpenThread,
  onCopyAddress,
}: {
  requestId: Id<"procurementRequests">;
  forwardingAddress: string;
  selectedThreadId: string | null;
  onSelect: (
    threadId: Id<"procurementEmailThreads"> | null,
    options?: { replace?: boolean },
  ) => void;
  onOpenThread: (threadId: Id<"procurementEmailThreads">) => void;
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
  const lastLoadedSelection = useRef<string | null>(null);
  const selected =
    inboxThreads.find((thread) => thread._id === selectedThreadId) ?? null;
  const selectionLoaded = selected !== null;
  const selectedId = selected?._id;
  useEffect(() => {
    if (selectedId) void onOpenThread(selectedId);
  }, [selectedId, onOpenThread]);
  // Keep unloaded deep links, but clear a conversation removed after it was
  // selected (for example, reassigned through Details).
  useEffect(() => {
    if (selectionLoaded) {
      lastLoadedSelection.current = selectedThreadId;
    } else if (
      status !== "LoadingFirstPage" &&
      selectedThreadId &&
      (exhausted || lastLoadedSelection.current === selectedThreadId)
    ) {
      onSelect(null, { replace: true });
    }
  }, [selectionLoaded, selectedThreadId, status, exhausted, onSelect]);

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

  return (
    <OperationalPanel as="section">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <div className="relative min-w-36 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search conversations"
            placeholder="Search mail"
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
        <Popover>
          <PopoverTrigger
            render={
              <PillButton type="button" variant="ghost" className="ml-auto" />
            }
          >
            <Mail className="size-3.5" /> Mailbox address
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 max-w-[calc(100vw-2rem)] p-4"
          >
            <p className={typeStyle("body.medium")}>
              Forward or copy mail here
            </p>
            <p className={"break-all " + typeStyle("technical.codeCompact")}>
              {forwardingAddress}
            </p>
            <PillButton
              type="button"
              variant="secondary"
              onClick={onCopyAddress}
            >
              <Copy className="size-3.5" /> Copy address
            </PillButton>
          </PopoverContent>
        </Popover>
      </div>
      <div role="group" aria-label="Conversations" onKeyDown={onListKeyDown}>
        {visible.length ? (
          visible.map((thread) => (
            <ThreadRow
              key={thread._id}
              thread={thread}
              selected={thread._id === selected?._id}
              onSelect={() => onSelect(thread._id)}
            />
          ))
        ) : exhausted && !inboxThreads.length ? (
          <EmptyStateCard
            title="No conversations yet"
            description="Provider outreach, replies and forwarded mail for this request appear here."
            icon={<Inbox className="size-6" />}
          />
        ) : (
          <div className="space-y-2 p-4">
            <p className={typeStyle("body.medium")}>No conversations match</p>
            <p className={"text-muted-foreground " + typeStyle("body.default")}>
              No loaded conversations match your search or filter.
            </p>
            {term || filter !== "all" ? (
              <PillButton
                type="button"
                variant="secondary"
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p
            className={"text-muted-foreground " + typeStyle("caption.default")}
          >
            {selectedThreadId && !selected
              ? "Load older mail to find this conversation."
              : "Search and filters cover loaded mail."}
          </p>
          <PillButton
            type="button"
            variant="secondary"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(PAGE_SIZE)}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more conversations"}
          </PillButton>
        </div>
      ) : null}
    </OperationalPanel>
  );
}
