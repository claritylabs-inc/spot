"use client";

import { useCallback, useEffect, useState } from "react";
import { useFollowedState } from "@/hooks/use-followed-state";
import Link from "next/link";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import type { Id } from "@/convex/_generated/dataModel";
import {
  betaFeatureFlagsForOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
} from "@/convex/lib/featureFlags";
import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import {
  clientContextName,
  pageContextSummary,
} from "@/components/operator-agent/operator-client-page-context";
import { AgentChannelsSection } from "@/components/settings/agent-channels-section";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import { TeamSection } from "@/components/settings/team-section";
import { usePageContextLayer } from "@/hooks/use-page-context";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";

import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  parseOperatorClientSection,
  type OperatorClientPageTab,
} from "./operator-client-tabs";
import { type OperatorClientRow } from "../client-model";
import OperatorClientWikiPage from "./wiki/page";

type ClientTab = OperatorClientPageTab;
type ClientSupportDetails = NonNullable<
  FunctionReturnType<typeof api.operator.getClientSupportDetails>
>;

function parseTab(value: string | null): ClientTab {
  return parseOperatorClientSection(value);
}

function slackChannelSlug(client: OperatorClientRow) {
  if (client.agentHandle) return client.agentHandle;
  return client.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function ClientWorkspace({
  client,
  supportDetails,
  setShellActions,
  setRightPanel,
}: {
  client: OperatorClientRow;
  supportDetails: ClientSupportDetails;
  setShellActions: (actions: React.ReactNode) => void;
  setRightPanel: (panel: React.ReactNode) => void;
}) {
  const clientOrgId = client._id;
  const searchParams = useSearchParams();
  const { patchClientSettings, patchClientStatus } =
    useOperatorClientCacheActions();
  const activeTab = parseTab(searchParams.get("tab"));
  const [settingsTab, setSettingsTab] = useFollowedState(
    `clients:${clientOrgId}:settings:tab`,
    "channels",
  );
  const [teamInviteOpen, setTeamInviteOpen] = useFollowedState(
    `clients:${clientOrgId}:team:invite-open`,
    false,
  );
  const handleOperatorActivationSent = useCallback(
    () =>
      patchClientStatus(clientOrgId, "active"),
    [clientOrgId, patchClientStatus],
  );
  const [savingFeatureFlagId, setSavingFeatureFlagId] =
    useState<FeatureFlagId | null>(null);
  const setClientFeatureFlag = useMutation(api.operator.setClientFeatureFlag);

  async function updateFeatureFlag(flagId: FeatureFlagId, enabled: boolean) {
    const previousFlags = client.featureFlags;
    const nextFlags = setFeatureFlagPatch(previousFlags, flagId, enabled);
    setSavingFeatureFlagId(flagId);
    await patchClientSettings(client._id, { featureFlags: nextFlags });
    try {
      await setClientFeatureFlag({ clientOrgId: client._id, flagId, enabled });
      toast.success("Beta feature updated");
    } catch (error) {
      await patchClientSettings(client._id, { featureFlags: previousFlags });
      toast.error(
        getUserFacingErrorMessage(error, "Failed to update beta feature"),
      );
    } finally {
      setSavingFeatureFlagId(null);
    }
  }

  usePageContextLayer({
    pageType: "operator_client",
    entityId: clientOrgId,
    summary: pageContextSummary([
      `Client: ${clientContextName(client)}`,
      `access status ${client.clientAccessStatus}`,
      activeTab === "team"
        ? `Team tab${teamInviteOpen ? ", invite member drawer open" : ""}`
        : `Settings tab, ${settingsTab === "features" ? "Beta features" : "Agent channels"} section`,
    ]),
  });

  useEffect(() => {
    if (activeTab === "settings") {
      setShellActions(null);
    } else if (activeTab === "team") {
      setShellActions(
        <PillButton size="compact" onClick={() => setTeamInviteOpen(true)}>
          <UserPlus className="size-3.5" />
          Invite member
        </PillButton>,
      );
    } else {
      setShellActions(null);
    }

    return () => {
      setShellActions(null);
    };
  }, [activeTab, setShellActions, setTeamInviteOpen]);

  return (
    <>
      <main className="w-full space-y-6">
        {activeTab === "settings" ? (
          <PageTabs
            value={settingsTab}
            onValueChange={(value) => setSettingsTab(String(value))}
          >
            <PageTabsList aria-label="Client settings">
              <TabsTrigger value="channels">Agent channels</TabsTrigger>
              <TabsTrigger value="features">Beta features</TabsTrigger>
            </PageTabsList>
            <TabsContent value="channels">
              <AgentChannelsSection
                clientOrgId={client._id}
                defaultClientSlug={slackChannelSlug(client)}
                defaultInviteEmail={
                  client.primaryContactEmail ?? client.adminEmail
                }
                defaultInviteUserId={supportDetails.primaryInsuranceContactId}
                setRightPanel={setRightPanel}
              />
            </TabsContent>
            <TabsContent value="features" className="space-y-3">
              {betaFeatureFlagsForOrgType("client").map((flag) => (
                <FeatureFlagToggleRow
                  key={flag.id}
                  flag={flag}
                  enabled={isFeatureEnabled(client, flag.id)}
                  onChange={(enabled) =>
                    void updateFeatureFlag(flag.id, enabled)
                  }
                  loading={savingFeatureFlagId === flag.id}
                  disabled={savingFeatureFlagId !== null}
                />
              ))}
            </TabsContent>
          </PageTabs>
        ) : null}

        {activeTab === "team" ? (
          <TeamSection
            operatorClient={supportDetails}
            inviteOpen={teamInviteOpen}
            onInviteOpenChange={setTeamInviteOpen}
            showInviteAction={false}
            setOperatorRightPanel={setRightPanel}
            onOperatorActivationSent={handleOperatorActivationSent}
          />
        ) : null}
      </main>
    </>
  );
}

export default function OperatorClientPage() {
  const searchParams = useSearchParams();
  return parseOperatorClientSection(searchParams.get("tab")) === "wiki" ? (
    <OperatorClientWikiPage />
  ) : (
    <OperatorClientSettingsPage />
  );
}

function OperatorClientSettingsPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const searchParams = useSearchParams();
  const clients = useCachedOperatorClients();
  const supportDetails = useCachedQuery(
    "operator.getClientSupportDetails",
    api.operator.getClientSupportDetails,
    {
      clientOrgId: clientOrgId as Id<"organizations">,
    },
  );
  const [workspaceActions, setWorkspaceActions] =
    useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const client = clients?.find((item) => item._id === clientOrgId) ?? null;
  const activeTab = parseOperatorClientSection(searchParams.get("tab"));
  const breadcrumbSection =
    activeTab === "team"
      ? "Team"
      : activeTab === "settings"
        ? "Settings"
        : null;

  return (
    <AppShell
      actions={workspaceActions}
      breadcrumbDetail={
        breadcrumbSection ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/operator/clients/${clientOrgId}`}
              className="truncate text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              {client ? (client.dba ?? client.name) : "Client"}
            </Link>
            <span className="text-muted-foreground/30" aria-hidden="true">
              /
            </span>
            <span className="truncate">{breadcrumbSection}</span>
          </span>
        ) : (
          (client ? (client.dba ?? client.name) : "Client")
        )
      }
      rightPanel={rightPanel}
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client",
          entityId: clientOrgId,
          summary: client
            ? `Client: ${clientContextName(client)}`
            : "Current client",
        }}
      />
      {clients === undefined || supportDetails === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : !client || !supportDetails ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client not found" />
          <OperationalPanelBody>
            <PillButton href="/operator/clients" variant="secondary">
              Back to clients
            </PillButton>
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <ClientWorkspace
          key={client._id}
          client={client}
          supportDetails={supportDetails}
          setShellActions={setWorkspaceActions}
          setRightPanel={setRightPanel}
        />
      )}
    </AppShell>
  );
}
