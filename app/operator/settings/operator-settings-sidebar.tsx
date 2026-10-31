"use client";

import { useSearchParams } from "next/navigation";
import { Bell, BookOpenText, Mail, Settings, Users } from "lucide-react";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import {
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";

export function OperatorSettingsSidebar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const param = useSearchParams().get("section");
  const section =
    param === "team" ||
    param === "notifications" ||
    param === "email" ||
    param === "skills"
      ? param
      : "general";
  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Settings"
        onToggleCollapse={onToggleCollapse}
        backHref="/operator/clients"
        homeHref="/operator/clients"
      />
      <div className="space-y-1 p-2">
        <SidebarMenuItem
          href="/operator/settings"
          icon={Settings}
          label="General"
          active={section === "general"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/settings?section=team"
          icon={Users}
          label="Team"
          active={section === "team"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/settings?section=email"
          icon={Mail}
          label="Email"
          active={section === "email"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/settings?section=skills"
          icon={BookOpenText}
          label="Skills"
          active={section === "skills"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/settings?section=notifications"
          icon={Bell}
          label="Notifications"
          active={section === "notifications"}
          collapsed={collapsed}
        />
      </div>
    </SidebarTooltipProvider>
  );
}
