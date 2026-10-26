"use client";

import type { ComponentProps } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
} from "@claritylabs-inc/ui/components/tabs";
import { useAppShellSlotClaim } from "@/components/app-shell-slots";
import { cn } from "@/lib/utils";

/*
 * Page-level folder tabs sit flush under the shell top bar. The shell content
 * area pads its children by 1.5rem (2rem from lg), so the rail bleeds through
 * that padding; the shared rail's own inset plus tab padding puts the first
 * label at the top bar's gutter. Geometry and colors stay in the shared Tabs
 * primitive.
 */

/** Root for a page whose first element is the rail; the shell top bar blends into it while mounted. */
export function PageTabs({ className, ...props }: ComponentProps<typeof Tabs>) {
  useAppShellSlotClaim("folderRail");
  return (
    <Tabs className={cn("gap-0 -mx-6 -mt-6 lg:-mx-8", className)} {...props} />
  );
}

export function PageTabsList(
  props: Omit<ComponentProps<typeof TabsList>, "variant">,
) {
  return <TabsList variant="folder" {...props} />;
}

/** A selected view's body at the shell gutters. */
export function PageTabsPanel({
  className,
  ...props
}: ComponentProps<typeof TabsContent>) {
  return (
    <TabsContent className={cn("px-6 py-6 lg:px-8", className)} {...props} />
  );
}

/**
 * A rail and panel for field groups inside a page or drawer: one bordered
 * sheet so the rail never floats in whitespace.
 */
export function SectionTabs({
  className,
  ...props
}: ComponentProps<typeof Tabs>) {
  return (
    <Tabs
      className={cn(
        "gap-0 overflow-hidden rounded-lg border border-border",
        className,
      )}
      {...props}
    />
  );
}

export function SectionTabsList(
  props: Omit<ComponentProps<typeof TabsList>, "variant">,
) {
  return <TabsList variant="folder" {...props} />;
}

export function SectionTabsPanel({
  className,
  ...props
}: ComponentProps<typeof TabsContent>) {
  return <TabsContent className={cn("p-4", className)} {...props} />;
}
