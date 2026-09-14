"use client";

import Link from "next/link";
import {
  Archive,
  Bell,
  List,
  LogOut,
  Mail,
  LockKeyhole,
  MessageCircle,
  MessageSquare,
  Pin,
  Plus,
  Settings,
  User,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import type { Id } from "@/convex/_generated/dataModel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
  MENU_ITEM_INACTIVE_SUBTLE,
  commandShortcut,
  navShortcut,
  SIDEBAR_TOOLTIP_CLASS,
  SIDEBAR_TOOLTIP_SIDE_OFFSET,
} from "./nav-config";
import {
  SidebarMenuItem,
  SidebarHeaderLink,
  SectionHeader,
  ShortcutTooltipContent,
  stableSidebarTooltipId,
} from "./nav-item";
import { SidebarHeader } from "./sidebar-header";
import { SidebarThreadArchiveAction } from "./sidebar-thread-archive-action";
import type { ConversationItem, NavItemConfig } from "./types";
import { typeStyle } from "@/lib/typography";

function isImessageConversation(item: ConversationItem) {
  return item.kind === "imessage";
}

export function MainSidebarContent({
  collapsed,
  isBroker,
  canManageSettings,
  pathname,
  headerOrgIcon,
  viewerImage,
  initials,
  headerOrgName,
  navItems,
  connectItems,
  disablePersistentChat,
  notificationsPanelOpen,
  unreadCount,
  isDesktop,
  orgId,
  agentConversations,
  pinnedConversations,
  archivedThreadCount,
  onToggleCollapse,
  onToggleNotifications,
  onCloseNotifications,
  onAskSpot,
  onArchiveThread,
  onSignOut,
}: {
  collapsed: boolean;
  isBroker: boolean;
  canManageSettings: boolean;
  pathname: string;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  navItems: NavItemConfig[];
  connectItems: NavItemConfig[];
  disablePersistentChat: boolean;
  notificationsPanelOpen: boolean;
  unreadCount?: number;
  isDesktop: boolean;
  orgId?: Id<"organizations">;
  agentConversations: ConversationItem[];
  pinnedConversations: ConversationItem[];
  archivedThreadCount: number;
  onToggleCollapse: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  onAskSpot?: () => void;
  onArchiveThread: (threadId: string, active: boolean) => Promise<void>;
  onSignOut: () => void;
}) {
  function isActive(href: string) {
    if (href === "/" || href === "/broker") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        collapsed={collapsed}
        headerOrgIcon={headerOrgIcon}
        viewerImage={viewerImage}
        initials={initials}
        headerOrgName={headerOrgName}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="relative px-2 py-2 border-b border-border">
        <SidebarMenuItem
          onClick={onToggleNotifications}
          label="Notifications"
          icon={Bell}
          active={notificationsPanelOpen}
          collapsed={collapsed}
          ariaPressed={notificationsPanelOpen}
          trailing={
            (unreadCount ?? 0) > 0 ? (
              <span
                className={`flex items-center justify-center rounded-full bg-blue-500 text-white shrink-0 ${typeStyle("caption.medium")} ${
                  collapsed ? "w-4 h-4" : "min-w-4.5 h-4 px-1"
                }`}
              >
                {unreadCount! > 99 ? "99+" : unreadCount}
              </span>
            ) : null
          }
        />
        {notificationsPanelOpen && !isDesktop && orgId && (
          <NotificationsPanel orgId={orgId} onClose={onCloseNotifications} />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        <SectionHeader
          label={isBroker ? "Partner" : "Insurance"}
          collapsed={collapsed}
        />
        {navItems.map((item) => (
          <SidebarMenuItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isActive(item.href)}
            collapsed={collapsed}
            shortcut={item.shortcut ?? undefined}
          />
        ))}

        {connectItems.length > 0 ? (
          <>
            <SectionHeader label="Connect" collapsed={collapsed} />
            {connectItems.map((item) => (
              <SidebarMenuItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(item.href)}
                collapsed={collapsed}
                shortcut={item.shortcut ?? undefined}
              />
            ))}
          </>
        ) : null}

        {!disablePersistentChat ? (
          !collapsed ? (
            <ExpandedThreadList
              agentConversations={agentConversations}
              pinnedConversations={pinnedConversations}
              archivedThreadCount={archivedThreadCount}
              pathname={pathname}
              onAskSpot={onAskSpot}
              onArchiveThread={onArchiveThread}
            />
          ) : (
            <CollapsedThreadList
              agentConversations={agentConversations}
              pinnedConversations={pinnedConversations}
              archivedThreadCount={archivedThreadCount}
              pathname={pathname}
              onAskSpot={onAskSpot}
            />
          )
        ) : null}
      </nav>

      <div className="border-t border-border px-2 py-2 space-y-0.5">
        {canManageSettings ? (
          <SidebarMenuItem
            href="/settings"
            label="Settings"
            icon={Settings}
            active={isActive("/settings")}
            collapsed={collapsed}
            shortcut={navShortcut("s")}
          />
        ) : null}
        <SidebarMenuItem
          href="/profile"
          label="Profile"
          icon={User}
          active={isActive("/profile")}
          collapsed={collapsed}
          shortcut={navShortcut("u")}
        />
        <SidebarMenuItem
          onClick={onSignOut}
          label="Sign out"
          icon={LogOut}
          active={false}
          collapsed={collapsed}
        />
      </div>
    </div>
  );
}

function ExpandedThreadList({
  agentConversations,
  pinnedConversations,
  archivedThreadCount,
  pathname,
  onAskSpot,
  onArchiveThread,
}: {
  agentConversations: ConversationItem[];
  pinnedConversations: ConversationItem[];
  archivedThreadCount: number;
  pathname: string;
  onAskSpot?: () => void;
  onArchiveThread: (threadId: string, active: boolean) => Promise<void>;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3 pb-1.5 pt-5">
        <span
          className={`text-muted-foreground/50 ${typeStyle("caption.medium")}`}
        >
          Threads
        </span>
        <div className="flex items-center gap-1">
          <SidebarHeaderLink
            href="/agent/threads"
            label="All threads"
            icon={List}
            active={pathname === "/agent/threads"}
          />
          {onAskSpot ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <PillButton
                    type="button"
                    size="compact"
                    variant="icon"
                    label="New Chat"
                    title=""
                    onClick={onAskSpot}
                  >
                    <Plus className="size-3.5" />
                  </PillButton>
                }
              />
              <TooltipContent
                side="right"
                align="center"
                sideOffset={SIDEBAR_TOOLTIP_SIDE_OFFSET}
                className={SIDEBAR_TOOLTIP_CLASS}
              >
                <ShortcutTooltipContent
                  label="New Chat"
                  shortcut={commandShortcut("k")}
                />
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {pinnedConversations.map((item, idx) => (
        <SidebarThreadRow
          key={`${item.kind}-${item.id}`}
          item={item}
          pathname={pathname}
          pinned
          shortcut={idx < 9 ? navShortcut(String(idx + 1)) : undefined}
          shortcutLabel="pinned thread"
        />
      ))}
      {agentConversations.map((item, idx) => (
        <SidebarThreadRow
          key={`${item.kind}-${item.id}`}
          item={item}
          pathname={pathname}
          shortcut={
            pinnedConversations.length + idx < 9
              ? navShortcut(String(pinnedConversations.length + idx + 1))
              : undefined
          }
          shortcutLabel="thread"
          onArchiveThread={onArchiveThread}
        />
      ))}
      {archivedThreadCount > 0 ? (
        <SidebarMenuItem
          href="/agent/archive"
          label="Archived"
          icon={Archive}
          active={pathname === "/agent/archive"}
          collapsed={false}
        />
      ) : null}
    </>
  );
}

function SidebarThreadRow({
  item,
  pathname,
  shortcut,
  shortcutLabel,
  pinned,
  onArchiveThread,
}: {
  item: ConversationItem;
  pathname: string;
  shortcut?: ReturnType<typeof navShortcut>;
  shortcutLabel: string;
  pinned?: boolean;
  onArchiveThread?: (threadId: string, active: boolean) => Promise<void>;
}) {
  const isConvActive = pathname === `/agent/thread/${item.id}`;
  const threadLink = (
    <Link
      href={`/agent/thread/${item.id}`}
      id={
        shortcut ? stableSidebarTooltipId(`${item.kind}-${item.id}`) : undefined
      }
      className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} ${typeStyle("control.button")} ${
        isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
      }`}
    >
      {isImessageConversation(item) ? (
        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
      ) : item.kind === "slack" ? (
        <SiSlack className="w-3.5 h-3.5 shrink-0" />
      ) : item.kind === "email" ? (
        <Mail className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {item.kind === "slack" && item.isPrivate ? (
        <LockKeyhole
          className="w-3 h-3 shrink-0 text-muted-foreground/35"
          aria-label="Private Slack thread"
        />
      ) : null}
      {pinned ? (
        <Pin className="w-3 h-3 shrink-0 rotate-45 text-muted-foreground/35" />
      ) : null}
      {onArchiveThread ? (
        <SidebarThreadArchiveAction
          onArchive={() => onArchiveThread(item.id, isConvActive)}
        />
      ) : null}
    </Link>
  );

  if (!shortcut) return <div>{threadLink}</div>;

  return (
    <Tooltip>
      <TooltipTrigger render={threadLink} />
      <TooltipContent
        side="right"
        align="center"
        sideOffset={SIDEBAR_TOOLTIP_SIDE_OFFSET}
        className={SIDEBAR_TOOLTIP_CLASS}
      >
        <ShortcutTooltipContent label={shortcutLabel} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function CollapsedThreadList({
  agentConversations,
  pinnedConversations,
  archivedThreadCount,
  pathname,
  onAskSpot,
}: {
  agentConversations: ConversationItem[];
  pinnedConversations: ConversationItem[];
  archivedThreadCount: number;
  pathname: string;
  onAskSpot?: () => void;
}) {
  return (
    <>
      <div className="pt-4 pb-1" />
      {pinnedConversations.map((item) => {
        const isConvActive = pathname === `/agent/thread/${item.id}`;
        return (
          <Link
            key={`${item.kind}-${item.id}`}
            href={`/agent/thread/${item.id}`}
            title={`${item.label}${item.isPrivate ? " (Private)" : ""}`}
            className={`flex items-center justify-center py-1.5 ${MENU_ITEM_BASE} ${
              isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE_SUBTLE
            }`}
          >
            {isImessageConversation(item) ? (
              <MessageCircle className="w-3.5 h-3.5" />
            ) : (
              <SiSlack className="w-3.5 h-3.5" />
            )}
          </Link>
        );
      })}
      {agentConversations.length > 0 && pinnedConversations.length > 0 ? (
        <div className="mx-4 my-1 h-px bg-foreground/6" aria-hidden="true" />
      ) : null}
      {agentConversations.map((item) => {
        const isConvActive = pathname === `/agent/thread/${item.id}`;
        return (
          <Link
            key={`${item.kind}-${item.id}`}
            href={`/agent/thread/${item.id}`}
            title={item.label}
            className={`flex items-center justify-center py-1.5 ${MENU_ITEM_BASE} ${
              isConvActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE_SUBTLE
            }`}
          >
            {isImessageConversation(item) ? (
              <MessageCircle className="w-3.5 h-3.5" />
            ) : item.kind === "slack" ? (
              <SiSlack className="w-3.5 h-3.5" />
            ) : item.kind === "email" ? (
              <Mail className="w-3.5 h-3.5" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5" />
            )}
          </Link>
        );
      })}
      <SidebarMenuItem
        href="/agent/threads"
        label="All threads"
        icon={MessageSquare}
        active={pathname === "/agent/threads"}
        collapsed
      />
      {onAskSpot ? (
        <SidebarMenuItem
          onClick={onAskSpot}
          label="New Chat"
          icon={Plus}
          active={false}
          collapsed
          shortcut={commandShortcut("k")}
        />
      ) : null}
      {archivedThreadCount > 0 ? (
        <SidebarMenuItem
          href="/agent/archive"
          label="Archived"
          icon={Archive}
          active={pathname === "/agent/archive"}
          collapsed
        />
      ) : null}
    </>
  );
}
