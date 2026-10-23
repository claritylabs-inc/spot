"use client";

import { useCallback, useState } from "react";

function read<T>(key: string, initial: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return { ...initial, ...JSON.parse(stored) };
  } catch {
    // Storage unavailable or corrupt; start from the initial value.
  }
  return initial;
}

/**
 * Form state for create flows that survives closing and reloading. The draft
 * lives in localStorage under `key` until `discard` runs (explicit Cancel or a
 * successful create), so dismissing a drawer never loses progress.
 */
export function useLocalDraft<T extends Record<string, unknown>>(
  key: string,
  initial: T,
) {
  const [draft, setDraft] = useState<T>(() => read(key, initial));

  const update = useCallback(
    (patch: Partial<T>) =>
      setDraft((current) => {
        const next = { ...current, ...patch };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Quota or private browsing: keep the in-memory draft only.
        }
        return next;
      }),
    [key],
  );

  const discard = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }, [key]);

  return [draft, update, discard] as const;
}
