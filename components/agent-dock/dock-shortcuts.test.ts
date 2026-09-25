import { expect, test } from "vitest";
import { agentDockShortcut } from "./dock-shortcuts";

const key = (value: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...modifiers,
});

test("⌘J and Ctrl+J toggle the dock; adding Shift toggles full screen", () => {
  const context = { mode: "collapsed" as const, inModal: false };
  expect(agentDockShortcut(key("j", { metaKey: true }), context)).toBe("toggle");
  expect(agentDockShortcut(key("j", { ctrlKey: true }), context)).toBe("toggle");
  expect(
    agentDockShortcut(key("J", { metaKey: true, shiftKey: true }), context),
  ).toBe("toggleFull");
  expect(agentDockShortcut(key("j"), context)).toBeNull();
  expect(agentDockShortcut(key("j", { metaKey: true, altKey: true }), context)).toBeNull();
  expect(
    agentDockShortcut(key("j", { metaKey: true, defaultPrevented: true }), context),
  ).toBeNull();
});

test("Esc steps down an open dock unless a dialog or menu owns focus", () => {
  expect(agentDockShortcut(key("Escape"), { mode: "full", inModal: false })).toBe("stepDown");
  expect(agentDockShortcut(key("Escape"), { mode: "expanded", inModal: false })).toBe("stepDown");
  expect(agentDockShortcut(key("Escape"), { mode: "collapsed", inModal: false })).toBeNull();
  expect(agentDockShortcut(key("Escape"), { mode: "full", inModal: true })).toBeNull();
  expect(
    agentDockShortcut(key("Escape", { defaultPrevented: true }), { mode: "full", inModal: false }),
  ).toBeNull();
});
