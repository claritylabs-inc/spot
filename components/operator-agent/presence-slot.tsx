"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Slot = { element: HTMLElement; collapsed: boolean } | null;

// The newest mounted slot is used; when it goes, the one underneath returns.
let slots: NonNullable<Slot>[] = [];
let slot: Slot = null;
const listeners = new Set<() => void>();

function updateSlots(next: NonNullable<Slot>[]) {
  slots = next;
  slot = slots.at(-1) ?? null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Where the dock bar shows who else is here; null where there is none. */
export function usePresenceSlot() {
  return useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  );
}

/**
 * The AI dock bar's place for multiplayer: teammates' avatars and follow
 * pills, drawn by `OperatorPresence`. The bar shows on every operator page, so
 * the area stays put across navigation. `collapsed` (mobile) drops pill text.
 * Hidden while empty.
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
    const entry = { element, collapsed };
    updateSlots([...slots, entry]);
    return () => updateSlots(slots.filter((other) => other !== entry));
  }, [element, collapsed]);
  return <div ref={setElement} className={cn("empty:hidden", className)} />;
}
