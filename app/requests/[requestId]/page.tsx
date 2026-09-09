"use client";

import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClientRequestDetail } from "@/components/procurement/client-requests-workspace";
import type { Id } from "@/convex/_generated/dataModel";

export default function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [breadcrumb, setBreadcrumb] = useState<string | null>(null);

  return (
    <AppShell
      breadcrumbDetail={breadcrumb ?? "Request"}
      rightPanel={rightPanel}
    >
      <ClientRequestDetail
        key={requestId}
        requestId={requestId as Id<"procurementRequests">}
        onBreadcrumb={setBreadcrumb}
        onRightPanel={setRightPanel}
      />
    </AppShell>
  );
}
