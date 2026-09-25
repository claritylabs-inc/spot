"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { useAgentDock } from "./agent-dock-provider";
import { DockErrorBoundary } from "./dock-error-boundary";
import type { AgentDockMode, AgentDockTab } from "./dock-state";
import type { AgentDockAdapter } from "./types";

/** Shared by the new-chat button and chat tabs so the row reads as one set. */
const TAB_ITEM_CLASS = cn(
  "relative flex h-full min-w-0 items-center gap-1.5 rounded-full px-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
  typeStyle("control.button"),
);

function TabButton({
  active,
  label,
  onSelect,
  onClose,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      role="presentation"
      className="group/tab relative flex h-7 max-w-52 shrink-0 items-center"
    >
      {active ? (
        <motion.span
          layoutId="agent-dock-active-tab"
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-foreground/6 dark:bg-foreground/10"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        className={cn(
          TAB_ITEM_CLASS,
          active
            ? "text-foreground"
            : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "truncate",
            onClose &&
              "group-hover/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_34px)] group-focus-within/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_34px)]",
          )}
        >
          {label}
        </span>
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className="absolute right-2 flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function ThreadTab({
  adapter,
  tab,
  active,
  open,
}: {
  adapter: AgentDockAdapter;
  tab: AgentDockTab;
  active: boolean;
  open: boolean;
}) {
  const dock = useAgentDock();
  const summary = adapter.useTabSummary(tab.threadId);
  const { closeTab, markSeen } = dock;
  const seenWhileVisible = active && open && dock.view === "chat";

  useEffect(() => {
    if (summary === null) closeTab(tab.threadId);
  }, [closeTab, summary, tab.threadId]);

  useEffect(() => {
    if (seenWhileVisible && summary && summary.lastMessageAt > tab.seenAt) {
      markSeen(tab.threadId, summary.lastMessageAt);
    }
  }, [markSeen, seenWhileVisible, summary, tab.seenAt, tab.threadId]);

  return (
    <TabButton
      active={active}
      label={summary?.title ?? "Chat"}
      onSelect={() => dock.openThread(tab.threadId)}
      onClose={() => closeTab(tab.threadId)}
    />
  );
}

/** Tabs, new chat, history and size controls; the whole dock when collapsed. */
export function AgentDockBar({
  adapter,
  mode,
  mobile,
  actions,
}: {
  adapter: AgentDockAdapter;
  mode: AgentDockMode;
  mobile: boolean;
  actions: ReactNode;
}) {
  const dock = useAgentDock();
  const open = mode !== "collapsed";
  const draftActive =
    open && dock.view === "chat" && dock.activeThreadId === null;

  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 px-2 md:px-3",
        open && "border-t border-border",
      )}
    >
      <button
        type="button"
        aria-label={adapter.newChatLabel}
        onClick={dock.newChat}
        className={cn(
          TAB_ITEM_CLASS,
          "h-7 shrink-0 text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
        )}
      >
        <Plus className="size-3.5" />
        {mobile && dock.tabs.length > 0 ? null : adapter.newChatLabel}
      </button>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
      <div
        role="tablist"
        aria-label="Open chats"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide"
      >
        {draftActive ? (
          <TabButton active label="New chat" onSelect={dock.newChat} />
        ) : null}
        {dock.tabs.map((tab) => (
          <DockErrorBoundary key={tab.threadId} fallback={null}>
            <ThreadTab
              adapter={adapter}
              tab={tab}
              active={
                open &&
                dock.view === "chat" &&
                dock.activeThreadId === tab.threadId
              }
              open={open}
            />
          </DockErrorBoundary>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {open && dock.view === "chat" ? actions : null}
        <PillButton
          type="button"
          variant="icon"
          size="compact"
          iconOnly
          label="History"
          aria-pressed={open && dock.view === "history"}
          className={cn(
            open && dock.view === "history" && "bg-foreground/6 text-foreground",
          )}
          onClick={() =>
            open && dock.view === "history" ? dock.showChat() : dock.showHistory()
          }
        >
          <Clock className="size-3.5" />
        </PillButton>
        {mobile ? null : (
          <PillButton
            type="button"
            variant="icon"
            size="compact"
            iconOnly
            label={mode === "full" ? "Restore" : "Full screen"}
            onClick={dock.toggleFull}
          >
            {mode === "full" ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </PillButton>
        )}
        {open ? (
          <PillButton
            type="button"
            variant="icon"
            size="compact"
            iconOnly
            label="Minimize"
            onClick={() => dock.setMode("collapsed")}
          >
            <X className="size-3.5" />
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}
