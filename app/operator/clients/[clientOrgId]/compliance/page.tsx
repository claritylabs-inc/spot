"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  OperatorComplianceWorkspace,
  type ComplianceCertificatesTabArgs,
  type ComplianceWorkspaceShellArgs,
} from "@/components/compliance-page";
import { AppShell } from "@/components/app-shell";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorCertificatesWorkspace } from "../certificates/operator-certificates-workspace";

export default function OperatorClientCompliancePage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const activeImpersonation = current?.activeImpersonation ?? null;

  const breadcrumb = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        href={`/operator/clients/${clientOrgId}`}
        className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        {client?.name ?? "Client"}
      </Link>
      <span
        className={`text-muted-foreground/30 ${typeStyle("body.default")}`}
        aria-hidden="true"
      >
        /
      </span>
      <span className="truncate">Compliance</span>
    </span>
  );

  if (clients === undefined) {
    return (
      <AppShell
        breadcrumbDetail={breadcrumb}
      >
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      </AppShell>
    );
  }

  if (!client) {
    return (
      <AppShell
        breadcrumbDetail={breadcrumb}
      >
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/clients" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      </AppShell>
    );
  }

  return (
    <OperatorComplianceWorkspace
      orgContext={{
        orgId: client._id,
        orgType: "client",
        role: "admin",
        featureFlags: client.featureFlags,
        isReadOnlyImpersonation: Boolean(activeImpersonation),
      }}
      renderCertificatesTab={({
        onActions,
        onRightPanel,
      }: ComplianceCertificatesTabArgs) => (
        <OperatorCertificatesWorkspace
          orgId={client._id}
          readOnly={Boolean(activeImpersonation)}
          onActions={onActions}
          onRightPanel={onRightPanel}
        />
      )}
      renderShell={({
        actions,
        rightPanel,
        toolbar,
        children,
      }: ComplianceWorkspaceShellArgs) => (
        <AppShell
          actions={actions}
          breadcrumbDetail={breadcrumb}
          rightPanel={rightPanel}
        >
          <main className="w-full space-y-6">
            <div className="overflow-x-auto">{toolbar}</div>
            {children}
          </main>
        </AppShell>
      )}
    />
  );
}
