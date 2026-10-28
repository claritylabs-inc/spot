"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Slot = { element: HTMLElement; collapsed: boolean } | null;

let slot: Slot = null;
const listeners = new Set<() => void>();

function setSlot(next: Slot) {
  slot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Where the sidebar shows who else is here; null on pages without one. */
export function usePresenceSlot() {
  return useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  );
}

/**
 * The sidebar's place for multiplayer: teammates' avatars, the follow pill and
 * the private and followed markers, drawn by `OperatorPresence`. Hidden while
 * empty.
 */
export function PresenceSlot({
  collapsed,
  className,
}: {
  collapsed: boolean;
  className?: string;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    setSlot({ element, collapsed });
    return () => {
      if (slot?.element === element) setSlot(null);
    };
  }, [element, collapsed]);
  return <div ref={setElement} className={cn("empty:hidden", className)} />;
}
