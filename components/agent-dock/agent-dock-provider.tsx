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
  useFollowedState,
  useFollowedValue,
} from "@/hooks/use-followed-state";
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
  AGENT_DOCK_DEFAULT_WIDTH,
  clampAgentDockHeight,
  clampAgentDockWidth,
  readStoredAgentDock,
  writeStoredAgentDock,
} from "./dock-storage";

export type AgentDockComposerHandle = { focus: () => void };

type AgentDockContextValue = AgentDockState & {
  surface: AppShellSurface;
  /** Height as a fraction of the viewport in the expanded state. */
  height: number;
  setHeight: (height: number) => void;
  /** Width as a fraction of the viewport when the dock sits on the right. */
  width: number;
  setWidth: (width: number) => void;
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
  standaloneOrgId,
  children,
}: {
  surface: AppShellSurface;
  userId: string | undefined;
  /**
   * The dock fills its frame (browser sidebar): it stays expanded, ignores the
   * collapse and full-screen shortcuts, and keeps its tabs under a layout key
   * for this user and organization, apart from the web dock's preference.
   */
  standaloneOrgId?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ownState, dispatch] = useReducer(
    agentDockReducer,
    initialAgentDockState,
  );
  // Followers see the leader's open thread and view; their own tabs and saved
  // dock are untouched.
  const screen = useFollowedValue(
    "shell:agent-dock:screen",
    {
      mode: ownState.mode,
      view: ownState.view,
      activeThreadId: ownState.activeThreadId,
      historyArchived: ownState.historyArchived,
    },
    {
      mode: initialAgentDockState.mode,
      view: initialAgentDockState.view,
      activeThreadId: initialAgentDockState.activeThreadId,
      historyArchived: initialAgentDockState.historyArchived,
    },
  );
  const state = useMemo(
    () => ({
      ...ownState,
      ...screen,
      tabs:
        screen.activeThreadId === null ||
        ownState.tabs.some((tab) => tab.threadId === screen.activeThreadId)
          ? ownState.tabs
          : [...ownState.tabs, { threadId: screen.activeThreadId, seenAt: 0 }],
    }),
    [ownState, screen],
  );
  const [height, setHeightState] = useState(AGENT_DOCK_DEFAULT_HEIGHT);
  const [width, setWidthState] = useState(AGENT_DOCK_DEFAULT_WIDTH);
  const [detachedContextKey, setDetachedContextKey] = useFollowedState<
    string | null
  >("shell:agent-dock:detached-context", null);
  const storageKey = userId
    ? standaloneOrgId
      ? `${agentDockStorageKey(surface, userId)}:sidebar:${standaloneOrgId}`
      : agentDockStorageKey(surface, userId)
    : null;
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
      mode: standaloneOrgId ? "expanded" : stored.mode,
    });
    setHeightState(stored.height);
    setWidthState(stored.width);
  }

  useEffect(() => {
    if (!storageKey || restoredKey !== storageKey) return;
    writeStoredAgentDock(storageKey, {
      tabs: ownState.tabs,
      activeThreadId: ownState.activeThreadId,
      height,
      width,
      mode: ownState.mode,
    });
  }, [
    height,
    width,
    restoredKey,
    ownState.activeThreadId,
    ownState.mode,
    ownState.tabs,
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
  }, [dispatch, pathname, router, search]);

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
    [dispatch, rememberFocus],
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
    if (standaloneOrgId) return;
    function handleKeyDown(event: KeyboardEvent) {
      const shortcut = agentDockShortcut(event, {
        mode: state.mode,
        inModal: isInsideModal(event.target),
      });
      if (!shortcut) return;
      if (shortcut === "closeChat") {
        if (state.mode === "collapsed" || state.view !== "chat") return;
        const threadId = state.activeThreadId;
        if (!threadId) return;
        event.preventDefault();
        dispatch({ type: "closeTab", threadId });
        return;
      }
      if (shortcut === "tab1" || shortcut === "tab2" || shortcut === "tab3") {
        const tab = state.tabs[Number(shortcut.slice(3)) - 1];
        if (!tab) return;
        event.preventDefault();
        run({ type: "openThread", threadId: tab.threadId, now: dayjs().valueOf() });
        return;
      }
      event.preventDefault();
      if (shortcut === "newChat") {
        run({ type: "newChat" });
        setDetachedContextKey(null);
        window.requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
      run(
        shortcut === "showHistory"
          ? { type: "showHistory" }
          : { type: shortcut },
      );
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    dispatch,
    run,
    setDetachedContextKey,
    standaloneOrgId,
    state.activeThreadId,
    state.mode,
    state.tabs,
    state.view,
  ]);

  const value = useMemo<AgentDockContextValue>(
    () => ({
      ...state,
      surface,
      height,
      setHeight: (next) => setHeightState(clampAgentDockHeight(next)),
      width,
      setWidth: (next) => setWidthState(clampAgentDockWidth(next)),
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
      dispatch,
      height,
      openDeepLink,
      run,
      setDetachedContextKey,
      state,
      surface,
      width,
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
