// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AgentDockProvider,
  AgentDockRoute,
  useAgentDock,
} from "./agent-dock-provider";
import { agentDockStorageKey } from "./dock-storage";

const navigation = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    pathname: "/policies",
    search: "",
    replace,
    router: { replace, push: vi.fn() },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => navigation.router,
}));

let root: Root;
let container: HTMLDivElement;

function Harness() {
  const dock = useAgentDock();
  return (
    <>
      <output>
        {JSON.stringify({
          mode: dock.mode,
          view: dock.view,
          archived: dock.historyArchived,
          active: dock.activeThreadId,
          tabs: dock.tabs.map((tab) => tab.threadId),
        })}
      </output>
      <button onClick={() => dock.openThread("opened")}>Open</button>
      <button onClick={dock.toggle}>Toggle</button>
    </>
  );
}

async function render(route = false, surface: "client" | "operator" = "client") {
  await act(async () => {
    root.render(
      <AgentDockProvider surface={surface} userId="u1">
        <Harness />
        {route ? <AgentDockRoute /> : null}
      </AgentDockProvider>,
    );
  });
}

function state() {
  return JSON.parse(container.querySelector("output")!.textContent!);
}

async function click(label: string) {
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === label)!
      .click();
  });
}

async function key(init: KeyboardEventInit, target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

beforeEach(() => {
  localStorage.clear();
  navigation.pathname = "/policies";
  navigation.search = "";
  navigation.replace.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("open tabs persist per user and surface, and closing the dock never drops them", async () => {
  localStorage.setItem(
    agentDockStorageKey("client", "u1"),
    JSON.stringify({ tabs: [{ threadId: "saved", seenAt: 1 }], activeThreadId: "saved", height: 0.5 }),
  );
  await render();
  expect(state()).toMatchObject({ mode: "collapsed", active: "saved", tabs: ["saved"] });
  await click("Open");
  await click("Toggle");
  expect(state()).toMatchObject({ mode: "collapsed", tabs: ["saved", "opened"] });
  const stored = JSON.parse(localStorage.getItem(agentDockStorageKey("client", "u1"))!);
  expect(stored).toMatchObject({ activeThreadId: "opened", height: 0.5 });
  expect(stored.tabs.map((tab: { threadId: string }) => tab.threadId)).toEqual(["saved", "opened"]);
  expect(localStorage.getItem(agentDockStorageKey("operator", "u1"))).toBeNull();
});

test("a thread route opens that tab in full screen over the page it was opened from", async () => {
  await render(true);
  navigation.pathname = "/agent/thread/linked";
  await render(true);
  expect(state()).toMatchObject({ mode: "full", view: "chat", active: "linked", tabs: ["linked"] });
  expect(navigation.replace).toHaveBeenCalledWith("/policies");
});

test("a cold history deep link opens archived history over home", async () => {
  navigation.pathname = "/agent/archive";
  await render(true);
  expect(state()).toMatchObject({ mode: "full", view: "history", archived: true });
  expect(navigation.replace).toHaveBeenCalledWith("/");
});

test("operator thread links open the tab and return to the operator home on a cold load", async () => {
  navigation.pathname = "/operator/threads/t1";
  await render(true, "operator");
  expect(state()).toMatchObject({ mode: "full", active: "t1" });
  expect(navigation.replace).toHaveBeenCalledWith("/operator/clients");
});

test("an agentThread link opens that thread and drops the parameter", async () => {
  navigation.pathname = "/operator/clients/c1";
  navigation.search = "tab=team&agentThread=t9";
  await render(false, "operator");
  expect(state()).toMatchObject({ mode: "expanded", active: "t9" });
  expect(navigation.replace).toHaveBeenCalledWith("/operator/clients/c1?tab=team", { scroll: false });
});

test("shortcuts toggle the dock, Esc steps down, and dialogs keep their Esc", async () => {
  await render();
  await key({ key: "j", ctrlKey: true });
  expect(state().mode).toBe("expanded");
  await key({ key: "J", metaKey: true, shiftKey: true });
  expect(state().mode).toBe("full");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  await key({ key: "Escape" }, dialog);
  expect(state().mode).toBe("full");
  dialog.remove();
  await key({ key: "Escape" });
  expect(state().mode).toBe("expanded");
  await key({ key: "Escape" });
  expect(state().mode).toBe("collapsed");
});

test("closing returns focus to the element focused before opening", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  await render();
  trigger.focus();
  await key({ key: "j", metaKey: true });
  (document.activeElement as HTMLElement | null)?.blur();
  await key({ key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
