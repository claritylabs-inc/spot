import {
  BadgeCheck,
  Building2,
  ClipboardCheck,
  FolderOpen,
  FileSearch,
  FileText,
  Users,
} from "lucide-react";
import { getPublicAgentDomain } from "@/lib/domains";
import type { NavItemConfig, NavShortcut } from "./types";

export const AGENT_DOMAIN = getPublicAgentDomain();

export {
  MENU_ITEM_BASE,
  MENU_ITEM_HOVER,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_INACTIVE,
  MENU_ITEM_INACTIVE_SUBTLE,
  SIDEBAR_TOOLTIP_DELAY_MS,
  SIDEBAR_TOOLTIP_SIDE_OFFSET,
  SIDEBAR_TOOLTIP_CLASS,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";

export const SHORTCUT_PREFIX_KEY = "g";
export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1500;

export function navShortcut(key: string): NavShortcut {
  return { key };
}

export function commandShortcut(key: string): NavShortcut {
  return { key, type: "command" };
}

export const INSURANCE_ITEMS: NavItemConfig[] = [
  {
    href: "/requests",
    label: "Requests",
    icon: FileSearch,
    shortcut: navShortcut("q"),
  },
  {
    href: "/policies",
    label: "Policies",
    icon: FileText,
    shortcut: navShortcut("p"),
  },
  {
    href: "/certificates",
    label: "Certificates",
    icon: BadgeCheck,
    shortcut: navShortcut("e"),
  },
  {
    href: "/files",
    label: "Files",
    icon: FolderOpen,
    shortcut: navShortcut("f"),
  },
  {
    href: "/compliance",
    label: "Compliance",
    icon: ClipboardCheck,
    shortcut: navShortcut("r"),
  },
];

export const CONNECT_ITEMS: NavItemConfig[] = [
  {
    href: "/connect/clients",
    label: "Clients",
    icon: Users,
    shortcut: navShortcut("l"),
  },
  {
    href: "/connect/vendors",
    label: "Vendors",
    icon: Building2,
    shortcut: navShortcut("v"),
  },
];

export const BROKER_NAV_ITEMS: NavItemConfig[] = [
  {
    href: "/broker",
    label: "Profile",
    icon: Building2,
    shortcut: navShortcut("p"),
  },
  {
    href: "/broker/team",
    label: "Team",
    icon: Users,
    shortcut: navShortcut("t"),
  },
];
