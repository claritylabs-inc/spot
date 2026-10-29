"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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

const TAB_STORAGE_KEY = "operatorPresence:tab";
let tabId: string | null = null;
let tabIdReady: Promise<string> | null = null;
/** When this tab was last focused or entered; the latest is the operator's active tab. */
let activeAt = 0;

/**
 * Holds a Web Lock named after `id` for this page's lifetime. False when
 * another tab already holds it; true where Web Locks are unavailable.
 */
function holdTabLock(id: string) {
  if (!("locks" in navigator)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    navigator.locks
      .request(`operatorTab:${id}`, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      .catch(() => resolve(true));
  });
}

async function claimTabId() {
  let id: string | null = null;
  try {
    id = window.sessionStorage.getItem(TAB_STORAGE_KEY);
  } catch {}
  // A duplicated tab copies sessionStorage; its id is then held by the original.
  if (!id || !(await holdTabLock(id))) {
    id = crypto.randomUUID();
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, id);
    } catch {}
    await holdTabLock(id);
  }
  tabId = id;
  return id;
}

/**
 * This browser tab, kept across reloads so a reload reuses its presence row.
 * Its pointer, followed UI state and carets are stored under it too.
 */
export function browserTabId() {
  tabIdReady ??= claimTabId();
  return tabIdReady;
}

/**
 * Reports this tab's page, open dock thread, open email thread and followed
 * operator while it is visible. Each tab has its own row, so closing one
 * leaves the operator present through their others.
 */
export function useOperatorPresenceHeartbeat({
  pathname,
  threadId,
  followingUserId,
}: {
  pathname: string;
  threadId: string | null;
  followingUserId: Id<"users"> | null;
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
      activeAt ||= dayjs().valueOf();
      void browserTabId().then((tabId) =>
        heartbeat({
          pathname,
          threadId: (threadId ?? undefined) as
            | Id<"operatorAgentThreads">
            | undefined,
          emailThreadId,
          activity,
          followingUserId: followingUserId ?? undefined,
          tabId,
          activeAt,
        }).catch(() => {}),
      );
    };
    // Teammates see the pointer and panels of the tab used last, so a switch
    // to this one is reported at once.
    const activate = () => {
      activeAt = dayjs().valueOf();
      beat();
    };
    // A hidden tab stops beating, so remove its row now; otherwise others keep
    // seeing its last activity (such as "replying") until the TTL lapses.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") activate();
      else
        void browserTabId().then((tabId) => leave({ tabId }).catch(() => {}));
    };
    beat();
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", activate);
    document.documentElement.addEventListener("pointerenter", activate);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", activate);
      document.documentElement.removeEventListener("pointerenter", activate);
    };
  }, [
    heartbeat,
    leave,
    pathname,
    threadId,
    emailThreadId,
    activity,
    followingUserId,
  ]);

  useEffect(() => {
    // Sent synchronously: the page may be gone before a promise settles.
    const onPageHide = () => {
      if (tabId) void leave({ tabId }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [leave]);
}

const NO_ROWS: never[] = [];

/** Rows whose heartbeat is still within the active window. */
function useRecent<T extends { lastSeen: number }>(rows: T[] | undefined) {
  const [now, setNow] = useState(() => dayjs().valueOf());
  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(dayjs().valueOf()),
      HEARTBEAT_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, []);
  return useMemo(
    () => rows?.filter((row) => row.lastSeen > now - ACTIVE_WINDOW_MS),
    [now, rows],
  );
}

/** Operators with a recent heartbeat, including the viewer (`self`). */
export function useActiveOperators() {
  return useRecent(useQuery(api.operatorPresence.listActive, {})) ?? NO_ROWS;
}

/** Active operators with their open chat and email titles; undefined while loading. */
export function useOperatorSessions() {
  return useRecent(useQuery(api.operatorPresence.listSessions, {}));
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

// The followed operator is shared so the top bar and the team page drive the
// same follow session.
let followingUserId: Id<"users"> | null = null;
const followingListeners = new Set<() => void>();

function subscribeFollowing(listener: () => void) {
  followingListeners.add(listener);
  return () => void followingListeners.delete(listener);
}

let takingOverFrom: Id<"users"> | null = null;

/**
 * Follows `userId`, or stops with null. Following someone who follows this
 * operator takes over: they stop following once they see it, rather than both
 * stopping.
 */
export function setFollowingOperator(
  userId: Id<"users"> | null,
  options?: { takeOver?: boolean },
) {
  followingUserId = userId;
  takingOverFrom = options?.takeOver ? userId : null;
  followingListeners.forEach((listener) => listener());
}

/**
 * Whether following `leader` has become mutual, so this operator must stop:
 * true unless this operator started it and is waiting for the leader to let go.
 */
export function followIsMutual(
  leader: { userId: Id<"users">; followingUserId: string | null },
  selfId: string,
) {
  if (leader.followingUserId !== selfId) {
    if (takingOverFrom === leader.userId) takingOverFrom = null;
    return false;
  }
  return takingOverFrom !== leader.userId;
}

/** The operator this one follows, set from the top bar or the team page. */
export function useFollowingOperator() {
  return useSyncExternalStore(
    subscribeFollowing,
    () => followingUserId,
    () => null,
  );
}
