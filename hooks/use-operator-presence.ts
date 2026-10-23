"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Three missed heartbeats mark an operator as gone. */
const ACTIVE_WINDOW_MS = 45_000;

export type EmailThreadActivity = "viewing" | "replying";

type EmailThreadPresence = {
  token: string;
  emailThreadId: Id<"teamEmailThreads">;
  activity: EmailThreadActivity;
};

// The open email thread rides on the single shell heartbeat below. A reader
// reports into this store instead of running its own heartbeat.
let emailThreadPresence: EmailThreadPresence | null = null;
const emailThreadListeners = new Set<() => void>();

function setEmailThreadPresence(next: EmailThreadPresence | null) {
  emailThreadPresence = next;
  emailThreadListeners.forEach((listener) => listener());
}

function subscribeEmailThreadPresence(listener: () => void) {
  emailThreadListeners.add(listener);
  return () => void emailThreadListeners.delete(listener);
}

function getEmailThreadPresence() {
  return emailThreadPresence;
}

/**
 * Reports the email thread this operator has open. `activity: "replying"` is
 * downgraded to viewing while the window is blurred or the tab hidden, and
 * everything clears on unmount or when `emailThreadId` is null. Works for any
 * route: the team inbox and the request Email tab both pass the thread id
 * explicitly, so the pathname does not need to carry it.
 */
export function useReportEmailThreadPresence(
  emailThreadId: Id<"teamEmailThreads"> | null,
  activity: EmailThreadActivity = "viewing",
) {
  const token = useId();
  const [engaged, setEngaged] = useState(true);

  useEffect(() => {
    const update = () =>
      setEngaged(document.visibilityState === "visible" && document.hasFocus());
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const effective: EmailThreadActivity = engaged ? activity : "viewing";
  useEffect(() => {
    if (!emailThreadId) return;
    setEmailThreadPresence({ token, emailThreadId, activity: effective });
    return () => {
      if (emailThreadPresence?.token === token) setEmailThreadPresence(null);
    };
  }, [token, emailThreadId, effective]);
}

/** Reports this operator's page, open dock thread and open email thread while the tab is visible. */
export function useOperatorPresenceHeartbeat({
  pathname,
  threadId,
}: {
  pathname: string;
  threadId: string | null;
}) {
  const heartbeat = useMutation(api.operatorPresence.heartbeat);
  const leave = useMutation(api.operatorPresence.leave);
  const email = useSyncExternalStore(
    subscribeEmailThreadPresence,
    getEmailThreadPresence,
    () => null,
  );
  const emailThreadId = email?.emailThreadId;
  const activity = email?.activity;

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      heartbeat({
        pathname,
        threadId: (threadId ?? undefined) as
          | Id<"operatorAgentThreads">
          | undefined,
        emailThreadId,
        activity,
      }).catch(() => {});
    };
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [heartbeat, pathname, threadId, emailThreadId, activity]);

  useEffect(() => {
    const onPageHide = () => void leave().catch(() => {});
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [leave]);
}

/** Operators with a recent heartbeat, including the viewer (`self`). */
export function useActiveOperators() {
  const rows = useQuery(api.operatorPresence.listActive, {});
  const [now, setNow] = useState(() => dayjs().valueOf());
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(dayjs().valueOf()),
      HEARTBEAT_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, []);
  return useMemo(
    () => (rows ?? []).filter((row) => row.lastSeen > now - ACTIVE_WINDOW_MS),
    [now, rows],
  );
}

export type ActiveOperator = ReturnType<typeof useActiveOperators>[number];

/**
 * Other operators on each email thread, from one `useActiveOperators()` result.
 * Call once per list and look rows up by id; do not subscribe per row.
 */
export function groupEmailThreadPeople(operators: ActiveOperator[]) {
  const byThread = new Map<string, ActiveOperator[]>();
  for (const operator of operators) {
    if (operator.self || !operator.emailThreadId) continue;
    byThread.set(operator.emailThreadId, [
      ...(byThread.get(operator.emailThreadId) ?? []),
      operator,
    ]);
  }
  return byThread;
}

/** Whether anyone in `people` is mid-reply on their thread. */
export function replyingOperators(people: ActiveOperator[] | undefined) {
  return (people ?? []).filter((operator) => operator.activity === "replying");
}
