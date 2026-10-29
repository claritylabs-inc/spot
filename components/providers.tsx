"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useEffect } from "react";
import { ThemeProvider } from "@/hooks/use-theme";
import { SpotSyncProvider } from "@/lib/sync/spot-sync";
import { SpotAnalytics } from "@/components/analytics";
import { SpotBackgroundTasks } from "@/components/background-tasks";
import { installTextUndo } from "@/lib/text-undo";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud"
);

function StaticAssetServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      if ("caches" in window) {
        void caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith("spot-static-") ||
                  key.startsWith("glass-static-"),
              )
              .map((key) => caches.delete(key)),
          ),
        );
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[ServiceWorker] Registration failed", error);
    });
  }, []);

  return null;
}

function TextUndo() {
  useEffect(() => installTextUndo(), []);
  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <SpotSyncProvider>
        <StaticAssetServiceWorker />
        <TextUndo />
        <SpotAnalytics />
        <ThemeProvider>
          <SpotBackgroundTasks>{children}</SpotBackgroundTasks>
        </ThemeProvider>
      </SpotSyncProvider>
    </ConvexAuthNextjsProvider>
  );
}
