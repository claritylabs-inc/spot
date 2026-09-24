"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PolicyDetailBody } from "@/app/policies/[id]/policy-detail-body";
import { AppShell } from "@/components/app-shell";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSidebar } from "../../operator-client-sidebar";

export default function OperatorClientPolicyDetailPage() {
  const { clientOrgId, id } = useParams<{
    clientOrgId: string;
    id: string;
  }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [policyBreadcrumb, setPolicyBreadcrumb] =
    useState<ReactNode>(null);
  const [policyActions, setPolicyActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const activeImpersonation = current?.activeImpersonation ?? null;
  const basePath = `/operator/clients/${clientOrgId}/policies`;

  return (
    <AppShell
      actions={policyActions}
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/operator/clients/${clientOrgId}`}
            className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            {client?.name ?? "Client"}
          </Link>
          <span className="text-muted-foreground/30" aria-hidden="true">
            /
          </span>
          <Link
            href={basePath}
            className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            Policies
          </Link>
          {policyBreadcrumb ? (
            <>
              <span className="text-muted-foreground/30" aria-hidden="true">
                /
              </span>
              <span className="truncate">{policyBreadcrumb}</span>
            </>
          ) : null}
        </span>
      }
      rightPanel={rightPanel}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorClientSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          clientOrgId={clientOrgId}
          activeImpersonation={activeImpersonation}
          impersonationDisabled={!client}
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      {clients === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client ? (
        <OperationalPanel className="px-4 py-10 text-center">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Client not found
          </p>
          <PillButton
            className="mt-4"
            href="/operator/clients"
            variant="secondary"
          >
            Back to clients
          </PillButton>
        </OperationalPanel>
      ) : (
        <div className="space-y-4">
          {activeImpersonation ? (
            <OperationalPanel
              as="div"
              className="flex items-start gap-3 px-4 py-3"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Policy management is read-only
                </p>
                <p
                  className={`text-muted-foreground ${typeStyle("body.default")}`}
                >
                  Stop the current impersonation session to edit this policy
                  directly as an operator.
                </p>
              </div>
            </OperationalPanel>
          ) : null}
          <PolicyDetailBody
            id={id}
            onBreadcrumb={setPolicyBreadcrumb}
            onActions={setPolicyActions}
            onRightPanel={setRightPanel}
            afterArchiveHref={`${basePath}?view=archived`}
            afterRestoreHref={basePath}
            readOnly={Boolean(activeImpersonation)}
            operatorMode
          />
        </div>
      )}
    </AppShell>
  );
}
