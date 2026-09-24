import {
  Building2,
  FileBadge2,
  FlaskConical,
  Mail,
  Network,
  Users,
} from "lucide-react";
import { createElement, type ComponentType } from "react";
import { LogoIcon } from "@/components/ui/logo-icon";

export type SettingsPageId =
  | "organization"
  | "team"
  | "agent"
  | "workflows"
  | "integrations"
  | "mailboxes"
  | "beta";

export type SettingsTabId =
  | "overview"
  | "team"
  | "behavior"
  | "channels"
  | "wiki"
  | "certificates"
  | "notifications"
  | "mailboxes"
  | "integrations"
  | "beta";

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
};

export type SettingsPage = {
  id: SettingsPageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  tabs: SettingsTab[];
};

export type SettingsNavGroup = {
  label: string;
  pages: SettingsPage[];
};

function SpotStarIcon({ className }: { className?: string }) {
  return createElement(LogoIcon, { size: 16, className });
}

export function getSettingsNavigation({
  isStandaloneClient,
}: {
  isStandaloneClient: boolean;
}): SettingsNavGroup[] {
  const pages: SettingsPage[] = [
    {
      id: "organization",
      label: "Organization",
      icon: Building2,
      tabs: [{ id: "overview", label: "Overview" }],
    },
    {
      id: "team",
      label: "Team",
      icon: Users,
      tabs: [{ id: "team", label: "Team" }],
    },
    {
      id: "agent",
      label: "Agent",
      icon: SpotStarIcon,
      tabs: [
        { id: "channels", label: "Channels" },
        ...(isStandaloneClient
          ? [{ id: "behavior" as const, label: "Behavior" }]
          : []),
        { id: "wiki", label: "Company wiki" },
      ],
    },
    {
      id: "workflows",
      label: "Workflows",
      icon: FileBadge2,
      tabs: [
        { id: "certificates", label: "Certificates" },
        { id: "notifications", label: "Notifications" },
      ],
    },
    {
      id: "integrations",
      label: "Integrations",
      icon: Network,
      tabs: [{ id: "integrations", label: "Integrations" }],
    },
    {
      id: "mailboxes",
      label: "Mailboxes",
      icon: Mail,
      tabs: [{ id: "mailboxes", label: "Mailboxes" }],
    },
    {
      id: "beta",
      label: "Beta",
      icon: FlaskConical,
      tabs: [{ id: "beta", label: "Beta" }],
    },
  ];

  const page = (id: SettingsPageId) => pages.find((item) => item.id === id)!;
  return [
    { label: "Workspace", pages: [page("organization"), page("team")] },
    { label: "Spot", pages: [page("agent"), page("workflows")] },
    {
      label: "Connections",
      pages: [page("integrations"), page("mailboxes")],
    },
    { label: "Advanced", pages: [page("beta")] },
  ];
}

export function settingsPages(groups: SettingsNavGroup[]) {
  return groups.flatMap((group) => group.pages);
}

export function resolveSettingsDestination({
  requestedSection,
  requestedTab,
  groups,
}: {
  requestedSection: string | null;
  requestedTab: string | null;
  groups: SettingsNavGroup[];
}) {
  const pages = settingsPages(groups);
  const page = pages.find((item) => item.id === requestedSection) ?? pages[0];
  const tab = page.tabs.find((item) => item.id === requestedTab) ?? page.tabs[0];
  return { section: page.id, tab: tab.id, page };
}
