"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { motion } from "framer-motion";
import { SidebarNavItem } from "@claritylabs-inc/ui/components/app-shell/app-sidebar/nav-item";
import { cn } from "@/lib/utils";

export {
  SidebarTooltipProvider,
  SidebarSectionLabel as SectionHeader,
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
