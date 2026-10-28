"use client";

import { useSyncExternalStore } from "react";

// The app card's width, published by the agent dock layout. Null until it
// mounts, when the viewport stands in.
let appWidth: number | null = null;
const listeners = new Set<() => void>();

export function setAppContainerWidth(width: number | null) {
  if (width === appWidth) return;
  appWidth = width;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("resize", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("resize", listener);
  };
}

/**
 * Whether the app card is at least `minWidth` pixels wide: the JavaScript
 * counterpart of the container-based `sm:`/`md:`/`lg:` breakpoints.
 */
export function useAppMinWidth(minWidth: number) {
  return useSyncExternalStore(
    subscribe,
    () => (appWidth ?? window.innerWidth) >= minWidth,
    () => false,
  );
}
