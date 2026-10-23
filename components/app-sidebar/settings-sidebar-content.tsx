"use client";

import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { getSettingsNavigation } from "@/lib/settings-sections";
import { SectionHeader, SidebarMenuItem } from "./nav-item";
import { SidebarHeader } from "./sidebar-header";

export function SettingsSidebarContent({
  collapsed,
  isStandaloneClient,
  activeSettingsSection,
  onToggleCollapse,
}: {
  collapsed: boolean;
  isStandaloneClient: boolean;
  activeSettingsSection: string;
  onToggleCollapse: () => void;
}) {
  const groups = getSettingsNavigation({ isStandaloneClient });

  return (
    <div className="flex flex-col h-full">
      <SidebarHeader
        collapsed={collapsed}
        headerOrgName=""
        initials=""
        onToggleCollapse={onToggleCollapse}
        backHref="/"
      />

      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-0.5 px-2 py-2">
          {groups.map((group) => (
            <div key={group.label}>
              <SectionHeader label={group.label} collapsed={collapsed} />
              {group.pages.map((item) => (
                <SidebarMenuItem
                  key={item.id}
                  href={`/settings?section=${item.id}`}
                  label={item.label}
                  icon={item.icon}
                  active={item.id === activeSettingsSection}
                  collapsed={collapsed}
                />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}
