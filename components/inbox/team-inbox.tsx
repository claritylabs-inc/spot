"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import {
  Archive,
  ArchiveRestore,
  Inbox,
  PenSquare,
  SlidersHorizontal,
} from "lucide-react";

import { PillButton } from "@/components/ui/pill-button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { AppShellPortal } from "@/components/app-shell-slots";
import { ChatAvatar } from "@/components/chat/chat-message";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PresenceAvatars } from "@/components/app-top-bar";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  type ActiveOperator,
  groupEmailThreadPeople,
  replyingOperators,
  useActiveOperators,
} from "@/hooks/use-operator-presence";
import { useFollowedState } from "@/hooks/use-followed-state";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export type InboxThread = FunctionReturnType<
  typeof api.teamInbox.list
>["page"][number];
export type TeamInboxScope =
  | { kind: "team" }
  | { kind: "request"; requestId: Id<"procurementRequests"> };
type ClientSequence = NonNullable<
  FunctionReturnType<typeof api.clientOutreach.getPanel>
>["sequences"][number];
type TeamFilter = "all" | "mine" | "unlinked";
type Category = NonNullable<InboxThread["category"]>;

const PAGE_SIZE = 40;
const ALL_CATEGORIES = "all";
const CATEGORY_LABELS: Record<Category, string> = {
  broker: "Provider",
  client: "Client",
  internal: "Internal",
  mixed: "Mixed",
  other: "Other",
};
const CATEGORY_ITEMS: Record<string, string> = {
  [ALL_CATEGORIES]: "All categories",
  ...CATEGORY_LABELS,
};

function listTime(value: number) {
  const date = dayjs(value);
  return date.isSame(dayjs(), "day") ? date.format("h:mm A") : date.format("MMM D");
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

/** Operators show their profile photo; everyone else shows initials. */
function rowAvatar(thread: InboxThread) {
  if (thread.latestDirection === "outbound" && thread.sentBy) return thread.sentBy;
  if (thread.fromOperator) return thread.fromOperator;
  return {
    name: (thread.counterpart ?? participant(thread)).replace(/^To /, ""),
    avatarUrl: null,
  };
}

function matches(thread: InboxThread, term: string) {
  if (!term) return true;
  const haystack = [
    thread.subject,
    thread.preview,
    thread.fromName,
    thread.fromEmail,
    thread.client?.name,
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
    <div className="flex items-start gap-3 px-4 py-2.5 @2xl:items-center">
      <ChatAvatar
        name={sequence.recipient.name ?? sequence.recipient.email}
        className="size-6"
      />
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
 * muted preview, then who else is in it and the time. Narrow containers (the
 * reader is open) stack the subject under the sender.
 */
function ThreadRow({
  thread,
  scope,
  selected,
  checked,
  viewers,
  selectable,
  onCheckedChange,
  onSelect,
  onIntent,
}: {
  thread: InboxThread;
  scope: TeamInboxScope;
  selected: boolean;
  checked: boolean;
  viewers: ActiveOperator[] | undefined;
  /** Bulk selection writes (archive), so it is off while impersonating. */
  selectable: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
  onIntent: () => void;
}) {
  // Unread mail reads bold, as in a mail client.
  const emphasis = thread.unread ? "body.medium" : "body.default";
  const replying = replyingOperators(viewers);
  const avatar = rowAvatar(thread);
  const tag =
    scope.kind === "team"
      ? (thread.client?.name ?? null)
      : CATEGORY_LABELS[thread.category] && thread.category !== "other"
        ? CATEGORY_LABELS[thread.category]
        : null;
  return (
    <div
      className={`flex items-center ${selected ? "bg-muted" : checked ? "bg-muted/60" : "hover:bg-muted/50"}`}
    >
      {selectable ? (
        <span className="flex shrink-0 items-center pr-1 pl-4">
          <Checkbox
            aria-label={`Select ${thread.subject}`}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange(value === true)}
          />
        </span>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <button
        type="button"
        data-thread-id={thread._id}
        onClick={onSelect}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        aria-current={selected ? "true" : undefined}
        aria-label={
          thread.unread
            ? `${thread.subject}, unread`
            : thread.needsReply
              ? `${thread.subject}, needs reply`
              : undefined
        }
        className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pr-4 pl-2 text-left outline-none focus-visible:bg-muted @2xl:items-center"
      >
        <span className="relative shrink-0">
          <ChatAvatar name={avatar.name} imageUrl={avatar.avatarUrl} className="size-6" />
          {thread.unread ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -left-0.5 size-2 rounded-full border border-background bg-foreground"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col @2xl:flex-row @2xl:items-center @2xl:gap-4">
          <span className="flex min-w-0 items-center gap-1.5 @2xl:w-48 @2xl:shrink-0">
            <span className={`min-w-0 truncate text-foreground ${typeStyle(emphasis)}`}>
              {participant(thread)}
            </span>
            {thread.messageCount > 1 ? (
              <span className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}>
                {thread.messageCount}
              </span>
            ) : null}
          </span>
          <span className={`min-w-0 flex-1 truncate ${typeStyle("body.default")}`}>
            <span className={`text-foreground ${typeStyle(emphasis)}`}>{thread.subject}</span>
            {thread.preview ? (
              <span className="text-muted-foreground"> — {thread.preview}</span>
            ) : null}
          </span>
        </span>
        {tag ? (
          <Badge variant="outline" className="hidden max-w-36 text-muted-foreground @xl:inline-flex">
            <span className="truncate">{tag}</span>
          </Badge>
        ) : null}
        {viewers?.length ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {replying.length ? (
              <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
                replying
              </span>
            ) : null}
            <PresenceAvatars users={viewers} max={2} size="sm" />
          </span>
        ) : null}
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

/** Spot's link suggestions for this request; unlinked mail is otherwise absent from a request. */
function SuggestedStrip({
  requestId,
  readOnly,
  framed = false,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
  /** Shown on its own (no list below), so it brings its own panel. */
  framed?: boolean;
}) {
  const suggested = useQuery(api.teamInbox.suggestedForRequest, { requestId });
  const linkThread = useMutation(api.teamInbox.linkThread);
  const [linking, setLinking] = useState<string | null>(null);
  if (!suggested?.threads.length) return null;
  const strip = (
    <div className={`divide-y divide-border bg-muted/30 ${framed ? "" : "border-b border-border"}`}>
      {suggested.threads.map((thread) => (
        <div key={thread._id} className="flex items-center gap-3 py-2 pr-3 pl-4">
          <span className={`min-w-0 flex-1 truncate ${typeStyle("body.default")}`}>
            <span className="text-muted-foreground">Suggested · </span>
            {participant(thread)} — {thread.subject}
          </span>
          <Link
            href={`/operator/inbox/${thread._id}`}
            className={`shrink-0 text-muted-foreground hover:text-foreground ${typeStyle("caption.default")}`}
          >
            Open
          </Link>
          {readOnly ? null : (
          <PillButton
            type="button"
            size="compact"
            variant="ghost"
            disabled={linking === thread._id || !thread.linkSuggestion}
            onClick={async () => {
              if (!thread.linkSuggestion) return;
              setLinking(thread._id);
              try {
                await linkThread({
                  threadId: thread._id,
                  requestId: thread.linkSuggestion.requestId,
                  clientOrgId: thread.linkSuggestion.clientOrgId,
                });
                toast.success("Conversation linked");
              } catch (error) {
                toast.error(
                  getUserFacingErrorMessage(error, "Could not link conversation"),
                );
              } finally {
                setLinking(null);
              }
            }}
          >
            Link here
          </PillButton>
          )}
        </div>
      ))}
      {suggested.limited ? (
        <p className={`px-4 py-2 text-muted-foreground ${typeStyle("caption.default")}`}>
          More suggestions may exist. Open Unlinked in the team inbox.
        </p>
      ) : null}
    </div>
  );
  return framed ? <OperationalPanel className="overflow-hidden">{strip}</OperationalPanel> : strip;
}

/**
 * The shared team mailbox, newest first, for the whole team or one request.
 * Selection is owned by the caller (route or `thread` URL parameter) so deep
 * links work. Filters narrow the server page; a page can come back short, in
 * which case "Load older mail" keeps looking one bounded page at a time.
 */
export function TeamInbox({
  scope,
  selectedThreadId,
  onSelect,
  onOpenThread,
  onCompose,
}: {
  scope: TeamInboxScope;
  selectedThreadId: string | null;
  onSelect: (thread: InboxThread | null, options?: { replace?: boolean }) => void;
  /** Called once when the selected conversation first loads in this list. */
  onOpenThread?: (thread: InboxThread) => void;
  /** Starts a new email; the team inbox shows its button in the top bar. */
  onCompose?: () => void;
}) {
  const convex = useConvex();
  const requestId = scope.kind === "request" ? scope.requestId : undefined;
  // The team inbox opens on the operator's own mail.
  const uiKey = requestId ? `inbox:request:${requestId}` : "inbox:team";
  const [filter, setFilter] = useFollowedState<TeamFilter>(
    `${uiKey}:filter`,
    scope.kind === "team" ? "mine" : "all",
  );
  const [clientOrgId, setClientOrgId] = useFollowedState(`${uiKey}:client`, "");
  const [category, setCategory] = useFollowedState(`${uiKey}:category`, ALL_CATEGORIES);
  const [archivedView, setArchivedView] = useFollowedState(`${uiKey}:archived`, false);
  const [search, setSearch] = useFollowedState(`${uiKey}:search`, "");
  const [showFilters, setShowFilters] = useFollowedState(`${uiKey}:show-filters`, false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const clients = useCachedOperatorClients();
  // Impersonating operators read mail; every write below is withheld.
  const readOnly = Boolean(useCachedOperatorCurrent()?.activeImpersonation);

  const queryArgs = useMemo(
    () =>
      requestId
        ? {
            requestId,
            ...(category !== ALL_CATEGORIES ? { category: category as Category } : {}),
            ...(archivedView ? { archived: true } : {}),
          }
        : {
            ...(filter === "mine" ? { mine: true } : {}),
            ...(filter === "unlinked" ? { unlinked: true } : {}),
            ...(clientOrgId ? { clientOrgId: clientOrgId as Id<"organizations"> } : {}),
            ...(category !== ALL_CATEGORIES ? { category: category as Category } : {}),
            ...(archivedView ? { archived: true } : {}),
          },
    [requestId, filter, clientOrgId, category, archivedView],
  );
  const {
    results: threads,
    status,
    loadMore,
  } = usePaginatedQuery(api.teamInbox.list, queryArgs, {
    initialNumItems: PAGE_SIZE,
  });
  const inboxThreads: InboxThread[] = threads;
  const clientPanel = useQuery(
    api.clientOutreach.getPanel,
    requestId ? { requestId } : "skip",
  );
  // Client emails show here until their first message mirrors into a conversation.
  const outbox = (clientPanel?.sequences ?? []).filter(
    (sequence) =>
      !sequence.teamEmailThreadId &&
      (sequence.status === "active" ||
        sequence.status === "failed" ||
        sequence.steps[0]?.status === "captured"),
  );
  const exhausted = status === "Exhausted";
  const canLoadMore = status === "CanLoadMore";
  const setThreadsArchived = useMutation(api.teamInbox.setArchived);
  const setRequestThreadsArchived = useMutation(
    api.procurementRequests.setEmailThreadsArchived,
  );
  const people = groupEmailThreadPeople(useActiveOperators());
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
    onOpenThread?.(selected);
  }, [selected, selectedThreadId, onOpenThread]);
  // Request lists clear a conversation that was in the list and then left it
  // (for example, moved to another request). A deep-linked conversation that
  // was never loaded stays: the reader loads it by id. The team list never
  // clears, since a filter can hide the open conversation.
  useEffect(() => {
    if (scope.kind !== "request") return;
    if (selectionLoaded) {
      lastLoadedSelection.current = selectedThreadId;
    } else if (
      status !== "LoadingFirstPage" &&
      selectedThreadId &&
      lastLoadedSelection.current === selectedThreadId
    ) {
      onSelect(null, { replace: true });
    }
  }, [scope.kind, selectionLoaded, selectedThreadId, status, onSelect]);

  // Subscribe ahead of a click so the reader opens with its data in place.
  function prewarm(thread: InboxThread) {
    convex.prewarmQuery({
      query: api.teamInbox.getThread,
      args: {
        threadId: thread._id,
        ...(requestId ? { requestId } : {}),
        ...(requestId ? { includeArchived: true } : {}),
      },
    });
    if (thread.request)
      convex.prewarmQuery({
        query: api.procurementRequests.previewEmailReconciliation,
        args: { emailThreadId: thread._id },
      });
  }

  function select(thread: InboxThread | null, options?: { replace?: boolean }) {
    if (thread) {
      openedRef.current = thread._id;
      onOpenThread?.(thread);
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

  async function archive(ids: Id<"teamEmailThreads">[], archived: boolean) {
    if (readOnly) return;
    try {
      if (requestId)
        await setRequestThreadsArchived({ requestId, emailThreadIds: ids, archived });
      else await setThreadsArchived({ threadIds: ids, archived });
      if (selected && ids.includes(selected._id)) select(null, { replace: true });
      setChecked(new Set());
      toast.success(
        `${archived ? "Archived" : "Restored"} ${ids.length} conversation${ids.length === 1 ? "" : "s"}`,
        { action: { label: "Undo", onClick: () => void archive(ids, !archived) } },
      );
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not update conversations"));
    }
  }

  const clientOptions = useMemo(
    () =>
      (clients ?? []).map((client) => ({
        value: client._id,
        label: client.name,
        icon: (
          <OrgBrandIcon
            name={client.name}
            iconUrl={client.iconUrl}
            website={client.website}
            size="xs"
          />
        ),
      })),
    [clients],
  );
  // Request mail has Inbox/Archived tabs, so only the category is a filter there.
  const filtered =
    category !== ALL_CATEGORIES ||
    (scope.kind === "team" && (!!clientOrgId || archivedView));
  const resetFilters = () => {
    setCategory(ALL_CATEGORIES);
    if (scope.kind !== "team") return;
    setClientOrgId("");
    setArchivedView(false);
  };

  const searchProps = {
    value: search,
    onChange: setSearch,
    label: "Search conversations",
    placeholder: "Search mail",
  };
  const filtersToggle = (
    <PillButton
      type="button"
      variant={showFilters ? "secondary" : "ghost"}
      size="compact"
      iconOnly
      label={showFilters ? "Hide filters" : "Show filters"}
      aria-pressed={showFilters}
      onClick={() => setShowFilters((value) => !value)}
    >
      <SlidersHorizontal className="size-3.5" />
    </PillButton>
  );
  const selectionBar = checkedVisible.length ? (
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
        onClick={() => void archive(checkedVisible.map((thread) => thread._id), !archivedView)}
      >
        {archivedView ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
        {archivedView ? "Restore" : "Archive"}
      </PillButton>
      <PillButton type="button" variant="ghost" size="compact" onClick={() => setChecked(new Set())}>
        Clear
      </PillButton>
    </div>
  ) : null;
  const suggested =
    requestId && !archivedView ? (
      <SuggestedStrip requestId={requestId} readOnly={readOnly} />
    ) : null;

  let list: ReactNode;
  if (status === "LoadingFirstPage") {
    list = (
      <OperationalPanel className="divide-y divide-border overflow-hidden">
        {suggested}
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </OperationalPanel>
    );
  } else if (visible.length || (!term && outbox.length)) {
    list = (
      <OperationalPanel className="@container overflow-hidden">
        {selectionBar}
        {suggested}
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
              scope={scope}
              selected={thread._id === selected?._id}
              checked={checked.has(thread._id)}
              viewers={people.get(thread._id)}
              selectable={!readOnly}
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
              onIntent={() => prewarm(thread)}
            />
          ))}
        </div>
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
  } else if (exhausted && !inboxThreads.length) {
    list = (
      <>
        {requestId && !archivedView ? (
          <SuggestedStrip requestId={requestId} readOnly={readOnly} framed />
        ) : null}
        <EmptyStateCard
          title={archivedView ? "No archived conversations" : "No conversations"}
          description={
            scope.kind === "request"
              ? "Client emails, provider outreach, replies and forwarded mail for this request show up here."
              : filtered || filter !== "all"
                ? "Nothing matches these filters."
                : "Team email, provider outreach, replies and forwarded mail show up here."
          }
          icon={<Inbox className="size-6" />}
        />
      </>
    );
  } else {
    list = (
      <OperationalPanel className="overflow-hidden">
        {suggested}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            {term
              ? `No loaded conversations match “${term}”.`
              : "Nothing in the loaded conversations yet."}
          </p>
          {term ? (
            <PillButton type="button" variant="ghost" onClick={() => setSearch("")}>
              Clear
            </PillButton>
          ) : canLoadMore ? (
            <PillButton type="button" variant="ghost" onClick={() => loadMore(PAGE_SIZE)}>
              Load older mail
            </PillButton>
          ) : null}
        </div>
      </OperationalPanel>
    );
  }

  const categorySelect = (
    <Select
      value={category}
      items={CATEGORY_ITEMS}
      onValueChange={(value) => value && setCategory(value)}
    >
      <SelectTrigger className="w-40" aria-label="Category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(CATEGORY_ITEMS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const tabs =
    scope.kind === "request" ? (
      <Tabs
        value={archivedView ? "archived" : "inbox"}
        onValueChange={(value) => setArchivedView(value === "archived")}
      >
        <TabsList variant="pill" aria-label="Show">
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>
    ) : (
      <Tabs
        value={filter}
        onValueChange={(value) => {
          const next = value as TeamFilter;
          setFilter(next);
          // Unlinked mail has no client, so the two cannot combine.
          if (next === "unlinked") setClientOrgId("");
        }}
      >
        <TabsList variant="pill" aria-label="Show">
          <TabsTrigger value="mine">Mine</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unlinked">Unlinked</TabsTrigger>
        </TabsList>
      </Tabs>
    );

  return (
    <section className="@container space-y-3">
      {scope.kind === "team" ? (
        <AppShellPortal slot="actions">
          <div className="flex items-center gap-2">
            {onCompose && !readOnly ? (
              <PillButton type="button" size="compact" onClick={onCompose}>
                <PenSquare className="size-3.5" />
                New email
              </PillButton>
            ) : null}
          </div>
        </AppShellPortal>
      ) : null}
      <ListToolbar
        tabs={tabs}
        search={searchProps}
        actions={filtersToggle}
      />
      {showFilters ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {scope.kind === "team" ? (
            <>
              <PillButton
                type="button"
                variant={archivedView ? "secondary" : "ghost"}
                size="compact"
                aria-pressed={archivedView}
                onClick={() => setArchivedView((value) => !value)}
              >
                <Archive className="size-3.5" />
                Archived
              </PillButton>
              <div className="w-44">
                <SearchableSelect
                  ariaLabel="Client"
                  typographyRole="control.menu"
                  value={clientOrgId}
                  options={clientOptions}
                  onChange={(value) => {
                    setClientOrgId(value);
                    if (filter === "unlinked") setFilter("all");
                  }}
                  placeholder="Any client"
                />
              </div>
            </>
          ) : null}
          {categorySelect}
          {filtered ? (
            <PillButton type="button" variant="ghost" size="compact" onClick={resetFilters}>
              Clear filters
            </PillButton>
          ) : null}
        </div>
      ) : null}
      {list}
    </section>
  );
}
