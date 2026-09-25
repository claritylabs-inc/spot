export type AgentDockMode = "collapsed" | "expanded" | "full";
export type AgentDockView = "chat" | "history";

export type AgentDockTab = {
  threadId: string;
  /** Latest message time the viewer has seen in this tab. */
  seenAt: number;
};

export type AgentDockState = {
  mode: AgentDockMode;
  view: AgentDockView;
  tabs: AgentDockTab[];
  /** `null` is the unsaved new chat. */
  activeThreadId: string | null;
  historyArchived: boolean;
};

export type AgentDockAction =
  | { type: "toggle" }
  | { type: "toggleFull" }
  | { type: "stepDown" }
  | { type: "setMode"; mode: AgentDockMode }
  | { type: "newChat" }
  | {
      type: "openThread";
      threadId: string;
      now: number;
      mode?: AgentDockMode;
    }
  | { type: "closeTab"; threadId: string }
  | { type: "showHistory"; archived?: boolean; mode?: AgentDockMode }
  | { type: "showChat" }
  | { type: "setHistoryArchived"; archived: boolean }
  | { type: "markSeen"; threadId: string; at: number }
  | {
      type: "restore";
      tabs: AgentDockTab[];
      activeThreadId: string | null;
    };

export const AGENT_DOCK_MAX_TABS = 8;

export const initialAgentDockState: AgentDockState = {
  mode: "collapsed",
  view: "chat",
  tabs: [],
  activeThreadId: null,
  historyArchived: false,
};

function opened(mode: AgentDockMode): AgentDockMode {
  return mode === "collapsed" ? "expanded" : mode;
}

function withTab(tabs: AgentDockTab[], tab: AgentDockTab, keep: string | null) {
  if (tabs.some((existing) => existing.threadId === tab.threadId)) return tabs;
  const next = [...tabs, tab];
  while (next.length > AGENT_DOCK_MAX_TABS) {
    const dropIndex = next.findIndex(
      (existing) =>
        existing.threadId !== keep && existing.threadId !== tab.threadId,
    );
    next.splice(dropIndex, 1);
  }
  return next;
}

/** The tab to the right of a closed tab takes focus, else the one to its left. */
export function neighborAfterClose(tabs: AgentDockTab[], threadId: string) {
  const index = tabs.findIndex((tab) => tab.threadId === threadId);
  if (index === -1) return null;
  return (tabs[index + 1] ?? tabs[index - 1])?.threadId ?? null;
}

export function agentDockReducer(
  state: AgentDockState,
  action: AgentDockAction,
): AgentDockState {
  switch (action.type) {
    case "toggle":
      return {
        ...state,
        mode: state.mode === "collapsed" ? "expanded" : "collapsed",
      };
    case "toggleFull":
      return { ...state, mode: state.mode === "full" ? "expanded" : "full" };
    case "stepDown":
      return {
        ...state,
        mode: state.mode === "full" ? "expanded" : "collapsed",
      };
    case "setMode":
      return state.mode === action.mode ? state : { ...state, mode: action.mode };
    case "newChat":
      return {
        ...state,
        mode: opened(state.mode),
        view: "chat",
        activeThreadId: null,
      };
    case "openThread":
      return {
        ...state,
        mode: action.mode ?? opened(state.mode),
        view: "chat",
        activeThreadId: action.threadId,
        tabs: withTab(
          state.tabs,
          { threadId: action.threadId, seenAt: action.now },
          state.activeThreadId,
        ),
      };
    case "closeTab": {
      if (!state.tabs.some((tab) => tab.threadId === action.threadId)) {
        return state;
      }
      return {
        ...state,
        tabs: state.tabs.filter((tab) => tab.threadId !== action.threadId),
        activeThreadId:
          state.activeThreadId === action.threadId
            ? neighborAfterClose(state.tabs, action.threadId)
            : state.activeThreadId,
      };
    }
    case "showHistory":
      return {
        ...state,
        mode: action.mode ?? opened(state.mode),
        view: "history",
        historyArchived: action.archived ?? state.historyArchived,
      };
    case "showChat":
      return { ...state, view: "chat" };
    case "setHistoryArchived":
      return { ...state, historyArchived: action.archived };
    case "markSeen":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.threadId === action.threadId && tab.seenAt < action.at
            ? { ...tab, seenAt: action.at }
            : tab,
        ),
      };
    case "restore": {
      // Tabs opened before storage was read (e.g. a deep link) stay open.
      const restored = action.tabs.filter(
        (tab) =>
          !state.tabs.some((existing) => existing.threadId === tab.threadId),
      );
      const tabs = [...restored, ...state.tabs].slice(-AGENT_DOCK_MAX_TABS);
      const candidate = state.activeThreadId ?? action.activeThreadId;
      const activeThreadId = tabs.some((tab) => tab.threadId === candidate)
        ? candidate
        : null;
      return { ...state, tabs, activeThreadId };
    }
  }
}

export function isTabUnread(
  tab: AgentDockTab,
  lastMessageAt: number | undefined,
  active: boolean,
) {
  return !active && lastMessageAt !== undefined && lastMessageAt > tab.seenAt;
}
