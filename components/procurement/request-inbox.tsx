"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { Archive, AtSign, Inbox, Search } from "lucide-react";

import { PillButton } from "@/components/ui/pill-button";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";

export type InboxThread = FunctionReturnType<
  typeof api.procurementRequests.getInbox
>["page"][number];
type ClientSequence = NonNullable<
  FunctionReturnType<typeof api.clientOutreach.getPanel>
>["sequences"][number];
const PAGE_SIZE = 40;

function listTime(value: number) {
  const date = dayjs(value);
  return date.isSame(dayjs(), "day")
    ? date.format("h:mm A")
    : date.format("MMM D");
}

function participant(thread: InboxThread) {
  return (
    thread.counterpart ||
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

const CATEGORY_LABELS: Partial<Record<InboxThread["category"], string>> = {
  broker: "Provider",
  client: "Client",
};

/** A client email that has no mirrored conversation yet. */
function outboxStatus(sequence: ClientSequence) {
  const first = sequence.steps[0];
  if (sequence.status === "failed" || first?.status === "failed") return "Failed";
  if (sequence.status === "stopped" && !first?.sentAt) return "Cancelled";
  if (first?.status === "captured") return "Captured locally, not sent";
  if (first?.status === "sent") return "Sent";
  return first?.status === "sending" ? "Sending…" : "Queued";
}

function OutboxRow({ sequence }: { sequence: ClientSequence }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5 @2xl:items-center">
      <span className="w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col @2xl:flex-row @2xl:items-baseline @2xl:gap-4">
        <span
          className={`min-w-0 truncate text-foreground @2xl:w-44 @2xl:shrink-0 ${typeStyle("body.default")}`}
        >
          To {sequence.recipient.name ?? sequence.recipient.email}
        </span>
        <span className={`min-w-0 flex-1 truncate ${typeStyle("body.default")}`}>
          {sequence.subject ?? "(no subject)"}
        </span>
      </span>
      <span
        className={`shrink-0 pt-px text-muted-foreground @2xl:pt-0 ${typeStyle("caption.default")}`}
      >
        {outboxStatus(sequence)}
      </span>
    </div>
  );
}

/**
 * One line per conversation, as in a mail client: sender, subject with a
 * muted preview, then time. Narrow containers (the reader is open) stack the
 * subject under the sender.
 */
function ThreadRow({
  thread,
  selected,
  checked,
  onCheckedChange,
  onSelect,
  onIntent,
}: {
  thread: InboxThread;
  selected: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
  onIntent: () => void;
}) {
  // Unanswered replies read bold, as unread mail does.
  const emphasis = thread.needsReply ? "body.medium" : "body.default";
  return (
    <div
      className={`flex items-center ${selected ? "bg-muted" : checked ? "bg-muted/60" : "hover:bg-muted/50"}`}
    >
      <span className="flex shrink-0 items-center pr-1 pl-4">
        <Checkbox
          aria-label={`Select ${thread.subject}`}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
      </span>
    <button
      type="button"
      data-thread-id={thread._id}
      onClick={onSelect}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-current={selected ? "true" : undefined}
      aria-label={thread.needsReply ? `${thread.subject}, needs reply` : undefined}
      className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pr-4 pl-2 text-left outline-none focus-visible:bg-muted @2xl:items-center"
    >
      <span className="flex min-w-0 flex-1 flex-col @2xl:flex-row @2xl:items-baseline @2xl:gap-4">
        <span className="flex min-w-0 items-baseline gap-1.5 @2xl:w-44 @2xl:shrink-0">
          <span
            className={`min-w-0 truncate text-foreground ${typeStyle(emphasis)}`}
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
          {CATEGORY_LABELS[thread.category] ? (
            <span
              className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              · {CATEGORY_LABELS[thread.category]}
            </span>
          ) : null}
        </span>
        <span
          className={`min-w-0 flex-1 truncate ${typeStyle("body.default")}`}
        >
          <span className={`text-foreground ${typeStyle(emphasis)}`}>
            {thread.subject}
          </span>
          {thread.preview ? (
            <span className="text-muted-foreground"> — {thread.preview}</span>
          ) : null}
        </span>
      </span>
      <span
        className={`shrink-0 pt-px text-muted-foreground @2xl:pt-0 ${typeStyle("caption.default")}`}
        title={formatDisplayDateTime(thread.latestMessageAt, "—")}
      >
        {listTime(thread.latestMessageAt)}
      </span>
    </button>
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
  selectedThreadId,
  onSelect,
  onOpenThread,
  forwardingAddress,
}: {
  requestId: Id<"procurementRequests">;
  /** Mail forwarded here is imported into this Inbox. */
  forwardingAddress: string | null;
  selectedThreadId: string | null;
  onSelect: (
    thread: InboxThread | null,
    options?: { replace?: boolean },
  ) => void;
  onOpenThread: (thread: InboxThread) => void;
}) {
  const convex = useConvex();
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
  const clientPanel = useQuery(api.clientOutreach.getPanel, { requestId });
  // Client emails show here until their first message mirrors into a conversation.
  const outbox = (clientPanel?.sequences ?? []).filter(
    (sequence) =>
      !sequence.procurementEmailThreadId &&
      (sequence.status === "active" ||
        sequence.status === "failed" ||
        sequence.steps[0]?.status === "captured"),
  );
  const exhausted = status === "Exhausted";
  const canLoadMore = status === "CanLoadMore";
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const setArchived = useMutation(api.procurementRequests.setEmailThreadsArchived);
  const lastLoadedSelection = useRef<string | null>(null);
  const selected =
    inboxThreads.find((thread) => thread._id === selectedThreadId) ?? null;
  const selectionLoaded = selected !== null;
  // Deep links open once the thread loads; clicks open the reader directly.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) {
      if (!selectedThreadId) openedRef.current = null;
      return;
    }
    if (openedRef.current === selected._id) return;
    openedRef.current = selected._id;
    onOpenThread(selected);
  }, [selected, selectedThreadId, onOpenThread]);
  // Keep unloaded deep links, but clear a conversation removed after it was
  // selected (for example, moved to another request).
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

  // Subscribe ahead of a click so the reader opens with its data in place.
  function prewarm(threadId: Id<"procurementEmailThreads">) {
    convex.prewarmQuery({
      query: api.procurementRequests.getEmailThread,
      args: { emailThreadId: threadId, requestId },
    });
    convex.prewarmQuery({
      query: api.procurementRequests.previewEmailReconciliation,
      args: { emailThreadId: threadId },
    });
  }

  function select(thread: InboxThread | null, options?: { replace?: boolean }) {
    if (thread) {
      openedRef.current = thread._id;
      onOpenThread(thread);
    }
    onSelect(thread, options);
  }

  const term = search.trim();
  const visible = inboxThreads.filter((thread) => matches(thread, term));

  // Arrow keys move through the list, Escape leaves the conversation.
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      if (selected) select(null);
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
    if (!next || next._id === selected?._id) return;
    select(next, { replace: true });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-thread-id="${next._id}"]`)
      ?.focus();
  }

  // Only loaded, visible rows can stay selected.
  const checkedVisible = visible.filter((thread) => checked.has(thread._id));
  const allChecked = visible.length > 0 && checkedVisible.length === visible.length;

  async function archive(ids: Id<"procurementEmailThreads">[], archived: boolean) {
    try {
      await setArchived({ requestId, emailThreadIds: ids, archived });
      if (archived) {
        if (selected && ids.includes(selected._id)) select(null, { replace: true });
        setChecked(new Set());
        toast.success(
          `Archived ${ids.length} conversation${ids.length === 1 ? "" : "s"}`,
          { action: { label: "Undo", onClick: () => void archive(ids, false) } },
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive");
    }
  }

  return (
    <OperationalPanel as="section" className="@container overflow-hidden">
      {checkedVisible.length ? (
        <div className="flex h-10 items-center gap-3 border-b border-border pr-3 pl-4">
          <Checkbox
            aria-label="Select all loaded conversations"
            checked={allChecked}
            indeterminate={!allChecked}
            onCheckedChange={(value) =>
              setChecked(value === true ? new Set(visible.map((thread) => thread._id)) : new Set())
            }
          />
          <span className={`flex-1 text-muted-foreground ${typeStyle("body.default")}`}>
            {checkedVisible.length} selected
          </span>
          <PillButton
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => void archive(checkedVisible.map((thread) => thread._id), true)}
          >
            <Archive className="size-3.5" />
            Archive
          </PillButton>
          <PillButton
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => setChecked(new Set())}
          >
            Clear
          </PillButton>
        </div>
      ) : (
      <div className="flex items-center gap-2.5 border-b border-border pr-2 pl-4">
      <label className="flex min-w-0 flex-1 items-center gap-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          aria-label="Search conversations"
          placeholder="Search mail"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={`h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60 ${typeStyle("control.input")}`}
        />
      </label>
      {forwardingAddress ? (
        <PillButton
          type="button"
          variant="ghost"
          size="compact"
          title={`Forward mail to ${forwardingAddress} to add it here. Click to copy.`}
          onClick={() => {
            void navigator.clipboard
              .writeText(forwardingAddress)
              .then(() => toast.success("Forwarding address copied"));
          }}
        >
          <AtSign className="size-3.5" />
          <span className="hidden @md:inline">Forwarding address</span>
        </PillButton>
      ) : null}
      </div>
      )}
      {status === "LoadingFirstPage" ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="px-4 py-3">
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : visible.length || (!term && outbox.length) ? (
        <div
          role="group"
          aria-label="Conversations"
          onKeyDown={onListKeyDown}
          className="divide-y divide-border"
        >
          {term
            ? null
            : outbox.map((sequence) => (
                <OutboxRow key={sequence.sequenceId} sequence={sequence} />
              ))}
          {visible.map((thread) => (
            <ThreadRow
              key={thread._id}
              thread={thread}
              selected={thread._id === selected?._id}
              checked={checked.has(thread._id)}
              onCheckedChange={(value) =>
                setChecked((current) => {
                  const next = new Set(current);
                  if (value) next.add(thread._id);
                  else next.delete(thread._id);
                  return next;
                })
              }
              onSelect={() => {
                if (thread._id !== selected?._id) select(thread);
              }}
              onIntent={() => prewarm(thread._id)}
            />
          ))}
        </div>
      ) : exhausted && !inboxThreads.length ? (
        <EmptyStateCard
          title="No conversations yet"
          description="Emails to the client, provider outreach, replies and forwarded mail for this request appear here."
          icon={<Inbox className="size-6" />}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No loaded conversations match “{term}”.
          </p>
          <PillButton type="button" variant="ghost" onClick={() => setSearch("")}>
            Clear
          </PillButton>
        </div>
      )}
      {canLoadMore || status === "LoadingMore" ? (
        <div className="flex justify-center border-t border-border px-4 py-2">
          <PillButton
            type="button"
            variant="ghost"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(PAGE_SIZE)}
          >
            {status === "LoadingMore" ? "Loading…" : "Load older mail"}
          </PillButton>
        </div>
      ) : null}
    </OperationalPanel>
  );
}
