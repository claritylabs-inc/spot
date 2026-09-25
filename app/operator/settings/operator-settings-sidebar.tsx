"use client";

import { useSearchParams } from "next/navigation";
import { Settings, Users } from "lucide-react";
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
  const section =
    useSearchParams().get("section") === "team" ? "team" : "general";
  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Settings"
        onToggleCollapse={onToggleCollapse}
        backHref="/operator/clients"
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
      </div>
    </SidebarTooltipProvider>
  );
}
