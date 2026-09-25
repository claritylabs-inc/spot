export type AppShellSurface = "client" | "operator";

export type OperatorNavSection =
  | "brokers"
  | "clients"
  | "channels"
  | "logs"
  | "usage"
  | "profile"
  | "settings";

export type AppShellSidebarVariant =
  | { id: "client" }
  | { id: "client-settings" }
  | { id: "operator"; active: OperatorNavSection | null }
  | { id: "operator-settings" }
  | { id: "operator-client"; clientOrgId: string };

export type AppShellRoute = {
  surface: AppShellSurface;
  sidebar: AppShellSidebarVariant;
};

export type AgentDockDeepLink =
  | { kind: "thread"; threadId: string }
  | { kind: "history"; archived: boolean };

const SHELLLESS_PREFIXES = [
  "/login",
  "/signup",
  "/onboarding",
  "/operator/login",
  "/oauth",
  "/share",
  "/connect/request",
  "/api",
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function segmentsOf(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

export function operatorActiveSection(
  pathname: string,
): OperatorNavSection | null {
  const area = segmentsOf(pathname)[1];
  switch (area) {
    case "brokers":
    case "clients":
    case "channels":
    case "logs":
    case "usage":
    case "profile":
    case "settings":
      return area;
    default:
      return null;
  }
}

/** Surface and sidebar for a route, or null when the route has no app shell. */
export function appShellRoute(pathname: string): AppShellRoute | null {
  if (SHELLLESS_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return null;
  }
  const segments = segmentsOf(pathname);
  if (segments[0] === "operator") {
    if (segments[1] === "clients" && segments[2]) {
      return {
        surface: "operator",
        sidebar: {
          id: "operator-client",
          clientOrgId: decodeURIComponent(segments[2]),
        },
      };
    }
    if (segments[1] === "settings") {
      return { surface: "operator", sidebar: { id: "operator-settings" } };
    }
    return {
      surface: "operator",
      sidebar: { id: "operator", active: operatorActiveSection(pathname) },
    };
  }
  return {
    surface: "client",
    sidebar: { id: segments[0] === "settings" ? "client-settings" : "client" },
  };
}

/** Nested menus slide in over their parent menu. */
export function sidebarVariantDepth(variant: AppShellSidebarVariant) {
  return variant.id === "client" || variant.id === "operator" ? 0 : 1;
}

export function sidebarVariantKey(variant: AppShellSidebarVariant) {
  return variant.id === "operator-client"
    ? `${variant.id}:${variant.clientOrgId}`
    : variant.id;
}

/** Former full-page agent routes open the dock in full screen instead. */
export function agentDockDeepLink(
  pathname: string,
  searchParams?: URLSearchParams,
): AgentDockDeepLink | null {
  const segments = segmentsOf(pathname);
  if (segments[0] === "agent") {
    if (segments[1] === "thread" && segments[2] && segments.length === 3) {
      return { kind: "thread", threadId: decodeURIComponent(segments[2]) };
    }
    if (segments[1] === "threads" && segments.length === 2) {
      return { kind: "history", archived: false };
    }
    if (segments[1] === "archive" && segments.length === 2) {
      return { kind: "history", archived: true };
    }
    return null;
  }
  if (segments[0] === "operator" && segments[1] === "threads") {
    if (segments[2] && segments.length === 3) {
      return { kind: "thread", threadId: decodeURIComponent(segments[2]) };
    }
    if (segments.length === 2) {
      return {
        kind: "history",
        archived: searchParams?.get("view") === "archived",
      };
    }
  }
  return null;
}

export function appShellHomeHref(surface: AppShellSurface) {
  return surface === "operator" ? "/operator/clients" : "/";
}
