"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PresenceAvatars } from "@/components/app-top-bar";
import { ChatAvatar } from "@/components/chat/chat-message";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useAgentDock } from "./agent-dock-provider";
import {
  formatAgentDockRelativeTime,
  groupAgentDockHistory,
} from "./history-groups";
import type {
  AgentDockAdapter,
  AgentDockHistoryView,
  AgentDockThread,
} from "./types";

function useNow() {
  const [now, setNow] = useState(() => dayjs().valueOf());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(dayjs().valueOf()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

function HistoryRow({
  thread,
  now,
  archived,
  pending,
  onOpen,
  onToggleArchive,
}: {
  thread: AgentDockThread;
  now: number;
  archived: boolean;
  pending: boolean;
  onOpen: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <li className="group/row relative flex items-center rounded-md hover:bg-foreground/4">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {thread.creator ? (
          <ChatAvatar
            name={thread.creator.name}
            title={`Started by ${thread.creator.name}`}
            imageUrl={thread.creator.avatarUrl}
            className="size-5 border-2 border-background"
          />
        ) : null}
        <span
          className={cn("mr-6 min-w-0 flex-1 truncate text-foreground", typeStyle("body.default"))}
          title={thread.title}
        >
          {thread.title}
        </span>
        {thread.activeUsers?.length ? (
          <PresenceAvatars users={thread.activeUsers} max={3} size="sm" />
        ) : null}
        <span
          className={cn(
            "shrink-0 text-muted-foreground transition-opacity group-hover/row:opacity-0",
            typeStyle("caption.default"),
          )}
        >
          {formatAgentDockRelativeTime(thread.lastMessageAt, now)}
        </span>
      </button>
      <PillButton
        type="button"
        variant="icon"
        size="compact"
        iconOnly
        disabled={pending}
        label={archived ? `Restore ${thread.title}` : `Archive ${thread.title}`}
        className="absolute right-1.5 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100"
        onClick={onToggleArchive}
      >
        {pending ? (
          <Spinner className="size-3.5" />
        ) : archived ? (
          <ArchiveRestore className="size-3.5" />
        ) : (
          <Archive className="size-3.5" />
        )}
      </PillButton>
    </li>
  );
}

const DEFAULT_VIEWS: AgentDockHistoryView[] = ["recent", "archived"];
const VIEW_LABELS: Record<AgentDockHistoryView, string> = {
  recent: "Recent",
  mcp: "MCP",
  archived: "Archived",
};
const EMPTY_LABELS: Record<AgentDockHistoryView, string> = {
  recent: "No chats yet.",
  mcp: "No MCP requests yet.",
  archived: "No archived chats.",
};

/** Past chats grouped by day, with search, archived toggle and archive/restore. */
export function AgentDockHistory({ adapter }: { adapter: AgentDockAdapter }) {
  const dock = useAgentDock();
  const views = adapter.historyViews ?? DEFAULT_VIEWS;
  // Archived lives in dock state (deep links open it); other tabs are local.
  const [liveView, setLiveView] = useFollowedState<AgentDockHistoryView>(
    "shell:agent-dock:history-view",
    "recent",
  );
  const archived = dock.historyArchived;
  const view: AgentDockHistoryView = archived ? "archived" : liveView;
  const threads = adapter.useThreads(view);
  const { archive, restore } = adapter.useArchiveActions();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const now = useNow();
  const groups = useMemo(
    () =>
      groupAgentDockHistory(threads ?? [], now),
    [now, threads],
  );

  async function toggleArchive(thread: AgentDockThread) {
    setPendingId(thread.id);
    try {
      if (archived) {
        await restore(thread.id);
        toast.success("Chat restored");
      } else {
        await archive(thread.id);
        toast.success("Chat archived");
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          archived ? "Could not restore the chat" : "Could not archive the chat",
        ),
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 md:px-3">
      <div className="ml-auto flex min-h-full w-fit min-w-[min(100%,28rem)] max-w-full flex-col justify-end pb-2">
        {threads === undefined ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <p
            className={cn(
              "px-2 py-6 text-muted-foreground",
              typeStyle("body.default"),
            )}
          >
            {EMPTY_LABELS[view]}
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.label}
              aria-label={group.label}
              className="pt-5 first:pt-6"
            >
              <h3
                className={cn(
                  "flex items-center gap-3 px-2 pb-1.5 text-muted-foreground after:h-px after:flex-1 after:bg-border",
                  typeStyle("caption.medium"),
                )}
              >
                {group.label}
              </h3>
              <ul>
                {group.items.map((thread) => (
                  <HistoryRow
                    key={thread.id}
                    thread={thread}
                    now={now}
                    archived={archived}
                    pending={pendingId === thread.id}
                    onOpen={() => dock.openThread(thread.id)}
                    onToggleArchive={() => void toggleArchive(thread)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {/* Floats over the list so the views stay reachable while scrolling. */}
        <Tabs
          className="sticky bottom-2 z-10 mt-3 self-end rounded-full bg-background/90 shadow-sm ring-1 ring-border backdrop-blur"
          value={view}
          onValueChange={(value) => {
            const next = value as AgentDockHistoryView;
            if (next !== "archived") setLiveView(next);
            dock.setHistoryArchived(next === "archived");
          }}
        >
          <TabsList variant="pill">
            {views.map((option) => (
              <TabsTrigger key={option} value={option}>
                {VIEW_LABELS[option]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
