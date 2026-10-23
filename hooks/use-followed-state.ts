"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * UI state that teammates following this operator see too.
 *
 * `useFollowedState` is a drop-in `useState` for anything that changes what is
 * on screen without changing the URL: open panels, drawers, dialogs, tabs,
 * filters, expanded rows. While someone follows this operator, mounted values
 * that differ from their initial value are published whenever they change; a
 * follower renders the leader's value for the same key (or the initial value
 * when the leader sent none) instead of their own, and keeps it when they stop.
 * Store ids and small enums, not records: the follower has the same data.
 *
 * Keys must be stable across browsers and unique among mounted instances, so
 * include the record id for per-row state (`policy:${id}:menu`). Values must
 * be JSON-serializable and small; never share secrets or unsent credentials.
 */

type Listener = () => void;

// Leader: what this browser shows for every mounted key.
const published = new Map<string, unknown>();
const publishedListeners = new Set<Listener>();
// Follower: the leader's values, or null when not following.
let mirrored: Record<string, unknown> | null = null;
const mirroredListeners = new Set<Listener>();

function notify(listeners: Set<Listener>) {
  listeners.forEach((listener) => listener());
}

export function subscribePublishedUi(listener: Listener) {
  publishedListeners.add(listener);
  return () => void publishedListeners.delete(listener);
}

/** This browser's non-default followed state as JSON. */
export function publishedUiJson() {
  return JSON.stringify(Object.fromEntries(published));
}

/** Applies the followed leader's state; `null` stops mirroring. */
export function setMirroredUi(json: string | null) {
  let next: Record<string, unknown> | null = null;
  if (json !== null) {
    try {
      next = JSON.parse(json) as Record<string, unknown>;
    } catch {
      next = {};
    }
  }
  mirrored = next;
  notify(mirroredListeners);
}

function subscribeMirrored(listener: Listener) {
  mirroredListeners.add(listener);
  return () => void mirroredListeners.delete(listener);
}

function getMirrored() {
  return mirrored;
}

export function useFollowedState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [initialValue] = useState(initial);
  const [local, setLocal] = useState(initialValue);
  const remote = useSyncExternalStore(
    subscribeMirrored,
    getMirrored,
    () => null,
  );
  // Leaders send only non-default values, so a missing key means the default.
  const shown =
    remote === null
      ? local
      : Object.hasOwn(remote, key)
        ? (remote[key] as T)
        : initialValue;

  // Keep the leader's last value once following stops, so the screen does not
  // jump back.
  const [held, setHeld] = useState<{ value: T } | null>(null);
  if (remote !== null && held?.value !== shown) setHeld({ value: shown });
  if (remote === null && held) {
    setHeld(null);
    setLocal(held.value);
  }

  // Publish only what differs from the default; most keys cost nothing.
  const isDefault = JSON.stringify(shown) === JSON.stringify(initialValue);
  useEffect(() => {
    if (isDefault) return;
    published.set(key, shown);
    notify(publishedListeners);
    return () => {
      if (published.get(key) === shown) published.delete(key);
      notify(publishedListeners);
    };
  }, [key, shown, isDefault]);

  return [shown, setLocal];
}

/** `open`/`onOpenChange` props for a followed Dialog, Sheet, Popover or Menu root. */
export function useFollowedOpen(key: string, initial = false) {
  const [open, setOpen] = useFollowedState(key, initial);
  return { open, onOpenChange: (next: boolean) => setOpen(next) };
}

/** `useReducer` counterpart of `useFollowedState`; the state must be JSON-serializable. */
export function useFollowedReducer<S, A>(
  key: string,
  reducer: (state: S, action: A) => S,
  initial: S,
): [S, (action: A) => void] {
  const [state, setState] = useFollowedState(key, initial);
  const dispatch = useCallback(
    (action: A) => setState((current) => reducer(current, action)),
    [reducer, setState],
  );
  return [state, dispatch];
}
