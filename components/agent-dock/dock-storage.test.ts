import { expect, test } from "vitest";
import {
  AGENT_DOCK_DEFAULT_HEIGHT,
  AGENT_DOCK_MAX_HEIGHT,
  AGENT_DOCK_MIN_HEIGHT,
  agentDockStorageKey,
  clampAgentDockHeight,
  parseStoredAgentDock,
} from "./dock-storage";

test("open tabs are stored per surface and user", () => {
  expect(agentDockStorageKey("operator", "u1")).not.toBe(
    agentDockStorageKey("client", "u1"),
  );
  expect(agentDockStorageKey("client", "u1")).not.toBe(
    agentDockStorageKey("client", "u2"),
  );
});

test("stored dock state tolerates missing, partial and corrupt values", () => {
  const empty = {
    tabs: [],
    activeThreadId: null,
    height: AGENT_DOCK_DEFAULT_HEIGHT,
    mode: "collapsed",
  };
  expect(parseStoredAgentDock(null)).toEqual(empty);
  expect(parseStoredAgentDock("{not json")).toEqual(empty);
  expect(
    parseStoredAgentDock(
      JSON.stringify({
        tabs: [{ threadId: "a", seenAt: 3 }, { threadId: "" }, "b", { threadId: "c" }],
        activeThreadId: 4,
        height: 2,
        mode: "sideways",
      }),
    ),
  ).toEqual({
    tabs: [
      { threadId: "a", seenAt: 3 },
      { threadId: "c", seenAt: 0 },
    ],
    activeThreadId: null,
    height: AGENT_DOCK_MAX_HEIGHT,
    mode: "collapsed",
  });
  expect(
    parseStoredAgentDock(JSON.stringify({ mode: "expanded", height: 0.45 })),
  ).toMatchObject({ mode: "expanded", height: 0.45 });
});

test("the remembered height stays within the resizable range", () => {
  expect(clampAgentDockHeight(0)).toBe(AGENT_DOCK_MIN_HEIGHT);
  expect(clampAgentDockHeight(0.5)).toBe(0.5);
  expect(clampAgentDockHeight(Number.NaN)).toBe(AGENT_DOCK_DEFAULT_HEIGHT);
});
