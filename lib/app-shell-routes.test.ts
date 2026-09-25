import { expect, test } from "vitest";
import {
  agentDockDeepLink,
  appShellHomeHref,
  appShellRoute,
  sidebarVariantDepth,
  sidebarVariantKey,
} from "./app-shell-routes";

test("auth, onboarding and share routes render without the app shell", () => {
  for (const pathname of [
    "/login",
    "/signup/client",
    "/onboarding/setup",
    "/operator/login",
    "/oauth/authorize",
    "/share/packet/token",
    "/connect/request/token",
  ]) {
    expect(appShellRoute(pathname)).toBeNull();
  }
});

test("the layout picks the sidebar from the route", () => {
  expect(appShellRoute("/policies")).toEqual({
    surface: "client",
    sidebar: { id: "client" },
  });
  expect(appShellRoute("/settings")?.sidebar).toEqual({ id: "client-settings" });
  expect(appShellRoute("/connect/vendors")?.surface).toBe("client");
  expect(appShellRoute("/operator/logs")).toEqual({
    surface: "operator",
    sidebar: { id: "operator", active: "logs" },
  });
  expect(appShellRoute("/operator/settings")?.sidebar).toEqual({
    id: "operator-settings",
  });
  expect(appShellRoute("/operator/clients/org%201/policies/p")?.sidebar).toEqual({
    id: "operator-client",
    clientOrgId: "org 1",
  });
  expect(appShellRoute("/operator/clients")?.sidebar).toEqual({
    id: "operator",
    active: "clients",
  });
});

test("nested menus sit one level deeper than their parent menus", () => {
  expect(sidebarVariantDepth({ id: "client" })).toBe(0);
  expect(sidebarVariantDepth({ id: "operator", active: null })).toBe(0);
  expect(sidebarVariantDepth({ id: "client-settings" })).toBe(1);
  expect(sidebarVariantDepth({ id: "operator-settings" })).toBe(1);
  expect(sidebarVariantDepth({ id: "operator-client", clientOrgId: "a" })).toBe(1);
  expect(sidebarVariantKey({ id: "operator", active: "logs" })).toBe(
    sidebarVariantKey({ id: "operator", active: "clients" }),
  );
  expect(sidebarVariantKey({ id: "operator-client", clientOrgId: "a" })).not.toBe(
    sidebarVariantKey({ id: "operator-client", clientOrgId: "b" }),
  );
});

test("former agent pages become dock deep links", () => {
  expect(agentDockDeepLink("/agent/thread/abc")).toEqual({ kind: "thread", threadId: "abc" });
  expect(agentDockDeepLink("/operator/threads/abc")).toEqual({ kind: "thread", threadId: "abc" });
  expect(agentDockDeepLink("/agent/threads")).toEqual({ kind: "history", archived: false });
  expect(agentDockDeepLink("/agent/archive")).toEqual({ kind: "history", archived: true });
  expect(agentDockDeepLink("/operator/threads")).toEqual({ kind: "history", archived: false });
  expect(
    agentDockDeepLink("/operator/threads", new URLSearchParams("view=archived")),
  ).toEqual({ kind: "history", archived: true });
  expect(agentDockDeepLink("/agent/thread/abc/extra")).toBeNull();
  expect(agentDockDeepLink("/policies")).toBeNull();
  expect(appShellHomeHref("client")).toBe("/");
  expect(appShellHomeHref("operator")).toBe("/operator/clients");
});
