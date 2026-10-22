"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import dayjs from "dayjs";
import { ArrowLeft, Copy, Inbox, Loader2, Search } from "lucide-react";

import {
  EmailCategoryBadge,
  ProcurementEmailMessage,
} from "@/components/procurement/procurement-shared";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProcurementEmailCategory } from "@/convex/lib/procurement";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@claritylabs-inc/ui/components/tabs";

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
type InboxResult = {
  threads: InboxThread[];
  truncated: boolean;
  limit: number;
};

type Filter = "all" | "needs_reply" | "sent";

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
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`block w-full border-t border-border px-4 py-3 text-left outline-none first:border-t-0 hover:bg-muted/60 focus-visible:bg-muted ${selected ? "bg-muted" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span
          className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}
        >
          {participant(thread)}
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
          className={`mt-0.5 line-clamp-2 break-words text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {thread.preview}
        </span>
      ) : null}
      <span className="mt-2 flex flex-wrap items-center gap-1">
        {thread.needsReply ? (
          <Badge variant="destructive">Needs reply</Badge>
        ) : null}
        <Badge variant="outline">
          {thread.messageCount}{" "}
          {thread.messageCount === 1 ? "message" : "messages"}
        </Badge>
        <Badge variant="outline">
          {thread.source === "resend" ? "Resend" : "Forwarded"}
        </Badge>
        {thread.sequenceStatus ? (
          <Badge variant="secondary">
            {SEQUENCE_LABELS[thread.sequenceStatus]}
          </Badge>
        ) : null}
      </span>
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
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
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
            className={`break-words text-foreground ${typeStyle("heading.micro")}`}
          >
            {thread.subject}
          </h2>
          <p
            className={`mt-1 break-words text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {thread.participantEmails.join(", ") || "No participants recorded"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <EmailCategoryBadge category={thread.category} />
            <Badge variant="outline">
              {thread.source === "resend" ? "Resend" : "Forwarded"}
            </Badge>
            {thread.needsReply ? (
              <Badge variant="destructive">Needs reply</Badge>
            ) : null}
            {thread.sequenceStatus ? (
              <Badge variant="secondary">
                {SEQUENCE_LABELS[thread.sequenceStatus]}
              </Badge>
            ) : null}
          </div>
        </div>
        <PillButton
          type="button"
          variant="secondary"
          size="default"
          onClick={() => onDetails(thread._id)}
        >
          {readOnly ? "View details" : "Details"}
        </PillButton>
      </div>
      <div className="space-y-3 p-4">
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
            <ProcurementEmailMessage key={message._id} message={message} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The request's conversations, newest first. Selection is owned by the caller
 * (the `thread` URL parameter) so deep links work; it is only honored when the
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
  const inbox: InboxResult | undefined = useQuery(
    api.procurementRequests.getInbox,
    { requestId },
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // A deep link to a thread outside this request's loaded list is dropped.
  const unknownSelection =
    inbox !== undefined &&
    !!selectedThreadId &&
    !inbox.threads.some((thread) => thread._id === selectedThreadId);
  useEffect(() => {
    if (unknownSelection) onSelect(null, { replace: true });
  }, [unknownSelection, onSelect]);

  if (inbox === undefined)
    return (
      <OperationalPanel as="section">
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </OperationalPanel>
    );

  const term = search.trim();
  const visible = inbox.threads.filter(
    (thread) =>
      (filter === "all" ||
        (filter === "needs_reply"
          ? thread.needsReply
          : thread.latestDirection === "outbound")) &&
      matches(thread, term),
  );
  const selected =
    inbox.threads.find((thread) => thread._id === selectedThreadId) ?? null;
  const forwarding = (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground ${typeStyle("caption.default")}`}
    >
      <span>Forward email to</span>
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
  );

  if (!inbox.threads.length)
    return (
      <div className="space-y-3">
        <EmptyStateCard
          title="No conversations yet"
          description="Provider replies and forwarded emails for this request appear here."
          icon={<Inbox className="size-6" />}
        />
        {forwarding}
      </div>
    );

  return (
    <div className="space-y-3">
      <OperationalPanel
        as="section"
        className="grid lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]"
      >
        <div
          className={`min-w-0 flex-col border-border lg:flex lg:border-r ${selected ? "hidden" : "flex"}`}
        >
          <div className="space-y-3 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search conversations"
                placeholder="Search conversations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
              />
            </div>
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
            >
              <TabsList variant="pill" aria-label="Filter conversations">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="needs_reply">Needs reply</TabsTrigger>
                <TabsTrigger value="sent">Sent</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto lg:max-h-[calc(100vh-18rem)]">
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
          {inbox.truncated ? (
            <p
              className={`border-t border-border px-4 py-2 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Showing the latest {inbox.limit} conversations. Search covers only
              these.
            </p>
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
            <OperationalPanelBody className="flex h-full min-h-48 items-center justify-center text-center">
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Select a conversation to read it.
              </p>
            </OperationalPanelBody>
          )}
        </div>
      </OperationalPanel>
      {forwarding}
    </div>
  );
}
