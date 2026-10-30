"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import {
  ClientFilesWorkspace,
  type ClientFilesContextState,
} from "@/components/client-files/client-files-workspace";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import {
  clientContextName,
  pageContextSummary,
} from "@/components/operator-agent/operator-client-page-context";
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

function filesPageContextSummary(
  clientName: string,
  state: ClientFilesContextState,
) {
  const file = state.openFile;
  return pageContextSummary([
    file
      ? `${file.panel === "image" ? "Viewing" : "Editing"} client file “${file.name.slice(0, 120)}” (clientFileId ${file.id}, ${file.contentType}, ${file.clientVisible ? "shared with client" : "private"}${file.archived ? ", archived" : ""}${file.policyId ? `, linked to policy ${file.policyLabel ?? ""} (${file.policyId})` : ", no linked policy"})`
      : null,
    `Files held for ${clientName}`,
    `${state.status === "archived" ? "archived" : "active"} ${state.view === "all" ? "" : `${state.view} `}files, ${state.shownCount} shown${state.truncated ? " (latest 200 only)" : ""}`,
    state.uploadOpen && "upload drawer open",
  ]);
}

export default function OperatorClientFilesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [workspaceActions, setWorkspaceActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const activeImpersonation = current?.activeImpersonation ?? null;

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
          <span className="truncate">Files</span>
        </span>
      }
      rightPanel={rightPanel}
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client_files",
          entityId: clientOrgId,
          summary: client
            ? `Files held for ${clientContextName(client)}`
            : "Current client files",
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
          <ClientFilesWorkspace
            clientOrgId={clientOrgId as Id<"organizations">}
            readOnly={Boolean(activeImpersonation)}
            notice={
              activeImpersonation ? (
                <OperationalPanel
                  as="div"
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p
                      className={`text-foreground ${typeStyle("body.medium")}`}
                    >
                      File management is read-only
                    </p>
                    <p
                      className={`text-muted-foreground ${typeStyle("body.default")}`}
                    >
                      Stop the current impersonation session to upload or edit
                      client files directly as an operator.
                    </p>
                  </div>
                </OperationalPanel>
              ) : null
            }
            onActions={setWorkspaceActions}
            onRightPanel={setRightPanel}
            pageContext={(state) => ({
              pageType: "operator_client_files",
              entityId: clientOrgId,
              summary: filesPageContextSummary(clientContextName(client), state),
            })}
          />
        </main>
      )}
    </AppShell>
  );
}
