"use client";

import Link from "next/link";
import { Bell, ChevronUp, LogOut, MessageSquare, Settings, User } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { NotificationsPanel } from "@/components/notifications-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import {
  commandShortcut,
  MENU_ITEM_BASE,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_INACTIVE,
} from "./nav-config";
import { cn } from "@/lib/utils";
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

      <div className="border-t border-border px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account"
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5",
              MENU_ITEM_BASE,
              typeStyle("body.default"),
              collapsed && "justify-center",
              isActive("/profile") || (canManageSettings && isActive("/settings"))
                ? MENU_ITEM_ACTIVE
                : MENU_ITEM_INACTIVE,
            )}
          >
            <User className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Account</span>
                <ChevronUp className="size-3.5 shrink-0" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-48">
            <DropdownMenuItem render={<Link href="/profile" />}>
              <User />
              Profile
              <DropdownMenuShortcut>G U</DropdownMenuShortcut>
            </DropdownMenuItem>
            {canManageSettings && (
              <DropdownMenuItem render={<Link href="/settings" />}>
                <Settings />
                Settings
                <DropdownMenuShortcut>G S</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
