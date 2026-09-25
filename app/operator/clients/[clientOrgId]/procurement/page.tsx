"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { ProcurementListWorkspace } from "@/components/procurement/procurement-list-workspace";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";

export default function OperatorClientProcurementPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [workspaceActions, setWorkspaceActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const activeImpersonation = current?.activeImpersonation ?? null;
  const basePath = `/operator/clients/${clientOrgId}/procurement`;

  return (
    <AppShell
      actions={workspaceActions}
      breadcrumbDetail={
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
          <span className="truncate">Procurement</span>
        </span>
      }
      rightPanel={rightPanel}
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client_procurement",
          entityId: clientOrgId,
          summary: client
            ? `New-policy procurement for ${client.name}`
            : "Current client procurement",
        }}
      />
      {clients === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/clients" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <main className="w-full space-y-6">
          {activeImpersonation ? (
            <OperationalPanel
              as="div"
              className="flex items-start gap-3 px-4 py-3"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Procurement is read-only
                </p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  Stop the current impersonation session to create or change
                  requests, broker outreach, files, or email classification.
                </p>
              </div>
            </OperationalPanel>
          ) : null}
          <ProcurementListWorkspace
            clientOrgId={clientOrgId as Id<"organizations">}
            basePath={basePath}
            readOnly={Boolean(activeImpersonation)}
            onActions={setWorkspaceActions}
            onRightPanel={setRightPanel}
          />
        </main>
      )}
    </AppShell>
  );
}
