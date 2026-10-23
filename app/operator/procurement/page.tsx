"use client";

import { useState, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ProcurementListWorkspace } from "@/components/procurement/procurement-list-workspace";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";

/** Procurement requests across every client; each row opens in its client's workspace. */
export default function OperatorProcurementPage() {
  const current = useCachedOperatorCurrent();
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  return (
    <AppShell rightPanel={rightPanel}>
      <main className="w-full">
        <ProcurementListWorkspace
          readOnly={Boolean(current?.activeImpersonation)}
          onRightPanel={setRightPanel}
        />
      </main>
    </AppShell>
  );
}
