import { expect, test } from "vitest";
import {
  AGENT_DOCK_MAX_TABS,
  agentDockReducer,
  initialAgentDockState,
  isTabUnread,
  type AgentDockAction,
  type AgentDockState,
} from "./dock-state";

function run(...actions: AgentDockAction[]) {
  return actions.reduce<AgentDockState>(agentDockReducer, initialAgentDockState);
}

test("⌘J toggles collapsed and expanded; ⌘⇧J toggles full; Esc steps down", () => {
  expect(run({ type: "toggle" }).mode).toBe("expanded");
  expect(run({ type: "toggle" }, { type: "toggle" }).mode).toBe("collapsed");
  expect(run({ type: "toggleFull" }).mode).toBe("full");
  expect(run({ type: "toggleFull" }, { type: "toggleFull" }).mode).toBe("expanded");
  expect(run({ type: "toggleFull" }, { type: "toggle" }).mode).toBe("collapsed");
  expect(run({ type: "toggleFull" }, { type: "stepDown" }).mode).toBe("expanded");
  expect(
    run({ type: "toggleFull" }, { type: "stepDown" }, { type: "stepDown" }).mode,
  ).toBe("collapsed");
});

test("opening a thread adds one tab, focuses it and opens the dock", () => {
  const state = run(
    { type: "openThread", threadId: "a", now: 1 },
    { type: "showHistory" },
    { type: "openThread", threadId: "a", now: 2 },
  );
  expect(state).toMatchObject({
    mode: "expanded",
    view: "chat",
    activeThreadId: "a",
    tabs: [{ threadId: "a", seenAt: 1 }],
  });
  expect(
    run({ type: "toggleFull" }, { type: "openThread", threadId: "a", now: 1 }).mode,
  ).toBe("full");
  expect(run({ type: "openThread", threadId: "a", now: 1, mode: "full" }).mode).toBe(
    "full",
  );
});

test("closing the active tab focuses its right neighbor, then its left, then a new chat", () => {
  const opened = run(
    { type: "openThread", threadId: "a", now: 1 },
    { type: "openThread", threadId: "b", now: 1 },
    { type: "openThread", threadId: "c", now: 1 },
    { type: "openThread", threadId: "b", now: 1 },
  );
  const afterB = agentDockReducer(opened, { type: "closeTab", threadId: "b" });
  expect(afterB.activeThreadId).toBe("c");
  const afterC = agentDockReducer(afterB, { type: "closeTab", threadId: "c" });
  expect(afterC.activeThreadId).toBe("a");
  const afterA = agentDockReducer(afterC, { type: "closeTab", threadId: "a" });
  expect(afterA).toMatchObject({ activeThreadId: null, tabs: [] });
  const background = agentDockReducer(opened, { type: "closeTab", threadId: "a" });
  expect(background.activeThreadId).toBe("b");
});

test("the tab list is capped without dropping the active or newest tab", () => {
  let state = run({ type: "openThread", threadId: "keep", now: 1 });
  for (let index = 0; index < AGENT_DOCK_MAX_TABS; index += 1) {
    state = agentDockReducer(state, { type: "openThread", threadId: `t${index}`, now: 1 });
  }
  expect(state.tabs).toHaveLength(AGENT_DOCK_MAX_TABS);
  expect(state.tabs.at(-1)?.threadId).toBe(`t${AGENT_DOCK_MAX_TABS - 1}`);
  expect(state.tabs.some((tab) => tab.threadId === "keep")).toBe(false);
  expect(state.activeThreadId).toBe(`t${AGENT_DOCK_MAX_TABS - 1}`);
});

test("new chat keeps tabs and history remembers the archived toggle", () => {
  const state = run(
    { type: "openThread", threadId: "a", now: 1 },
    { type: "showHistory", archived: true },
    { type: "newChat" },
  );
  expect(state).toMatchObject({
    view: "chat",
    activeThreadId: null,
    historyArchived: true,
    tabs: [{ threadId: "a" }],
  });
});

test("restoring stored tabs keeps tabs opened before storage was read", () => {
  const deepLinked = run({ type: "openThread", threadId: "linked", now: 5, mode: "full" });
  const restored = agentDockReducer(deepLinked, {
    type: "restore",
    tabs: [
      { threadId: "stored", seenAt: 1 },
      { threadId: "linked", seenAt: 2 },
    ],
    activeThreadId: "stored",
  });
  expect(restored.tabs.map((tab) => tab.threadId)).toEqual(["stored", "linked"]);
  expect(restored.activeThreadId).toBe("linked");
  const cold = agentDockReducer(initialAgentDockState, {
    type: "restore",
    tabs: [{ threadId: "stored", seenAt: 1 }],
    activeThreadId: "missing",
  });
  expect(cold.activeThreadId).toBeNull();
});

test("a background tab is unread until its latest reply is seen", () => {
  const state = run({ type: "openThread", threadId: "a", now: 10 });
  const tab = state.tabs[0];
  expect(isTabUnread(tab, 20, false)).toBe(true);
  expect(isTabUnread(tab, 20, true)).toBe(false);
  const seen = agentDockReducer(state, { type: "markSeen", threadId: "a", at: 20 });
  expect(isTabUnread(seen.tabs[0], 20, false)).toBe(false);
  expect(agentDockReducer(seen, { type: "markSeen", threadId: "a", at: 5 }).tabs[0].seenAt).toBe(20);
});
