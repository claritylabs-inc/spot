"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useSpotSync } from "@/lib/sync/spot-sync";
import { analyticsPath, initAnalytics, posthog } from "@/lib/analytics";

export function SpotAnalytics() {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { scope } = useSpotSync();
  const lastUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    initAnalytics();
    if (process.env.NEXT_PUBLIC_POSTHOG_DISABLED === "true") return;
    if (isLoading) return;
    const userId = isAuthenticated ? scope.userId : undefined;
    if (lastUser.current && lastUser.current !== userId) posthog.reset();
    if (userId) posthog.identify(userId);
    lastUser.current = userId;
  }, [isAuthenticated, isLoading, scope.userId]);
  useEffect(() => {
    if (!pathname || process.env.NEXT_PUBLIC_POSTHOG_DISABLED === "true") return;
    posthog.register({ surface: pathname.startsWith("/operator") ? "operator" : pathname.startsWith("/share") ? "shared_packet" : "client" });
    posthog.capture("$pageview", {
      $current_url: window.location.origin + analyticsPath(pathname),
      $pathname: analyticsPath(pathname),
    });
  }, [pathname]);
  return null;
}
