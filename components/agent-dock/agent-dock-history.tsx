"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PillButton } from "@/components/ui/pill-button";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { useAgentDock } from "./agent-dock-provider";
import {
  formatAgentDockRelativeTime,
  groupAgentDockHistory,
} from "./history-groups";
import type { AgentDockAdapter, AgentDockThread } from "./types";

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
        <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-foreground/50" />
        <span
          className={cn("min-w-0 flex-1 truncate text-foreground", typeStyle("body.default"))}
        >
          {thread.title}
        </span>
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

/** Past chats grouped by day, with search, archived toggle and archive/restore. */
export function AgentDockHistory({ adapter }: { adapter: AgentDockAdapter }) {
  const dock = useAgentDock();
  const archived = dock.historyArchived;
  const threads = adapter.useThreads(archived);
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
      <div className="ml-auto flex min-h-full w-full max-w-md flex-col justify-end pb-2">
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
            {archived ? "No archived chats." : "No chats yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="pt-3">
              <h3
                className={cn(
                  "px-2 pb-1 text-foreground",
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
        <Tabs
          className="mt-3 self-end"
          value={archived ? "archived" : "active"}
          onValueChange={(value) =>
            dock.setHistoryArchived(value === "archived")
          }
        >
          <TabsList variant="pill">
            <TabsTrigger value="active">Recent</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
