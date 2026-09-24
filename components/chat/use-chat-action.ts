"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Runs one async chat action at a time. The ref guards against double
 * submission before React commits `pending`.
 */
export function useChatAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);
  const isRunning = useCallback(() => inFlight.current, []);
  return { pending, run, isRunning };
}
