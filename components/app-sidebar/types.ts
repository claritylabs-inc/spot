import type React from "react";

import type { NavShortcut } from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";
export type { NavShortcut } from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";

export type NavItemConfig = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: NavShortcut;
};
