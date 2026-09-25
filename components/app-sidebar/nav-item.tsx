"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { motion } from "framer-motion";
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
import { cn } from "@/lib/utils";

export {
  SidebarTooltipProvider,
  SidebarSectionLabel as SectionHeader,
  ShortcutTooltipContent,
  stableSidebarTooltipId,
  platformModifierForUserAgent,
} from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";

/** Link items share a sliding active indicator within their menu. */
export function SidebarMenuItem(props: ComponentProps<typeof SidebarNavItem>) {
  if (props.href === undefined) return <SidebarNavItem {...props} />;
  return (
    <div className="relative">
      {props.active ? (
        <motion.span
          layoutId="sidebar-active-item"
          aria-hidden="true"
          transition={{ type: "spring", stiffness: 560, damping: 44 }}
          className="absolute inset-0 rounded-md bg-foreground/6 dark:bg-foreground/10"
        />
      ) : null}
      <SidebarNavItem
        {...props}
        className={cn(
          "relative",
          props.active && "bg-transparent! dark:bg-transparent!",
          props.className,
        )}
        render={<Link href={props.href} />}
      />
    </div>
  );
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
