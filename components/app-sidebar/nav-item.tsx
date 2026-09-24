"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { SidebarNavItem } from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";
import {
  MENU_ITEM_ACTIVE,
  SIDEBAR_TOOLTIP_CLASS,
  SIDEBAR_TOOLTIP_SIDE_OFFSET,
} from "./nav-config";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

export {
  SidebarTooltipProvider,
  SidebarSectionLabel as SectionHeader,
  ShortcutTooltipContent,
  stableSidebarTooltipId,
  platformModifierForUserAgent,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";

export function SidebarMenuItem(props: ComponentProps<typeof SidebarNavItem>) {
  if (props.href !== undefined) {
    return <SidebarNavItem {...props} render={<Link href={props.href} />} />;
  }
  return <SidebarNavItem {...props} />;
}

export function SidebarHeaderLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PillButton
            href={href}
            size="compact"
            variant="icon"
            label={label}
            title=""
            aria-current={active ? "page" : undefined}
            className={active ? MENU_ITEM_ACTIVE : undefined}
          >
            <Icon className="size-3.5" />
          </PillButton>
        }
      />
      <TooltipContent
        side="right"
        align="center"
        sideOffset={SIDEBAR_TOOLTIP_SIDE_OFFSET}
        className={SIDEBAR_TOOLTIP_CLASS}
      >
        <span className={typeStyle("caption.default")}>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
