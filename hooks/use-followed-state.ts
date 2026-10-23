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
 * filters, expanded rows. While someone follows this operator, every mounted
 * value is streamed with their cursor; a follower renders the leader's value
 * for the same key instead of their own, and keeps it when they stop.
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

/** This browser's followed state as JSON, for the cursor stream. */
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
  const [local, setLocal] = useState(initial);
  const remote = useSyncExternalStore(subscribeMirrored, getMirrored, () => null);
  const hasRemote = remote !== null && Object.hasOwn(remote, key);
  const shown = hasRemote ? (remote[key] as T) : local;

  // Keep the leader's last value once following stops or the leader unmounts
  // this key, so the screen does not jump back.
  const [held, setHeld] = useState<{ value: T } | null>(null);
  if (hasRemote && held?.value !== shown) setHeld({ value: shown });
  if (!hasRemote && held) {
    setHeld(null);
    setLocal(held.value);
  }

  useEffect(() => {
    published.set(key, shown);
    notify(publishedListeners);
    return () => {
      if (published.get(key) === shown) published.delete(key);
      notify(publishedListeners);
    };
  }, [key, shown]);

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
