"use client";

import type { ReactNode } from "react";
import { BackgroundTaskProvider } from "@claritylabs-inc/ui/components/background-tasks";
import { useSpotSync } from "@/lib/sync/spot-sync";

export function SpotBackgroundTasks({ children }: { children: ReactNode }) {
  const { scope } = useSpotSync();
  return (
    <BackgroundTaskProvider key={`${scope.userId}:${scope.orgId}`}>
      {children}
    </BackgroundTaskProvider>
  );
}
