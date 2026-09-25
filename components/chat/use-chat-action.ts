"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Runs one async chat action at a time. The ref guards against double
 * submission before React commits `pending`. With `failureMessage`, errors
 * surface as a toast instead of propagating.
 */
export function useChatAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      failureMessage?: string | ((error: unknown) => string),
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      try {
        await action();
      } catch (error) {
        if (failureMessage === undefined) throw error;
        toast.error(typeof failureMessage === "function" ? failureMessage(error) : failureMessage);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );
  const isRunning = useCallback(() => inFlight.current, []);
  return { pending, run, isRunning };
}
