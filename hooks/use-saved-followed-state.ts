"use client";

import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import { useFollowedState, useIsFollowing } from "@/hooks/use-followed-state";

const STORAGE_PREFIX = "spot:saved-ui:";

function readSaved<T>(key: string): { value: T } | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? null : { value: JSON.parse(raw) as T };
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: unknown) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or private browsing: the choice lasts for this page only.
  }
}

/**
 * `useFollowedState` for filters and sorting that this browser remembers: the
 * value is saved to localStorage on change and restored on the next visit.
 * Starts from `initial` so server and first client render match, then applies
 * the saved value. While following a teammate the leader's value is shown and
 * nothing is read or saved. Keys follow the `useFollowedState` rules; values
 * must be small and JSON-serializable.
 */
export function useSavedFollowedState<T>(
  key: string,
  initial: T,
  { persist = true }: { persist?: boolean } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useFollowedState(key, initial);
  const following = useIsFollowing();

  useEffect(() => {
    if (!persist || following) return;
    const saved = readSaved<T>(key);
    if (saved) setValue(saved.value);
  }, [key, persist, following, setValue]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (current: T) => T)(value)
          : next;
      setValue(resolved);
      if (persist) writeSaved(key, resolved);
    },
    [key, persist, value, setValue],
  );

  return [value, set];
}
