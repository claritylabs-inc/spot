// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  OperatorAgentProvider,
  useOptionalOperatorAgent,
} from "./operator-agent-provider";
import { operatorThreadContextHref } from "./operator-page-context";

const navigation = vi.hoisted(() => ({
  pathname: "/operator/clients/first",
  search: "",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/lib/sync/spot-sync", () => ({
  useSpotSync: () => ({ scope: { userId: "operator" } }),
}));

let root: Root;
let container: HTMLDivElement;
function PanelHarness() {
  const agent = useOptionalOperatorAgent()!;
  return (
    <>
      <output>{agent.open ? (agent.activeThreadId ?? "New thread") : "Closed"}</output>
      <button onClick={() => agent.setActiveThreadId("selected-thread")}>
        Select history
      </button>
      <button onClick={agent.toggle}>Toggle</button>
    </>
  );
}
async function render() {
  await act(async () => {
    root.render(<OperatorAgentProvider><PanelHarness /></OperatorAgentProvider>);
  });
}
async function click(label: string) {
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === label)!.click();
  });
}
function visibleThread() {
  return container.querySelector("output")?.textContent;
}

beforeEach(() => {
  localStorage.clear();
  navigation.pathname = "/operator/clients/first";
  navigation.search = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("ordinary openings and page changes cannot carry a previous client's selected thread", async () => {
  localStorage.setItem("spot:operator-agent:operator:thread", "persisted-thread");
  await render();
  expect(visibleThread()).toBe("New thread");
  await click("Select history");
  expect(visibleThread()).toBe("selected-thread");
  await click("Toggle");
  expect(visibleThread()).toBe("Closed");
  await click("Toggle");
  expect(visibleThread()).toBe("New thread");
  await click("Select history");
  navigation.pathname = "/operator/clients/second";
  await render();
  expect(visibleThread()).toBe("New thread");
  navigation.pathname = "/operator/clients/first";
  await render();
  expect(visibleThread()).toBe("New thread");
});

test("open with context restores the exact thread and tab even when the panel was closed", async () => {
  localStorage.setItem("spot:operator-agent:operator:open", "false");
  const href = operatorThreadContextHref({
    id: "chosen-thread",
    initialContext: {
      pageType: "procurement_request",
      href: "/operator/clients/first/procurement/request?tab=proposals",
    },
  });
  const destination = new URL(href!, "https://spot.invalid");
  navigation.pathname = destination.pathname;
  navigation.search = destination.search;
  await render();
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(destination.pathname).toBe("/operator/clients/first/procurement/request");
  expect(destination.searchParams.get("tab")).toBe("proposals");
  expect(visibleThread()).toBe("chosen-thread");
  navigation.search += "&view=details";
  await render();
  expect(visibleThread()).toBe("chosen-thread");
  await click("Toggle");
  await click("Toggle");
  expect(visibleThread()).toBe("New thread");
});

test("context links stay within supported operator pages", () => {
  for (const href of ["https://example.com", "//example.com", "/operator/../login", "/operator/threads/other", "/operator/unknown"]) {
    expect(operatorThreadContextHref({ id: "thread", initialContext: { pageType: "operator_client", href } })).toBeNull();
  }
  expect(operatorThreadContextHref({ id: "thread" })).toBeNull();
});
