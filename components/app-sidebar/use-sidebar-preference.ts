"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  clampAppSidebarWidth,
  parseAppSidebarPreference,
  type AppSidebarPreference,
} from "@claritylabs-inc/ui/components/app-shell/app-shell-sidebar-layout";

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Restricted storage keeps the in-memory preference for this session.
  }
  for (const listener of listeners) listener();
}

/** Legacy "1" / "" values predate the `{ collapsed, width }` format. */
export function parseSidebarPreference(raw: string | null) {
  if (raw === "1" || raw === "") {
    return { ...parseAppSidebarPreference(null), collapsed: raw === "1" };
  }
  return parseAppSidebarPreference(raw);
}

/**
 * Sidebar collapse and width, read synchronously from storage so the shell
 * renders its final layout on the first client frame.
 */
export function useSidebarPreference(storageKey: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(storageKey),
    () => null,
  );
  const preference = useMemo(() => parseSidebarPreference(raw), [raw]);
  const update = useCallback(
    (next: (current: AppSidebarPreference) => AppSidebarPreference) => {
      write(
        storageKey,
        JSON.stringify(next(parseSidebarPreference(read(storageKey)))),
      );
    },
    [storageKey],
  );
  const toggleCollapse = useCallback(
    () => update((current) => ({ ...current, collapsed: !current.collapsed })),
    [update],
  );
  const setCollapsed = useCallback(
    (collapsed: boolean) => update((current) => ({ ...current, collapsed })),
    [update],
  );
  const setWidth = useCallback(
    (width: number) =>
      update((current) => ({ ...current, width: clampAppSidebarWidth(width) })),
    [update],
  );
  return { preference, toggleCollapse, setCollapsed, setWidth };
}
