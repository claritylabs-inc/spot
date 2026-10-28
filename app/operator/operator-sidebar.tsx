"use client";

import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Building2,
  FileSearch,
  History,
  Inbox,
  LogOut,
  MessageSquare,
  Settings,
  Radio,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import {
  SectionHeader,
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import { commandShortcut } from "@/components/app-sidebar/nav-config";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { InboxUnreadBadge } from "@/components/inbox/inbox-unread-badge";
import { useOptionalAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { LogoIcon } from "@/components/ui/logo-icon";
import type { OperatorNavSection } from "@/lib/app-shell-routes";

export function OperatorSidebar({
  collapsed,
  onToggleCollapse,
  active,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active: OperatorNavSection | null;
}) {
  const { signOut } = useAuthActions();
  const dock = useOptionalAgentDock();

  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Operator"
        onToggleCollapse={onToggleCollapse}
        icon={<LogoIcon size={15} />}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-2 py-2">
          {dock ? (
            <SidebarMenuItem
              onClick={dock.newChat}
              label="Ask Spot"
              icon={MessageSquare}
              active={false}
              collapsed={collapsed}
              shortcut={commandShortcut("j")}
            />
          ) : null}
          <SidebarMenuItem
            href="/operator/team"
            label="Team"
            icon={UsersRound}
            active={active === "team"}
            collapsed={collapsed}
          />
          <SectionHeader label="Accounts" collapsed={collapsed} />
          <div className="flex flex-col gap-1">
            <SidebarMenuItem
              href="/operator/inbox"
              label="Inbox"
              icon={Inbox}
              active={active === "inbox"}
              collapsed={collapsed}
              trailing={<InboxUnreadBadge collapsed={collapsed} />}
            />
            <SidebarMenuItem
              href="/operator/clients"
              label="Clients"
              icon={Users}
              active={active === "clients"}
              collapsed={collapsed}
            />
            <SidebarMenuItem
              href="/operator/procurement"
              label="Procurement"
              icon={FileSearch}
              active={active === "procurement"}
              collapsed={collapsed}
            />
            <SidebarMenuItem
              href="/operator/brokers"
              label="Insurance providers"
              icon={Building2}
              active={active === "brokers"}
              collapsed={collapsed}
            />
          </div>
          <SectionHeader label="DevOps" collapsed={collapsed} />
          <div className="flex flex-col gap-1">
            <SidebarMenuItem
              href="/operator/channels"
              label="Channels"
              icon={Radio}
              active={active === "channels"}
              collapsed={collapsed}
            />
            <SidebarMenuItem
              href="/operator/audit"
              label="Audit log"
              icon={History}
              active={active === "audit"}
              collapsed={collapsed}
            />
          </div>
        </div>
      </ScrollArea>
      <div className="space-y-0.5 border-t border-border px-2 py-2">
        <SidebarMenuItem
          href="/operator/settings"
          label="Settings"
          icon={Settings}
          active={active === "settings"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/profile"
          label="Profile"
          icon={User}
          active={active === "profile"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          onClick={() => void signOut()}
          label="Sign out"
          icon={LogOut}
          active={false}
          collapsed={collapsed}
        />
      </div>
    </SidebarTooltipProvider>
  );
}
