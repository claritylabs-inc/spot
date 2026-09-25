"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { ManagedClientPolicyWorkspace } from "@/components/policies/managed-client-policy-workspace";
import { AppShell } from "@/components/app-shell";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
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
  const [previewPolicyId, setPreviewPolicyId] = useState<Id<"policies"> | null>(
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
  const policyPreview = useMemo(
    () =>
      previewPolicyId ? (
        <OperatorPolicyPreview
          clientOrgId={clientOrgId}
          policyId={previewPolicyId}
          onClose={() => setPreviewPolicyId(null)}
        />
      ) : null,
    [clientOrgId, previewPolicyId],
  );

  const statusNavigation = (
    <Tabs
      value={policyStatus}
      onValueChange={(value) => {
        if (!value) return;
        setPreviewPolicyId(null);
        router.push(
          value === "archived" ? `${basePath}?view=archived` : basePath,
        );
      }}
    >
      <TabsList variant="pill" aria-label="Policy status" className="min-w-max">
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="archived">Archived</TabsTrigger>
      </TabsList>
    </Tabs>
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
          {hasArchivedPolicies ? (
            <div className="overflow-x-auto">{statusNavigation}</div>
          ) : null}
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
