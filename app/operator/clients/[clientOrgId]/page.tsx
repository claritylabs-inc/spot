"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  betaFeatureFlagsForOrgType,
  isFeatureEnabled,
  setFeatureFlagPatch,
  type FeatureFlagId,
} from "@/convex/lib/featureFlags";
import { AppShell } from "@/components/app-shell";
import { OperatorPageContextRegistration } from "@/components/operator-agent/operator-page-context";
import { AgentChannelsSection } from "@/components/settings/agent-channels-section";
import { FeatureFlagToggleRow } from "@/components/settings/feature-flag-toggle-row";
import {
  OrganizationInsuranceProfile,
  type OrganizationProfile,
} from "@/components/settings/organization-insurance-profile";
import { TeamSection } from "@/components/settings/team-section";
import {
  AutoSaveStatus,
  combineAutoSaveStatuses,
} from "@/components/ui/auto-save-status";
import { StatusTag } from "@/components/ui/status-tag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
  useOperatorClientCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  ClientCompanyDetails,
  type OperatorClientRelatedLegalEntity,
} from "./client-company-details";
import {
  parseOperatorClientSection,
  type OperatorClientPageTab,
} from "./operator-client-tabs";
import { OperatorClientSidebar } from "./operator-client-sidebar";
import {
  operatorClientStatusLabel,
  type OperatorClientRow,
} from "../client-model";
import { typeStyle } from "@/lib/typography";

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

function Field({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <label className={className}>
      <span
        className={`mb-1.5 block text-muted-foreground ${typeStyle("caption.medium")}`}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span
          className={`mt-1.5 block text-destructive ${typeStyle("caption.default")}`}
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ClientWorkspace({
  client,
  supportDetails,
  setShellActions,
  setRightPanel,
  registerBeforeImpersonationStart,
}: {
  client: OperatorClientRow;
  supportDetails: ClientSupportDetails;
  setShellActions: (actions: React.ReactNode) => void;
  setRightPanel: (panel: React.ReactNode) => void;
  registerBeforeImpersonationStart: (
    handler: (() => Promise<boolean>) | null,
  ) => void;
}) {
  const clientOrgId = client._id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { patchClientSettings, patchClientStatus } =
    useOperatorClientCacheActions();
  const activeTab = parseTab(searchParams.get("tab"));
  const [organizationName, setOrganizationName] = useState(supportDetails.name);
  const [website, setWebsite] = useState(supportDetails.website ?? "");
  const [industry, setIndustry] = useState(supportDetails.industry ?? "");
  const [industryVertical, setIndustryVertical] = useState(
    supportDetails.industryVertical ?? "",
  );
  const [relatedLegalEntities, setRelatedLegalEntities] = useState<
    OperatorClientRelatedLegalEntity[]
  >(supportDetails.relatedLegalEntities ?? []);
  const [textFieldFocused, setTextFieldFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [teamInviteOpen, setTeamInviteOpen] = useState(false);
  const [savingFeatureFlagId, setSavingFeatureFlagId] =
    useState<FeatureFlagId | null>(null);
  const [profileAutoSaveStatus, setProfileAutoSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "error"
  >("saved");

  const updateClientSettings = useMutation(api.operator.updateClientSettings);
  const updateOrganizationProfile = useMutation(
    api.orgs.updateOrganizationProfile,
  );
  const setClientFeatureFlag = useMutation(api.operator.setClientFeatureFlag);
  const setClientStatus = useMutation(api.operator.setSoloClientStatus);

  const validationError = !organizationName.trim()
    ? "Organization name is required"
    : null;

  const clientSettingsArgs = {
    clientOrgId,
    name: organizationName.trim(),
    website: website.trim() || undefined,
    industry: industry || undefined,
    industryVertical: industryVertical || undefined,
    relatedLegalEntities: relatedLegalEntities
      .map((entity) => ({
        ...entity,
        legalName: entity.legalName.trim(),
      }))
      .filter((entity) => entity.legalName),
  };
  const clientSettingsAutoSave = useLocalFirstAutoSave({
    mutationName: "operator.updateClientSettings",
    args: clientSettingsArgs,
    valueKey: JSON.stringify(clientSettingsArgs),
    resetKey: clientOrgId,
    enabled: true,
    canSave: !validationError,
    autoSave: !textFieldFocused,
    delayMs: 700,
    flush: async (args) => {
      await updateClientSettings(args);
      const { clientOrgId: updatedClientOrgId, ...patch } = args;
      await patchClientSettings(updatedClientOrgId, patch);
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Client settings could not be saved."),
  });
  const combinedSaveStatus = combineAutoSaveStatuses(
    clientSettingsAutoSave.status,
    profileAutoSaveStatus,
  );

  function navigate(tab: ClientTab) {
    if (tab !== "team") setTeamInviteOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.push(`/operator/clients/${clientOrgId}?${next.toString()}`);
  }

  function finishTextEdit() {
    setTextFieldFocused(false);
    void clientSettingsAutoSave.saveNow();
  }

  function requestClientSettingsSave() {
    requestAnimationFrame(() => {
      void clientSettingsAutoSave.saveNow();
    });
  }

  const saveOrganizationProfile = useCallback(
    (profile: OrganizationProfile | null) =>
      updateOrganizationProfile({
        operatorClientOrgId: clientOrgId,
        profile,
      }),
    [clientOrgId, updateOrganizationProfile],
  );

  const handleProfileAutoSaveChange = useCallback(
    (status: "saved" | "saving" | "unsaved" | "error") => {
      setProfileAutoSaveStatus(status);
    },
    [],
  );

  const saveClientSettingsNow = clientSettingsAutoSave.saveNow;

  const disableAccount = useCallback(async () => {
    setBusy(true);
    try {
      if (!(await saveClientSettingsNow())) return;
      await setClientStatus({ clientOrgId: client._id, status: "onboarding" });
      await patchClientStatus(client._id, "onboarding");
      setDisableDialogOpen(false);
      toast.success("Client account disabled");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to update client"));
    } finally {
      setBusy(false);
    }
  }, [client._id, patchClientStatus, saveClientSettingsNow, setClientStatus]);

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

  useEffect(() => {
    if (activeTab === "overview") {
      setShellActions(<AutoSaveStatus status={combinedSaveStatus} />);
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
  }, [activeTab, combinedSaveStatus, setShellActions]);

  useEffect(() => {
    registerBeforeImpersonationStart(saveClientSettingsNow);
    return () => registerBeforeImpersonationStart(null);
  }, [registerBeforeImpersonationStart, saveClientSettingsNow]);

  return (
    <>
      <main className="w-full space-y-6">
        {activeTab === "overview" ? (
          <div className="space-y-5">
            <OperationalPanel>
              <OperationalPanelBody>
                <FormSection
                  title="Account"
                  divided={false}
                  action={
                    <StatusTag
                      tone={
                        client.operatorStatus === "live" && !client.inviteStatus
                          ? "success"
                          : "warning"
                      }
                    >
                      {operatorClientStatusLabel(client)}
                    </StatusTag>
                  }
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Organization name" error={validationError}>
                      <Input
                        value={organizationName}
                        aria-invalid={Boolean(validationError)}
                        onChange={(event) =>
                          setOrganizationName(event.target.value)
                        }
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="Client organization"
                      />
                    </Field>
                    <Field label="Website">
                      <Input
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        onFocus={() => setTextFieldFocused(true)}
                        onBlur={finishTextEdit}
                        placeholder="https://example.com"
                      />
                    </Field>
                  </div>
                </FormSection>
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel aria-label="Company details and insurance profile">
              <OperationalPanelBody className="space-y-4">
                <ClientCompanyDetails
                  industry={industry}
                  industryVertical={industryVertical}
                  relatedLegalEntities={relatedLegalEntities}
                  setIndustry={setIndustry}
                  setIndustryVertical={setIndustryVertical}
                  setRelatedLegalEntities={setRelatedLegalEntities}
                  onSaveRequested={requestClientSettingsSave}
                  onTextFocus={() => setTextFieldFocused(true)}
                  onTextBlur={finishTextEdit}
                />
                <OrganizationInsuranceProfile
                  key={String(supportDetails._id)}
                  org={supportDetails}
                  onSaveProfile={saveOrganizationProfile}
                  onAutoSaveChange={handleProfileAutoSaveChange}
                />
              </OperationalPanelBody>
            </OperationalPanel>

            <OperationalPanel>
              <OperationalPanelHeader
                className="items-center border-b-0"
                title="Account access"
                description={
                  client.operatorStatus === "onboarding"
                    ? "Send an activation email to an admin from Team to enable access."
                    : "Activation emails can be resent to admins who have not activated their account."
                }
                action={
                  client.operatorStatus === "onboarding" ? (
                    <PillButton
                      variant="secondary"
                      onClick={() => navigate("team")}
                    >
                      Open team
                    </PillButton>
                  ) : (
                    <PillButton
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setDisableDialogOpen(true)}
                    >
                      Disable account
                    </PillButton>
                  )
                }
              />
            </OperationalPanel>
          </div>
        ) : null}

        {activeTab === "team" ? (
          <TeamSection
            operatorClient={supportDetails}
            inviteOpen={teamInviteOpen}
            onInviteOpenChange={setTeamInviteOpen}
            showInviteAction={false}
            setOperatorRightPanel={setRightPanel}
            onOperatorActivationSent={() =>
              patchClientStatus(client._id, "live")
            }
          />
        ) : null}

        {activeTab === "settings" ? (
          <div className="space-y-5">
            <section className="space-y-3" aria-label="Agent channels">
              <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
                Agent channels
              </h2>
                <AgentChannelsSection
                clientOrgId={client._id}
                defaultClientSlug={slackChannelSlug(client)}
                defaultInviteEmail={
                  client.primaryContactEmail ?? client.adminEmail
                }
                defaultInviteUserId={supportDetails.primaryInsuranceContactId}
                setRightPanel={setRightPanel}
              />
            </section>
            <section className="space-y-3" aria-label="Beta features">
              <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
                Beta features
              </h2>
              {betaFeatureFlagsForOrgType("client").map((flag) => (
                <FeatureFlagToggleRow
                  key={flag.id}
                  flag={flag}
                  enabled={isFeatureEnabled(client, flag.id)}
                  onChange={(enabled) => void updateFeatureFlag(flag.id, enabled)}
                  loading={savingFeatureFlagId === flag.id}
                  disabled={savingFeatureFlagId !== null}
                />
              ))}
            </section>
          </div>
        ) : null}
      </main>

      <Dialog
        open={disableDialogOpen}
        onOpenChange={(open) => {
          if (!busy) setDisableDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disable account</DialogTitle>
            <DialogDescription>
              Disable <strong>{client.name}</strong>? The client will lose
              access to Spot and return to onboarding. You can send a new
              activation email later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => setDisableDialogOpen(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={busy}
              onClick={() => void disableAccount()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy ? "Disabling…" : "Disable account"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function OperatorClientPage() {
  const { clientOrgId } = useParams<{ clientOrgId: string }>();
  const searchParams = useSearchParams();
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  const supportDetails = useQuery(api.operator.getClientSupportDetails, {
    clientOrgId: clientOrgId as Id<"organizations">,
  });
  const [workspaceActions, setWorkspaceActions] =
    useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const beforeImpersonationStartRef = useRef<(() => Promise<boolean>) | null>(
    null,
  );
  const registerBeforeImpersonationStart = useCallback(
    (handler: (() => Promise<boolean>) | null) => {
      beforeImpersonationStartRef.current = handler;
    },
    [],
  );
  const client = clients?.find((item) => item._id === clientOrgId) ?? null;
  const activeTab = parseOperatorClientSection(searchParams.get("tab"));
  const breadcrumbSection =
    activeTab === "team" ? "Team" : activeTab === "settings" ? "Settings" : null;

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
              {client?.name ?? "Client"}
            </Link>
            <span className="text-muted-foreground/30" aria-hidden="true">
              /
            </span>
            <span className="truncate">{breadcrumbSection}</span>
          </span>
        ) : (
          (client?.name ?? "Client")
        )
      }
      rightPanel={rightPanel}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorClientSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          clientOrgId={clientOrgId}
          activeImpersonation={current?.activeImpersonation}
          impersonationDisabled={!client}
          beforeImpersonationStart={async () =>
            beforeImpersonationStartRef.current?.()
          }
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      <OperatorPageContextRegistration
        context={{
          pageType: "operator_client",
          entityId: clientOrgId,
          summary: client ? `Client: ${client.name}` : "Current client",
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
          registerBeforeImpersonationStart={registerBeforeImpersonationStart}
        />
      )}
    </AppShell>
  );
}
