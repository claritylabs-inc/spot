"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Plus,
  X,
} from "lucide-react";
import { ShortcutTooltip, type ShortcutKey } from "@/components/ui/kbd";
import { APP_SIDEBAR_COLLAPSED_WIDTH } from "@claritylabs-inc/ui/components/app-shell/app-shell-sidebar-layout";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { useIsFollowing } from "@/hooks/use-followed-state";
import { PresenceSlot } from "@/components/operator-agent/presence-slot";
import { useAgentDock } from "./agent-dock-provider";
import { DockErrorBoundary } from "./dock-error-boundary";
import type { AgentDockMode, AgentDockTab } from "./dock-state";
import {
  AGENT_DOCK_TABS_MAX_WIDTH,
  AGENT_DOCK_TABS_MIN_WIDTH,
  clampAgentDockTabsWidth,
} from "./dock-storage";
import type {
  AgentDockAdapter,
  AgentDockPerson,
  AgentDockSubtask,
} from "./types";
import { SubtaskStack, SubtaskStatusGlyph } from "./agent-dock-subtasks";

/** Shared by the new-chat button and chat tabs so the row reads as one set. */
const TAB_ITEM_CLASS = cn(
  "relative flex h-full min-w-0 items-center gap-1.5 rounded-full px-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
  typeStyle("control.buttonCompact"),
);

/** Width of the right-side tab sidebar as an icon rail, matching the
 * collapsed left menu. */
export const AGENT_DOCK_RAIL_WIDTH = APP_SIDEBAR_COLLAPSED_WIDTH;

/** Vertical tabs, Arc style: full rows in the sidebar, initials in the rail. */
const ROW_ITEM_CLASS = cn(
  "relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
  typeStyle("control.buttonCompact"),
);
const RAIL_ITEM_CLASS = cn(
  "relative flex size-8 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
  typeStyle("control.buttonCompact"),
);

type TabVariant = "bar" | "row" | "rail";

function TabButton({
  active,
  label,
  onSelect,
  onClose,
  closeShortcut,
  hint,
  creator,
  icon,
  compact = false,
  position,
  variant = "bar",
}: {
  closeShortcut?: ShortcutKey[];
  /** A smaller bar tab inside a subtask group. */
  compact?: boolean;
  /** Leads the label in place of the creator, such as a subtask's status. */
  icon?: ReactNode;
  /** Hover text beside the label, such as who started the chat. */
  hint?: string;
  /** Who started the chat; their avatar leads vertical tabs. */
  creator?: AgentDockPerson;
  /** 1-based tab number, shown on the collapsed rail. */
  position?: number;
  active: boolean;
  label: string;
  onSelect: () => void;
  onClose?: () => void;
  variant?: TabVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const rail = variant === "rail";
  const closeMask =
    "group-hover/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_34px)] group-focus-within/tab:[mask-image:linear-gradient(to_left,transparent_18px,black_34px)]";

  return (
    <div
      ref={ref}
      role="presentation"
      className={cn(
        "group/tab relative flex shrink-0 items-center",
        variant === "bar" && (compact ? "h-6 max-w-44" : "h-7 max-w-52"),
        variant === "row" && "h-8 w-full",
        rail && "size-8",
      )}
    >
      {active ? (
        <motion.span
          layoutId="agent-dock-active-tab"
          aria-hidden="true"
          className={cn(
            "absolute inset-0 bg-foreground/6 dark:bg-foreground/10",
            variant === "bar" ? "rounded-full" : "rounded-lg",
          )}
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={rail ? label : undefined}
        title={hint ? `${label} · ${hint}` : label}
        onClick={onSelect}
        className={cn(
          variant === "bar"
            ? TAB_ITEM_CLASS
            : rail
              ? RAIL_ITEM_CLASS
              : ROW_ITEM_CLASS,
          // A leading avatar or mark sits concentric with the rounded end.
          variant === "bar" &&
            compact &&
            cn("gap-1.5 px-2.5", icon ? "pl-[5px]" : creator && "pl-1"),
          active
            ? "text-foreground"
            : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
        )}
      >
        {rail ? (
          <span aria-hidden="true" className="relative flex">
            {icon ? (
              icon
            ) : creator ? (
              <Avatar
                name={creator.name}
                imageUrl={creator.avatarUrl}
                className="size-5 rounded-full"
              />
            ) : (
              <MessageSquare className="size-3.5" />
            )}
            {position ? (
              <span
                className={cn(
                  "absolute -right-1.5 -bottom-1.5 flex size-4 items-center justify-center rounded-full bg-background text-foreground ring-1 ring-border",
                  typeStyle("caption.medium"),
                )}
              >
                {position}
              </span>
            ) : null}
          </span>
        ) : (
          <>
            {icon ? (
              icon
            ) : creator ? (
              <Avatar
                name={creator.name}
                imageUrl={creator.avatarUrl}
                className="size-4 shrink-0"
              />
            ) : variant === "row" ? (
              <MessageSquare className="size-3.5 shrink-0 opacity-60" />
            ) : null}
            <span className={cn("truncate", onClose && closeMask)}>{label}</span>
          </>
        )}
      </button>
      {onClose && !rail ? (
        closeShortcut ? (
          <ShortcutTooltip label="Close" keys={closeShortcut}>
            <button
              type="button"
              aria-label={`Close ${label}`}
              onClick={onClose}
              className="absolute right-2 flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
            >
              <X className="size-3" />
            </button>
          </ShortcutTooltip>
        ) : (
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="absolute right-2 flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
          >
            <X className="size-3" />
          </button>
        )
      ) : null}
    </div>
  );
}

function ThreadTab({
  adapter,
  tab,
  active,
  open,
  position,
  variant,
}: {
  adapter: AgentDockAdapter;
  tab: AgentDockTab;
  active: boolean;
  open: boolean;
  position?: number;
  variant?: TabVariant;
}) {
  const dock = useAgentDock();
  const summary = adapter.useTabSummary(tab.threadId);
  const { closeTab, markSeen } = dock;
  // A follower's tabs mirror the leader's, so marking them seen never sticks.
  const following = useIsFollowing();
  const seenWhileVisible =
    active && open && dock.view === "chat" && !following;

  useEffect(() => {
    if (summary === null) closeTab(tab.threadId);
  }, [closeTab, summary, tab.threadId]);

  useEffect(() => {
    if (seenWhileVisible && summary && summary.lastMessageAt > tab.seenAt) {
      markSeen(tab.threadId, summary.lastMessageAt);
    }
  }, [markSeen, seenWhileVisible, summary, tab.seenAt, tab.threadId]);

  // A subtask whose parent chat is open shows inside the parent's group.
  if (
    summary?.parentThreadId &&
    dock.tabs.some((item) => item.threadId === summary.parentThreadId)
  )
    return null;

  const parentTab = (compact = false) => (
    <TabButton
      active={active}
      label={summary?.title ?? "Chat"}
      hint={summary?.hint}
      creator={summary?.creator}
      position={position}
      onSelect={() => dock.openThread(tab.threadId)}
      onClose={() => closeTab(tab.threadId)}
      closeShortcut={active ? ["alt", "w"] : undefined}
      variant={variant}
      compact={compact}
    />
  );
  const subtasks = summary?.subtasks ?? [];
  if (!subtasks.length) return parentTab();
  const visible = open && dock.view === "chat";
  const expanded =
    visible &&
    (active || subtasks.some((task) => task.threadId === dock.activeThreadId));
  return (
    <SubtaskTabGroup
      parentTab={parentTab(expanded && (variant ?? "bar") === "bar")}
      subtasks={subtasks}
      expanded={expanded}
      activeThreadId={visible ? dock.activeThreadId : null}
      onOpen={(threadId) => dock.openThread(threadId)}
      onOpenParent={() => dock.openThread(tab.threadId)}
      variant={variant ?? "bar"}
    />
  );
}

/**
 * A chat with subtasks: while it or one of its subtasks is open, each subtask
 * is a tab beside it with its status; otherwise they collapse into a stack.
 */
function SubtaskTabGroup({
  parentTab,
  subtasks,
  expanded,
  activeThreadId,
  onOpen,
  onOpenParent,
  variant,
}: {
  parentTab: ReactNode;
  subtasks: AgentDockSubtask[];
  expanded: boolean;
  activeThreadId: string | null;
  onOpen: (threadId: string) => void;
  onOpenParent: () => void;
  variant: TabVariant;
}) {
  const row = variant === "row";
  const rail = variant === "rail";
  // Oldest first, in the order they were started.
  const ordered = [...subtasks].reverse();
  const subtaskTabs = ordered.map((task) => (
    <TabButton
      key={task.threadId}
      active={task.threadId === activeThreadId}
      label={task.title}
      icon={<SubtaskStatusGlyph status={task.status} />}
      onSelect={() => onOpen(task.threadId)}
      variant={variant}
      compact
    />
  ));
  if (rail)
    return (
      <>
        {parentTab}
        {expanded ? subtaskTabs : null}
      </>
    );
  if (!expanded)
    return (
      <div
        role="presentation"
        className={cn("flex shrink-0", row ? "w-full flex-col" : "items-center")}
      >
        {parentTab}
        <SubtaskStack
          subtasks={subtasks}
          onSelect={onOpenParent}
          // Tucked into the parent tab's end padding so it reads as part of it.
          className={row ? "ml-5 self-start" : "-ml-2.5"}
        />
      </div>
    );
  return (
    <div
      role="presentation"
      className={cn(
        "flex shrink-0 gap-0.5",
        row
          ? "w-full flex-col [&>*:not(:first-child)]:pl-4"
          : "items-center rounded-full bg-foreground/[0.03] p-0.5",
      )}
    >
      {parentTab}
      {subtaskTabs}
    </div>
  );
}

/** Tabs, new chat, history and size controls; the whole dock when collapsed. */
export function AgentDockBar({
  adapter,
  mode,
  mobile,
  actions,
  sizeControls = true,
}: {
  adapter: AgentDockAdapter;
  mode: AgentDockMode;
  mobile: boolean;
  actions: ReactNode;
  /** Full screen and minimize; hidden where the dock owns the whole frame. */
  sizeControls?: boolean;
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
      <ShortcutTooltip label={adapter.newChatLabel} keys={["alt", "n"]}>
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
      </ShortcutTooltip>
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
      {/* Teammates on this page, filled by OperatorPresence for operators. */}
      <PresenceSlot
        collapsed={mobile}
        className="mr-1 flex max-w-[55%] min-w-0 shrink-0 items-center"
      />
      <div className="flex shrink-0 items-center gap-1">
        {open && dock.view === "chat" ? actions : null}
        <PillButton
          type="button"
          variant="icon"
          size="compact"
          iconOnly
          label="All chats"
          shortcut={["alt", "h"]}
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
        {mobile || !sizeControls ? null : (
          <PillButton
            type="button"
            variant="icon"
            size="compact"
            iconOnly
            label={mode === "full" ? "Restore" : "Expand"}
            shortcut={["alt", "e"]}
            onClick={dock.toggleFull}
          >
            {mode === "full" ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </PillButton>
        )}
        {open && sizeControls ? (
          <PillButton
            type="button"
            variant="icon"
            size="compact"
            iconOnly
            label="Minimize"
          shortcut={["alt", "j"]}
            onClick={() => dock.setMode("collapsed")}
          >
            <X className="size-3.5" />
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}

/** Dragging the tabs narrower than this snaps them to the rail. */
const TABS_SNAP_WIDTH = (AGENT_DOCK_RAIL_WIDTH + AGENT_DOCK_TABS_MIN_WIDTH) / 2;

/** The tab sidebar's left edge: drag to resize, or narrow it to the rail. */
function TabsResizeHandle({
  collapsed,
  width,
  onDrag,
}: {
  collapsed: boolean;
  width: number;
  onDrag: (width: number | null) => void;
}) {
  const dock = useAgentDock();
  // The sidebar's right edge is the window's.
  const widthAt = (clientX: number) =>
    Math.min(
      AGENT_DOCK_TABS_MAX_WIDTH,
      Math.max(AGENT_DOCK_RAIL_WIDTH, window.innerWidth - clientX),
    );
  const commit = (next: number) => {
    const snap = next < TABS_SNAP_WIDTH;
    dock.setTabsCollapsed(snap);
    if (!snap) dock.setTabsWidth(next);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat tabs"
      aria-valuemin={AGENT_DOCK_RAIL_WIDTH}
      aria-valuemax={AGENT_DOCK_TABS_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="group/tabs-resize absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none outline-none select-none"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(widthAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        commit(widthAt(event.clientX));
        onDrag(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        if (event.key === "ArrowLeft") {
          commit(collapsed ? AGENT_DOCK_TABS_MIN_WIDTH : width + 24);
        } else {
          commit(width <= AGENT_DOCK_TABS_MIN_WIDTH ? 0 : width - 24);
        }
      }}
    >
      <span className="absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover/tabs-resize:bg-foreground/20 group-focus-visible/tabs-resize:bg-foreground/30" />
    </div>
  );
}

/**
 * The dock's tabs and controls as a vertical sidebar on the right edge, for
 * the right-hand placement. Open, chats are full rows like browser tabs;
 * collapsed, it narrows to an icon rail that stays beside the page.
 */
export function AgentDockTabSidebar({
  adapter,
  mode,
  composerHeight,
}: {
  adapter: AgentDockAdapter;
  mode: AgentDockMode;
  /** The chat composer's height, so the footer's divider lines up with it. */
  composerHeight: number | null;
}) {
  const dock = useAgentDock();
  const open = mode !== "collapsed";
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // The tabs narrow to the rail with the dock, or when dragged narrower than
  // their minimum while it's open.
  const rail =
    !open ||
    (dragWidth === null
      ? dock.tabsCollapsed
      : dragWidth < TABS_SNAP_WIDTH);
  const width = rail
    ? AGENT_DOCK_RAIL_WIDTH
    : clampAgentDockTabsWidth(dragWidth ?? dock.tabsWidth);
  const variant: TabVariant = rail ? "rail" : "row";
  const draftActive =
    open && dock.view === "chat" && dock.activeThreadId === null;
  const historyOpen = open && dock.view === "history";
  const iconButton = (
    label: string,
    shortcutKey: string,
    onClick: () => void,
    icon: ReactNode,
    pressed?: boolean,
  ) => (
    <PillButton
      type="button"
      variant="icon"
      size="compact"
      iconOnly
      label={label}
      shortcut={["alt", shortcutKey]}
      aria-pressed={pressed}
      className={cn(pressed && "bg-foreground/6 text-foreground")}
      onClick={onClick}
    >
      {icon}
    </PillButton>
  );
  const history = iconButton(
    "All chats",
    "h",
    () => (historyOpen ? dock.showChat() : dock.showHistory()),
    <Clock className="size-3.5" />,
    historyOpen,
  );
  const expand = iconButton(
    mode === "full" ? "Restore" : "Expand",
    "e",
    dock.toggleFull,
    mode === "full" ? (
      <Minimize2 className="size-3.5" />
    ) : (
      <Maximize2 className="size-3.5" />
    ),
  );
  const minimize = open
    ? iconButton("Minimize", "j", () => dock.setMode("collapsed"), (
        <X className="size-3.5" />
      ))
    : null;
  // Continues the composer's top border; its buttons sit on the send button's
  // line (the composer row is py-2).
  const composerFooter = (children: ReactNode) => (
    <div
      className={cn(
        "flex shrink-0 items-end gap-1 border-t border-border pt-1.5 pb-2",
        rail ? "justify-center" : "justify-end px-2",
      )}
      style={composerHeight ? { height: composerHeight } : undefined}
    >
      {children}
    </div>
  );

  return (
    <motion.div
      initial={false}
      animate={{ width }}
      transition={
        dragWidth === null
          ? { type: "spring", stiffness: 380, damping: 40, mass: 0.9 }
          : { duration: 0 }
      }
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden",
        open && "border-l border-border",
      )}
    >
      {open ? (
        <TabsResizeHandle
          collapsed={rail}
          width={width}
          onDrag={setDragWidth}
        />
      ) : null}
      {/* Its divider continues the page's top bar border (the card sits
          CARD_GAP below the top while the dock is open). */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-border",
          open ? "h-14 pt-2" : "h-12",
          rail ? "justify-center" : "px-2",
        )}
      >
        {rail ? (
          <ShortcutTooltip label={adapter.newChatLabel} keys={["alt", "n"]}>
            <button
              type="button"
              aria-label={adapter.newChatLabel}
              onClick={dock.newChat}
              className={cn(
                RAIL_ITEM_CLASS,
                "text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
              )}
            >
              <Plus className="size-3.5" />
            </button>
          </ShortcutTooltip>
        ) : (
          <>
            <ShortcutTooltip label={adapter.newChatLabel} keys={["alt", "n"]}>
              <button
                type="button"
                onClick={dock.newChat}
                className={cn(
                  ROW_ITEM_CLASS,
                  "min-w-0 flex-1 text-muted-foreground hover:bg-foreground/4 hover:text-foreground",
                )}
              >
                <Plus className="size-3.5 shrink-0" />
                <span className="truncate">{adapter.newChatLabel}</span>
              </button>
            </ShortcutTooltip>
          </>
        )}
      </div>
      <div
        role="tablist"
        aria-label="Open chats"
        aria-orientation="vertical"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2 scrollbar-hide",
          rail ? "items-center" : "px-2",
        )}
      >
        {draftActive ? (
          <TabButton
            active
            label="New chat"
            onSelect={dock.newChat}
            variant={variant}
          />
        ) : null}
        {dock.tabs.map((tab, index) => (
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
              position={index + 1}
              variant={variant}
            />
          </DockErrorBoundary>
        ))}
      </div>
      {/* Teammates on this page, filled by OperatorPresence for operators. */}
      <PresenceSlot
        collapsed={rail}
        className={cn(
          "flex max-h-[40%] min-h-0 shrink-0 border-t border-border py-1.5",
          rail
            ? "w-full justify-center [&>div]:flex-col [&>div]:overflow-y-auto"
            : "px-2 [&>div]:flex-wrap",
        )}
      />
      {!open ? (
        <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border py-1.5">
          {history}
          {expand}
        </div>
      ) : rail ? (
        <>
          {/* The rail is too narrow for a row, so only minimize sits on the
              composer's line. */}
          <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border py-1.5">
            {history}
            {expand}
          </div>
          {composerFooter(minimize)}
        </>
      ) : (
        composerFooter(
          <>
            {history}
            {expand}
            {minimize}
          </>,
        )
      )}
    </motion.div>
  );
}
