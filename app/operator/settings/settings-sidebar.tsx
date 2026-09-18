"use client";

import { Settings, Route, Radio, Plug } from "lucide-react";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import {
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";

const sections = [
  { id: "general", label: "General", icon: Settings },
  { id: "models", label: "Model overrides", icon: Route },
  { id: "mcp", label: "MCP connections", icon: Plug },
  { id: "channels", label: "Channels", icon: Radio },
] as const;

export function OperatorSettingsSidebar({
  collapsed,
  onToggleCollapse,
  active,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active: (typeof sections)[number]["id"];
}) {
  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Settings"
        onToggleCollapse={onToggleCollapse}
        backHref="/operator/threads"
      />
      <nav className="space-y-1 p-2" aria-label="Settings">
        {sections.map(({ id, label, icon }) => (
          <SidebarMenuItem
            key={id}
            href={
              id === "general"
                ? "/operator/settings"
                : `/operator/settings?section=${id}`
            }
            icon={icon}
            label={label}
            active={active === id}
            collapsed={collapsed}
          />
        ))}
      </nav>
    </SidebarTooltipProvider>
  );
}
