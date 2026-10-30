"use client";

import type { ComponentProps } from "react";
import { Tabs, TabsList } from "@claritylabs-inc/ui/components/tabs";
import { AppShellPortal } from "@/components/app-shell-slots";
import { cn } from "@/lib/utils";

/*
 * Page-level tabs live in the shell top bar, to the right of the breadcrumb.
 * `PageTabsList` portals a shared `navbar` list into the bar's tabs target;
 * the Tabs root keeps Base UI context for the page's panels. Geometry,
 * alignment and narrow-width stacking belong to the shared top bar and tabs.
 */

export function PageTabs({ className, ...props }: ComponentProps<typeof Tabs>) {
  return <Tabs className={cn("gap-0", className)} {...props} />;
}

/** The page's tab list, rendered in the top bar. Mount it once per page. */
export function PageTabsList(
  props: Omit<ComponentProps<typeof TabsList>, "variant">,
) {
  return (
    <AppShellPortal slot="folderRail">
      <TabsList variant="navbar" {...props} />
    </AppShellPortal>
  );
}

/** Tabs that only provide context (the body is ordinary page content): the root renders no box, so it adds no spacing. */
export function PageTabsRail({
  className,
  ...props
}: ComponentProps<typeof Tabs>) {
  return <PageTabs className={cn("contents", className)} {...props} />;
}

/** A local tab list for field groups inside a page or drawer. Never claims the top bar. */
export function SectionTabs({
  className,
  ...props
}: ComponentProps<typeof Tabs>) {
  return <Tabs className={cn("gap-0", className)} {...props} />;
}

export function SectionTabsList(
  props: Omit<ComponentProps<typeof TabsList>, "variant">,
) {
  return <TabsList variant="folder" {...props} />;
}

/**
 * Tabs for a drawer's own views, passed as `SettingsDrawer` `tabs`. The
 * drawer header lays them out like the page top bar: beside the title when
 * there is room, on their own row under it when narrow.
 */
export function DrawerTabs({
  className,
  ...props
}: ComponentProps<typeof Tabs>) {
  return <Tabs className={cn("gap-0", className)} {...props} />;
}

export function DrawerTabsList(
  props: Omit<ComponentProps<typeof TabsList>, "variant">,
) {
  return <TabsList variant="navbar" {...props} />;
}
