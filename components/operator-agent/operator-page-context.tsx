"use client";

import { useEffect, useMemo } from "react";

import { usePageContext, type PageContext } from "@/hooks/use-page-context";

export function OperatorPageContextRegistration({
  context,
}: {
  context: PageContext;
}) {
  const { setPageContext } = usePageContext();
  const stableContext = useMemo(
    () => ({
      pageType: context.pageType,
      entityId: context.entityId,
      summary: context.summary,
    }),
    [context.entityId, context.pageType, context.summary],
  );

  useEffect(() => {
    setPageContext(stableContext);
    return () => setPageContext(null);
  }, [setPageContext, stableContext]);

  return null;
}

export function operatorPageContextKey(context: PageContext) {
  return `${context.pageType}:${context.entityId ?? "page"}`;
}

export function operatorPageContextLabel(context: PageContext) {
  return context.summary?.trim() || context.pageType.replaceAll("_", " ");
}

export function operatorPageContextsShareScope(
  left: PageContext,
  right: PageContext,
) {
  if (left.entityId || right.entityId) {
    return Boolean(left.entityId && left.entityId === right.entityId);
  }
  return left.pageType === right.pageType;
}

export function operatorPageContextFromPathname(
  pathname: string,
): PageContext | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "operator") return null;

  if (
    segments[1] === "clients" &&
    segments[2] &&
    segments[3] === "policies" &&
    segments[4]
  ) {
    return {
      pageType: "policy",
      entityId: segments[4],
      summary: "Current policy",
    };
  }

  const clientSectionSummary: Record<string, string> = {
    policies: "Client policies",
    compliance: "Client compliance",
  };
  if (
    segments[1] === "clients" &&
    segments[2] &&
    segments[3] &&
    clientSectionSummary[segments[3]]
  ) {
    return {
      pageType: `operator_client_${segments[3]}`,
      entityId: segments[2],
      summary: clientSectionSummary[segments[3]],
    };
  }

  if (segments[1] === "policies" && segments[2]) {
    return {
      pageType: "policy",
      entityId: segments[2],
      summary: "Current policy",
    };
  }

  const summaryByArea: Record<string, string> = {
    brokers: "Insurance providers",
    channels: "Agent channels",
    clients: "Client organizations",
    compliance: "Client compliance",
    "demo-leads": "Demo leads",
    policies: "Client policies",
    profile: "Operator profile",
    logs: "Model call logs",
    usage: "Model usage",
    routing: "Model routing",
    telemetry: "System telemetry",
  };
  const area = segments[1] ?? "clients";

  return {
    pageType: `operator_${area.replaceAll("-", "_")}`,
    entityId: segments[2],
    summary: summaryByArea[area] ?? "Operator portal",
  };
}

export function operatorThreadContextHref(thread: {
  id: string;
  initialContext?: PageContext;
}) {
  const context = thread.initialContext;
  if (!context) return null;
  let href = context.href;
  if (!href) {
    const clientSections: Record<string, string> = {
      operator_client: "",
      operator_clients: "",
      operator_client_wiki: "/wiki",
      operator_client_files: "/files",
      operator_client_procurement: "/procurement",
      operator_client_policies: "/policies",
      operator_client_compliance: "/compliance",
      operator_client_certificates: "/certificates",
    };
    const section = clientSections[context.pageType];
    if (section !== undefined && context.entityId) {
      href = `/operator/clients/${encodeURIComponent(context.entityId)}${section}`;
    } else if (!context.entityId && context.pageType.startsWith("operator_")) {
      href = `/operator/${context.pageType.slice("operator_".length).replaceAll("_", "-")}`;
    }
  }
  if (!href || !href.startsWith("/operator/") || /[\\\s]/.test(href)) {
    return null;
  }
  const url = new URL(href, "https://spot.invalid");
  if (
    !/^\/operator\/(?:clients(?:\/[^/]+(?:\/(?:wiki|files|procurement(?:\/[^/]+)?|policies(?:\/[^/]+)?|compliance|certificates))?)?|brokers|channels|demo-leads|profile|routing|telemetry|logs|usage|settings)\/?$/.test(url.pathname)
  ) return null;
  url.searchParams.set("agentThread", thread.id);
  return `${url.pathname}${url.search}${url.hash}`;
}
