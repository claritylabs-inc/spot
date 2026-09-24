"use client";

import { use, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { PolicyDetailBody } from "./policy-detail-body";

export default function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);

  return (
    <AppShell
      breadcrumbDetail={breadcrumb}
      actions={actions}
      rightPanel={rightPanel}
    >
      <PolicyDetailBody
        id={id}
        onBreadcrumb={setBreadcrumb}
        onActions={setActions}
        onRightPanel={setRightPanel}
        afterArchiveHref="/policies?view=archived"
        afterRestoreHref="/policies"
        readOnly
        canManageOwnUploads
      />
    </AppShell>
  );
}
