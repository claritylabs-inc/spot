"use client";

import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";

import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

/** A key in a shortcut: a named key below, or the literal character (`"h"`, `"/"`). */
export type ShortcutKey = "mod" | "alt" | "shift" | "ctrl" | "enter" | "tab" | "esc" | (string & {});

const MAC_KEYS: Record<string, string> = {
  mod: "⌘",
  alt: "⌥",
  shift: "⇧",
  ctrl: "⌃",
  enter: "↵",
  tab: "⇥ Tab",
  esc: "Esc",
};
const OTHER_KEYS: Record<string, string> = {
  ...MAC_KEYS,
  mod: "Ctrl",
  alt: "Alt",
  ctrl: "Ctrl",
};

function isMac() {
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Whether keys should use Mac symbols; Mac is assumed until the client renders. */
export function useMacKeys() {
  return useSyncExternalStore(
    () => () => {},
    isMac,
    () => true,
  );
}

function keyLabel(key: ShortcutKey, mac: boolean) {
  return (mac ? MAC_KEYS : OTHER_KEYS)[key] ?? key.toUpperCase();
}

/** The `aria-keyshortcuts` value for a shortcut, e.g. `Meta+Enter`. */
export function ariaKeyShortcut(keys: ShortcutKey[], mac: boolean) {
  const names: Record<string, string> = {
    mod: mac ? "Meta" : "Control",
    alt: "Alt",
    shift: "Shift",
    ctrl: "Control",
    enter: "Enter",
    tab: "Tab",
    esc: "Escape",
  };
  return keys.map((key) => names[key] ?? key.toUpperCase()).join("+");
}

/**
 * Keyboard shortcut keycaps in mono, with platform symbols (⌘ ⌥ ⇧ ↵ ⇥). Colors
 * follow the surrounding text, so they read on surfaces and in dark tooltips.
 */
export function Kbd({ keys, className }: { keys: ShortcutKey[]; className?: string }) {
  const mac = useMacKeys();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)}>
      {keys.map((key) => (
        <kbd
          key={key}
          data-slot="kbd"
          className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-current/20 px-1 pt-px opacity-80 ${typeStyle("technical.shortcut")}`}
        >
          {keyLabel(key, mac)}
        </kbd>
      ))}
    </span>
  );
}

/** Wraps a control in a tooltip that names it and shows its shortcut. */
export function ShortcutTooltip({
  label,
  keys,
  children,
}: {
  label: ReactNode;
  keys: ShortcutKey[];
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        {label}
        <Kbd keys={keys} />
      </TooltipContent>
    </Tooltip>
  );
}
