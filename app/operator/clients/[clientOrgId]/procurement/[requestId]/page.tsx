"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { AlertCircle, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { ProcurementRequestWorkspace } from "@/components/procurement/procurement-request-workspace";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSidebar } from "../../operator-client-sidebar";

export default function OperatorProcurementRequestPage() {
  const { clientOrgId, requestId } = useParams<{
    clientOrgId: string;
    requestId: string;
  }>();
  const searchParams = useSearchParams();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const request = useQuery(api.procurementRequests.get, {
    requestId: requestId as Id<"procurementRequests">,
  });
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [workspaceActions, setWorkspaceActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const activeImpersonation = current?.activeImpersonation ?? null;
  const basePath = `/operator/clients/${clientOrgId}/procurement`;
  const title = request?.request.title ?? "Procurement request";
  const requestedView = searchParams.get("view");
  const normalizedView =
    requestedView === "requirements"
      ? "packet"
      : requestedView === "market"
        ? "proposals"
        : requestedView;
  const view =
    normalizedView === "packet" ||
    normalizedView === "proposals" ||
    normalizedView === "files" ||
    normalizedView === "email"
      ? normalizedView
      : "overview";

  return (
    <AppShell
      actions={workspaceActions}
      breadcrumbDetail={
        <span className="flex min-w-0 items-center gap-1.5">
          <Link
            href={basePath}
            className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            Procurement
          </Link>
          <span
            className={`text-muted-foreground/30 ${typeStyle("body.default")}`}
            aria-hidden="true"
          >
            /
          </span>
          <span className="truncate">{title}</span>
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
      <OperatorPageContextRegistration
        context={{
          pageType: "procurement_request",
          entityId: requestId,
          summary: request
            ? `${request.request.title} procurement for ${client?.name ?? "client"}`
            : "Current procurement request",
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
                  Stop the current impersonation session to edit this request.
                </p>
              </div>
            </OperationalPanel>
          ) : null}
          <ProcurementRequestWorkspace
            clientOrgId={clientOrgId as Id<"organizations">}
            requestId={requestId as Id<"procurementRequests">}
            basePath={basePath}
            view={view}
            readOnly={Boolean(activeImpersonation)}
            onActions={setWorkspaceActions}
            onRightPanel={setRightPanel}
          />
        </main>
      )}
    </AppShell>
  );
}
