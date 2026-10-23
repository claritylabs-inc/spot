"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Three missed heartbeats mark an operator as gone. */
const ACTIVE_WINDOW_MS = 45_000;

/** Reports this operator's page and open dock thread while the tab is visible. */
export function useOperatorPresenceHeartbeat({
  pathname,
  threadId,
}: {
  pathname: string;
  threadId: string | null;
}) {
  const heartbeat = useMutation(api.operatorPresence.heartbeat);
  const leave = useMutation(api.operatorPresence.leave);

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      heartbeat({
        pathname,
        threadId: (threadId ?? undefined) as
          | Id<"operatorAgentThreads">
          | undefined,
      }).catch(() => {});
    };
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [heartbeat, pathname, threadId]);

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
