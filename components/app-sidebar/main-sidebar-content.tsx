"use client";

import { Bell, LogOut, MessageSquare, Settings, User } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { commandShortcut, navShortcut } from "./nav-config";
import { SidebarMenuItem, SectionHeader } from "./nav-item";
import { SidebarHeader } from "./sidebar-header";
import type { NavItemConfig } from "./types";
import { typeStyle } from "@/lib/typography";

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
  notificationsPanelOpen,
  unreadCount,
  isDesktop,
  orgId,
  onToggleCollapse,
  onToggleNotifications,
  onCloseNotifications,
  onAskSpot,
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
  notificationsPanelOpen: boolean;
  unreadCount?: number;
  isDesktop: boolean;
  orgId?: Id<"organizations">;
  onToggleCollapse: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  onAskSpot?: () => void;
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
        {onAskSpot ? (
          <SidebarMenuItem
            onClick={onAskSpot}
            label="Ask Spot"
            icon={MessageSquare}
            active={false}
            collapsed={collapsed}
            shortcut={commandShortcut("j")}
          />
        ) : null}
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
