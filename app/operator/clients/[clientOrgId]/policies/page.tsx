"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useFollowedState } from "@/hooks/use-followed-state";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { ManagedClientPolicyWorkspace } from "@/components/policies/managed-client-policy-workspace";
import { AppShell } from "@/components/app-shell";
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
import { ListToolbar } from "@/components/ui/list-toolbar";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { OperatorPolicyPreview } from "./operator-policy-preview";

export default function OperatorClientPoliciesPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const client = clients?.find((row) => row._id === clientOrgId) ?? null;
  const [workspaceActions, setWorkspaceActions] = useState<ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const [previewPolicyId, setPreviewPolicyId] =
    useFollowedState<Id<"policies"> | null>(
      `clients:${clientOrgId}:policies:preview`,
      null,
    );
  const activeImpersonation = current?.activeImpersonation ?? null;
  const basePath = `/operator/clients/${clientOrgId}/policies`;
  const archivedPolicies = useCachedQuery(
    "policies.listForOperator",
    api.policies.listForOperator,
    client
      ? { clientOrgId: client._id, documentType: "policy", archived: true }
      : "skip",
  );
  const hasArchivedPolicies = (archivedPolicies?.length ?? 0) > 0;
  const archivedRequested = searchParams.get("view") === "archived";
  const showArchived = archivedRequested && archivedPolicies?.length !== 0;
  const policyStatus = showArchived ? "archived" : "active";

  useEffect(() => {
    if (archivedRequested && archivedPolicies?.length === 0) {
      router.replace(basePath);
    }
  }, [archivedRequested, archivedPolicies, basePath, router]);
  // Same subscription as the workspace's list, for the agent page context.
  const listedPolicies = useCachedQuery(
    "policies.listForOperator",
    api.policies.listForOperator,
    client
      ? { clientOrgId: client._id, documentType: "policy", archived: showArchived }
      : "skip",
  );
  const clientName = client ? clientContextName(client) : "the current client";
  const clientLabel = client ? (client.dba ?? client.name) : undefined;
  const policyPreview = useMemo(
    () =>
      previewPolicyId ? (
        <OperatorPolicyPreview
          clientOrgId={clientOrgId}
          clientLabel={clientLabel}
          policyId={previewPolicyId}
          onClose={() => setPreviewPolicyId(null)}
        />
      ) : null,
    [clientLabel, clientOrgId, previewPolicyId, setPreviewPolicyId],
  );

  const statusNavigation = (
    <ListToolbar
      followKey={`clients:${clientOrgId}:policies`}
      filters={[
        {
          id: "status",
          label: "Status",
          inline: true,
          allLabel: "Active",
          value: policyStatus === "archived" ? ["archived"] : [],
          onChange: (value) => {
            setPreviewPolicyId(null);
            router.push(
              value[0] === "archived" ? `${basePath}?view=archived` : basePath,
            );
          },
          options: [{ value: "archived", label: "Archived" }],
        },
      ]}
    />
  );

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
          <span className="truncate">Policies</span>
        </span>
      }
      rightPanel={rightPanel}
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client_policies",
          entityId: clientOrgId,
          summary: pageContextSummary([
            `Policies for ${clientName}`,
            `${policyStatus} policies${listedPolicies ? `, ${listedPolicies.length} shown` : ""}`,
            hasArchivedPolicies &&
              !showArchived &&
              `${archivedPolicies?.length} archived`,
            activeImpersonation && "read-only while impersonating",
          ]),
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
          {hasArchivedPolicies ? statusNavigation : null}
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
                  Stop the current impersonation session to upload, edit,
                  archive, or restore client policies directly as an operator.
                </p>
              </div>
            </OperationalPanel>
          ) : null}
          <ManagedClientPolicyWorkspace
            clientOrgId={clientOrgId}
            basePath={basePath}
            showArchived={showArchived}
            readOnly={Boolean(activeImpersonation)}
            onActions={setWorkspaceActions}
            onRightPanel={setRightPanel}
            onPolicySelect={setPreviewPolicyId}
            policyPreview={policyPreview}
          />
        </main>
      )}
    </AppShell>
  );
}
