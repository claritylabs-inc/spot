"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvexConnectionState, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const IMPERSONATION_ACK_TIMEOUT_MS = 10_000;

const timedOut = Symbol("impersonation mutation timed out");

type StartStatus = "idle" | "starting" | "retry";
type StartOutcome = "committed" | "failed" | "offline" | "pending";

type StartOperatorImpersonationArgs = {
  targetOrgId: Id<"organizations">;
  targetRole: "admin" | "member";
  destination: string;
  failureMessage: string;
};

export function useStartOperatorImpersonation() {
  const router = useRouter();
  const startMutation = useMutation(api.operator.startImpersonation);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [status, setStatus] = useState<StartStatus>("idle");
  const mountedRef = useRef(true);
  const latestAttemptRef = useRef(0);
  const routedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCommit = useCallback(
    (sessionId: string, destination: string, attempt: number) => {
      if (
        !mountedRef.current ||
        latestAttemptRef.current !== attempt ||
        routedSessionRef.current === sessionId
      ) {
        return;
      }
      routedSessionRef.current = sessionId;
      setStatus("idle");
      router.push(destination);
    },
    [router],
  );

  const startImpersonation = useCallback(
    async ({
      targetOrgId,
      targetRole,
      destination,
      failureMessage,
    }: StartOperatorImpersonationArgs): Promise<StartOutcome> => {
      if (!isWebSocketConnected) {
        setStatus("retry");
        toast.error("You're offline. Reconnect before impersonating.");
        return "offline";
      }

      const attempt = latestAttemptRef.current + 1;
      latestAttemptRef.current = attempt;
      setStatus("starting");

      const mutationOutcome = startMutation({ targetOrgId, targetRole }).then(
        (result) => ({ kind: "committed" as const, result }),
        (error: unknown) => ({ kind: "failed" as const, error }),
      );
      let timeoutId: number | undefined;
      const timeout = new Promise<typeof timedOut>((resolve) => {
        timeoutId = window.setTimeout(
          () => resolve(timedOut),
          IMPERSONATION_ACK_TIMEOUT_MS,
        );
      });
      const outcome = await Promise.race([mutationOutcome, timeout]);

      if (outcome === timedOut) {
        if (mountedRef.current && latestAttemptRef.current === attempt) {
          setStatus("retry");
          toast.error(
            "Connection interrupted. Impersonation is still pending; retry is safe.",
          );
        }
        void mutationOutcome.then((lateOutcome) => {
          if (lateOutcome.kind === "committed") {
            handleCommit(lateOutcome.result.sessionId, destination, attempt);
          }
        });
        return "pending";
      }

      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (outcome.kind === "failed") {
        if (mountedRef.current && latestAttemptRef.current === attempt) {
          setStatus("retry");
          toast.error(getUserFacingErrorMessage(outcome.error, failureMessage));
        }
        return "failed";
      }

      handleCommit(outcome.result.sessionId, destination, attempt);
      return "committed";
    },
    [handleCommit, isWebSocketConnected, startMutation],
  );

  return {
    startImpersonation,
    status,
  };
}
