"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dayjs from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  agentDockDeepLink,
  appShellHomeHref,
  type AgentDockDeepLink,
  type AppShellSurface,
} from "@/lib/app-shell-routes";
import {
  agentDockReducer,
  initialAgentDockState,
  type AgentDockMode,
  type AgentDockState,
} from "./dock-state";
import {
  agentDockShortcut,
  isInsideModal,
} from "./dock-shortcuts";
import {
  agentDockStorageKey,
  AGENT_DOCK_DEFAULT_HEIGHT,
  clampAgentDockHeight,
  readStoredAgentDock,
  writeStoredAgentDock,
} from "./dock-storage";

export type AgentDockComposerHandle = { focus: () => void };

type AgentDockContextValue = AgentDockState & {
  surface: AppShellSurface;
  /** Height as a fraction of the viewport in the expanded state. */
  height: number;
  setHeight: (height: number) => void;
  toggle: () => void;
  toggleFull: () => void;
  stepDown: () => void;
  setMode: (mode: AgentDockMode) => void;
  newChat: () => void;
  openThread: (threadId: string, mode?: AgentDockMode) => void;
  closeTab: (threadId: string) => void;
  showHistory: (options?: { archived?: boolean; mode?: AgentDockMode }) => void;
  showChat: () => void;
  setHistoryArchived: (archived: boolean) => void;
  markSeen: (threadId: string, at: number) => void;
  registerComposer: (handle: AgentDockComposerHandle | null) => void;
  /** Page context removed from the composer chip, keyed by page. */
  detachedContextKey: string | null;
  detachContext: (key: string) => void;
  attachContext: () => void;
  /** Opens a former full-page agent route and returns to the page behind it. */
  openDeepLink: (link: AgentDockDeepLink) => void;
};

const AgentDockContext = createContext<AgentDockContextValue | null>(null);

export function AgentDockProvider({
  surface,
  userId,
  children,
}: {
  surface: AppShellSurface;
  userId: string | undefined;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(agentDockReducer, initialAgentDockState);
  const [height, setHeightState] = useState(AGENT_DOCK_DEFAULT_HEIGHT);
  const [detachedContextKey, setDetachedContextKey] = useState<string | null>(
    null,
  );
  const storageKey = userId ? agentDockStorageKey(surface, userId) : null;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const composerRef = useRef<AgentDockComposerHandle | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previousModeRef = useRef<AgentDockMode>(state.mode);
  const returnHrefRef = useRef<string | null>(null);

  if (storageKey && restoredKey !== storageKey && typeof window !== "undefined") {
    const stored = readStoredAgentDock(storageKey);
    setRestoredKey(storageKey);
    dispatch({
      type: "restore",
      tabs: stored.tabs,
      activeThreadId: stored.activeThreadId,
      mode: stored.mode,
    });
    setHeightState(stored.height);
  }

  useEffect(() => {
    if (!storageKey || restoredKey !== storageKey) return;
    writeStoredAgentDock(storageKey, {
      tabs: state.tabs,
      activeThreadId: state.activeThreadId,
      height,
      mode: state.mode,
    });
  }, [
    height,
    restoredKey,
    state.activeThreadId,
    state.mode,
    state.tabs,
    storageKey,
  ]);

  const search = searchParams.toString();

  // Remember the page behind the dock so agent routes can return to it.
  useEffect(() => {
    if (agentDockDeepLink(pathname)) return;
    returnHrefRef.current = `${pathname}${search ? `?${search}` : ""}`;
  }, [pathname, search]);

  // Operator "open with context" links carry the thread in `agentThread`.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const requestedThreadId = params.get("agentThread");
    if (!requestedThreadId) return;
    dispatch({
      type: "openThread",
      threadId: requestedThreadId,
      now: dayjs().valueOf(),
      mode: "expanded",
    });
    params.delete("agentThread");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, router, search]);

  // Opening moves focus to the composer; collapsing returns it.
  useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = state.mode;
    if (previous === state.mode) return;
    if (previous === "collapsed") {
      const frame = window.requestAnimationFrame(() =>
        composerRef.current?.focus(),
      );
      return () => window.cancelAnimationFrame(frame);
    }
    if (state.mode === "collapsed") {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  }, [state.mode]);

  const rememberFocus = useCallback(() => {
    if (state.mode !== "collapsed") return;
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement &&
      !active.closest("[data-agent-dock]") &&
      active !== document.body
        ? active
        : null;
  }, [state.mode]);

  const run = useCallback(
    (action: Parameters<typeof dispatch>[0]) => {
      rememberFocus();
      dispatch(action);
    },
    [rememberFocus],
  );

  const openDeepLink = useCallback(
    (link: AgentDockDeepLink) => {
      if (link.kind === "thread") {
        run({
          type: "openThread",
          threadId: link.threadId,
          now: dayjs().valueOf(),
          mode: "full",
        });
      } else {
        run({ type: "showHistory", archived: link.archived, mode: "full" });
      }
      router.replace(returnHrefRef.current ?? appShellHomeHref(surface));
    },
    [router, run, surface],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const shortcut = agentDockShortcut(event, {
        mode: state.mode,
        inModal: isInsideModal(event.target),
      });
      if (!shortcut) return;
      event.preventDefault();
      run({ type: shortcut });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [run, state.mode]);

  const value = useMemo<AgentDockContextValue>(
    () => ({
      ...state,
      surface,
      height,
      setHeight: (next) => setHeightState(clampAgentDockHeight(next)),
      toggle: () => run({ type: "toggle" }),
      toggleFull: () => run({ type: "toggleFull" }),
      stepDown: () => run({ type: "stepDown" }),
      setMode: (mode) => run({ type: "setMode", mode }),
      newChat: () => {
        run({ type: "newChat" });
        setDetachedContextKey(null);
        window.requestAnimationFrame(() => composerRef.current?.focus());
      },
      openThread: (threadId, mode) =>
        run({ type: "openThread", threadId, mode, now: dayjs().valueOf() }),
      closeTab: (threadId) => dispatch({ type: "closeTab", threadId }),
      showHistory: (options) =>
        run({
          type: "showHistory",
          archived: options?.archived,
          mode: options?.mode,
        }),
      showChat: () => dispatch({ type: "showChat" }),
      setHistoryArchived: (archived) =>
        dispatch({ type: "setHistoryArchived", archived }),
      markSeen: (threadId, at) => dispatch({ type: "markSeen", threadId, at }),
      registerComposer: (handle) => {
        composerRef.current = handle;
      },
      detachedContextKey,
      detachContext: setDetachedContextKey,
      attachContext: () => setDetachedContextKey(null),
      openDeepLink,
    }),
    [
      detachedContextKey,
      height,
      openDeepLink,
      run,
      state,
      surface,
    ],
  );

  return (
    <AgentDockContext.Provider value={value}>
      {children}
    </AgentDockContext.Provider>
  );
}

export function useAgentDock() {
  const value = useContext(AgentDockContext);
  if (!value) throw new Error("useAgentDock must be used inside AgentDockProvider");
  return value;
}

export function useOptionalAgentDock() {
  return useContext(AgentDockContext);
}

/** Former full-page agent routes render nothing and open the dock instead. */
export function AgentDockRoute() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dock = useOptionalAgentDock();
  const openDeepLink = dock?.openDeepLink;
  const link = useMemo(
    () => agentDockDeepLink(pathname, new URLSearchParams(searchParams.toString())),
    [pathname, searchParams],
  );
  const linkKey = link ? JSON.stringify(link) : null;
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!link || !openDeepLink || handledRef.current === linkKey) return;
    handledRef.current = linkKey;
    openDeepLink(link);
  }, [link, linkKey, openDeepLink]);

  return null;
}
