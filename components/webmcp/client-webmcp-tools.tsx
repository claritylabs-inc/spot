"use client";

import { useMemo } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/hooks/use-theme";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  imperativeToolAppliesTo,
  WEBMCP_TOOLS,
  type WebMcpToolName,
} from "@/lib/webmcp/catalog";
import type { ImperativeToolDefinition } from "@/lib/webmcp/types";
import {
  useWebMcpTools,
  type WebMcpToolImplementation,
} from "@/lib/webmcp/runtime";
import { agentToolImplementations } from "@/components/webmcp/tools/agent";
import { connectToolImplementations } from "@/components/webmcp/tools/connect";
import type { ToolMap } from "@/components/webmcp/tools/helpers";
import { insuranceToolImplementations } from "@/components/webmcp/tools/insurance";
import { publicToolImplementations } from "@/components/webmcp/tools/public";
import { settingsToolImplementations } from "@/components/webmcp/tools/settings";
import { workspaceToolImplementations } from "@/components/webmcp/tools/workspace";

const NO_CLIENT_TOOLS = ["/onboarding", "/login", "/signup", "/operator", "/share", "/connect/request"];

function onPath(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function selectTools(
  implementations: ToolMap,
  include: (tool: ImperativeToolDefinition) => boolean,
): WebMcpToolImplementation[] {
  return (Object.keys(WEBMCP_TOOLS) as WebMcpToolName[]).flatMap((name) => {
    const tool = WEBMCP_TOOLS[name];
    const execute = implementations[name];
    return tool.surface === "imperative" && execute && include(tool)
      ? [{ name, execute }]
      : [];
  });
}

/**
 * Imperative WebMCP tools for a signed-in client workspace, registered from
 * the catalog's page and role scope. Every call goes through the same public
 * Convex function and authorization the visible UI uses.
 */
export function ClientWebMcpTools() {
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const { setTheme } = useTheme();
  const viewer = useCachedQuery(
    "authGuard.viewer",
    api.users.viewer,
    isAuthenticated ? {} : "skip",
  );
  const viewerOrg = useCachedQuery(
    "authGuard.viewerOrg",
    api.orgs.viewerOrg,
    isAuthenticated ? {} : "skip",
  );
  const org = viewerOrg?.org;
  const orgId = org?._id;
  const userId = viewer?._id;
  const isAdmin = viewerOrg?.membership.role === "admin";
  const enabled = Boolean(
    isAuthenticated &&
      viewer &&
      viewer.accountKind !== "operator" &&
      viewer.onboardingComplete &&
      org?.type === "client" &&
      (org.operatorStatus ?? "live") !== "onboarding" &&
      !onPath(pathname, NO_CLIENT_TOOLS),
  );

  const tools = useMemo(() => {
    if (!orgId || !userId) return [];
    const ctx = { convex, router, orgId, userId, signOut, setTheme };
    const implementations: ToolMap = {
      ...workspaceToolImplementations(ctx),
      ...insuranceToolImplementations(ctx),
      ...agentToolImplementations(ctx),
      ...connectToolImplementations(ctx),
      ...settingsToolImplementations(ctx),
    };
    return selectTools(
      implementations,
      (tool) =>
        tool.audience === "client" &&
        imperativeToolAppliesTo(tool, pathname) &&
        (!tool.adminOnly || isAdmin),
    );
  }, [convex, isAdmin, orgId, pathname, router, setTheme, signOut, userId]);

  useWebMcpTools(tools, enabled);
  return null;
}

/** Tools for public token pages (shared packets, email reviews, invitations). */
export function PublicWebMcpTools() {
  const convex = useConvex();
  const pathname = usePathname();
  const tools = useMemo(
    () =>
      selectTools(
        publicToolImplementations(convex, pathname),
        (tool) => tool.audience === "public" && imperativeToolAppliesTo(tool, pathname),
      ),
    [convex, pathname],
  );
  useWebMcpTools(tools, tools.length > 0);
  return null;
}
