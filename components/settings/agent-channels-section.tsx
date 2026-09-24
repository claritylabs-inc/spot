"use client";

import dayjs from "dayjs";
import { useEffect, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  missingSlackCustomerScopes,
  SLACK_INSTALL_INVITE_EXPIRATION_DAYS,
} from "@/convex/lib/slackOAuthPolicy";
import { resolveSlackAutomaticChannel } from "@/convex/lib/slackChannelRouting";
import { HandleAvailability } from "@/components/settings/handle-availability";
import { SlackConnectionFields } from "@/components/settings/slack-connection-fields";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { FormSection } from "@claritylabs-inc/ui/components/form-section";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { StatusTag, type StatusIndicatorKind, type StatusPresentation, type StatusTagTone } from "@claritylabs-inc/ui/components/status-tag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { getPublicAgentDomain } from "@/lib/domains";
import { openOAuthTab } from "@/lib/oauth-tab";
import { useOperatorClientCacheActions } from "@/lib/sync/operator-cached-queries";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { resolveSlackRowStatus } from "@/lib/slack-setup-status";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type ChannelSettings = {
  emailEnabled: boolean;
  imessageEnabled: boolean;
  slackEnabled: boolean;
  slackSafeAlertsEnabled: boolean;
  slackVendorAlertsEnabled: boolean;
};

type ChannelDrawer = "email" | "imessage" | "slack";
type SlackSetupStep = "install" | "support" | "channels" | "automations";

type AgentEmailAddress = {
  handle: string | null;
  configuredHandle: string | null;
  source: "client" | "shared";
  ownerOrgId: Id<"organizations">;
  ownerName: string;
};

type SlackSetupState = {
  _id: Id<"slackSetupStates">;
  mode: "initial" | "reinstall";
  status: "in_progress" | "completed" | "cancelled";
  currentStep: SlackSetupStep;
  deferredSteps: Array<Exclude<SlackSetupStep, "automations">>;
  inviteRecipientEmail?: string;
  inviteSentAt?: number;
  inviteExpiresAt?: number;
  installationCompletedAt?: number;
  supportOmittedOperators?: Array<{
    displayName: string;
    email: string;
    reason: string;
  }>;
  supportOperatorInvitesSucceeded?: boolean;
  supportOperatorInviteError?: string;
  supportInviteSentAt?: number;
  supportInviteError?: string;
  startedAt: number;
};

const SLACK_SETUP_STEPS: Array<{
  id: SlackSetupStep;
  title: string;
  description: string;
}> = [
  {
    id: "install",
    title: "Install Spot",
    description: "Send the client Slack admin a secure installation link.",
  },
  {
    id: "support",
    title: "Set up client support",
    description:
      "Create the dedicated Slack Connect channel with Clarity Labs.",
  },
  {
    id: "channels",
    title: "Add more channels",
    description: "Choose additional client workspace channels for Spot.",
  },
  {
    id: "automations",
    title: "Review automations",
    description: "Choose what Spot may post automatically in Slack.",
  },
];

function ChannelCard({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-popover px-4 py-3">
      <div>
        <p className={`text-foreground ${typeStyle("body.medium")}`}>{title}</p>
        <p
          className={`mt-0.5 text-muted-foreground/60 ${typeStyle("caption.default")}`}
        >
          {description}
        </p>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        <SettingsSwitch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          label={`${title} availability`}
        />
      </div>
    </div>
  );
}

function ChannelRow({
  title,
  description,
  status,
  statusTone,
  statusIndicator,
  onClick,
}: {
  title: string;
  description: string;
  status: string;
  statusTone: StatusTagTone;
  statusIndicator?: StatusIndicatorKind;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-popover px-4 py-3 text-left transition-colors hover:bg-foreground/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized"
    >
      <span className="min-w-0">
        <span className={`block text-foreground ${typeStyle("body.medium")}`}>
          {title}
        </span>
        <span
          className={`mt-0.5 block text-muted-foreground/60 ${typeStyle("caption.default")}`}
        >
          {description}
        </span>
      </span>
      <span className="ml-4 flex shrink-0 items-center gap-2">
        <StatusTag tone={statusTone} indicator={statusIndicator}>{status}</StatusTag>
        <ChevronRight className="size-4 text-muted-foreground/50" />
      </span>
    </button>
  );
}

function normalizeAgentHandleInput(value: string) {
  return (value.trim().toLowerCase().split("@")[0] ?? "").replace(
    /[^a-z0-9-]/g,
    "",
  );
}

function agentEmailAddressDescription(address: AgentEmailAddress) {
  if (address.source === "shared") {
    return "Spot identifies this standalone client from the sender’s email address.";
  }
  return `Dedicated to ${address.ownerName}.`;
}

function AgentEmailAddressField({
  address,
  canEdit,
  allowSharedDefault,
  onSave,
  onSaved,
}: {
  address: AgentEmailAddress;
  canEdit: boolean;
  allowSharedDefault: boolean;
  onSave?: (handle: string | undefined) => Promise<string | null>;
  onSaved?: (handle: string | undefined) => void;
}) {
  const agentDomain = getPublicAgentDomain();
  const currentHandle = address.configuredHandle ?? "";
  const [handle, setHandle] = useState(currentHandle);
  const [debouncedHandle, setDebouncedHandle] = useState(currentHandle);
  const [focused, setFocused] = useState(false);
  const normalizedHandle = normalizeAgentHandleInput(handle);
  const resetKey = `${address.ownerOrgId}:${currentHandle}`;

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedHandle(normalizedHandle),
      300,
    );
    return () => window.clearTimeout(timeout);
  }, [normalizedHandle]);

  const shouldCheck =
    canEdit && debouncedHandle.length >= 3 && debouncedHandle !== currentHandle;
  const availability = useQuery(
    api.orgs.checkHandleAvailability,
    shouldCheck
      ? {
          handle: debouncedHandle,
          excludeOrgId: address.ownerOrgId,
        }
      : "skip",
  );
  const checking =
    canEdit &&
    normalizedHandle.length >= 3 &&
    normalizedHandle !== currentHandle &&
    (debouncedHandle !== normalizedHandle || availability === undefined);
  const canSaveHandle =
    normalizedHandle === debouncedHandle &&
    (normalizedHandle.length === 0
      ? allowSharedDefault
      : normalizedHandle === currentHandle || availability?.available === true);
  const autoSave = useLocalFirstAutoSave({
    mutationName: `agentChannels.emailAddress.${address.ownerOrgId}`,
    args: { handle: normalizedHandle || undefined },
    valueKey: normalizedHandle,
    resetKey,
    enabled: canEdit && Boolean(onSave),
    canSave: canSaveHandle,
    autoSave: !focused,
    delayMs: 0,
    flush: async (args) => {
      if (!onSave) return null;
      return await onSave(args.handle);
    },
    onFlushed: (savedHandle) => {
      const nextHandle = savedHandle ?? undefined;
      const input = nextHandle ?? "";
      setHandle(input);
      setDebouncedHandle(input);
      onSaved?.(nextHandle);
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(
        error,
        "The agent email address could not be saved.",
      ),
  });

  return (
    <FormSection
      title="Agent email address"
      description={agentEmailAddressDescription(address)}
      action={
        !canEdit ? <Badge variant="outline">Read only</Badge> : undefined
      }
      divided={false}
    >
      {canEdit ? (
        <>
          <AutoSaveStatus status={autoSave.status} />
          <div className="flex h-9 overflow-hidden rounded-lg border border-input bg-popover focus-within:border-border-focus focus-within:ring-1 focus-within:ring-input">
            <input
              aria-label="Agent email address"
              className={`min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-muted-foreground/40 ${typeStyle("control.input")}`}
              value={handle}
              onChange={(event) =>
                setHandle(normalizeAgentHandleInput(event.target.value))
              }
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={allowSharedDefault ? "agent" : "team-handle"}
              maxLength={30}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <span
              className={`flex shrink-0 items-center border-l border-input bg-muted/35 px-3 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              @{agentDomain}
            </span>
          </div>
          {normalizedHandle ? (
            <HandleAvailability
              saving={autoSave.saving}
              checking={checking}
              input={normalizedHandle}
              current={currentHandle}
              currentLabel="Current agent email address"
              availability={
                normalizedHandle === debouncedHandle ? availability : undefined
              }
              renderAvailablePreview={(value) =>
                `${value}@${agentDomain} is available`
              }
            />
          ) : (
            <p
              className={`min-h-5 pt-1 ${typeStyle("caption.default")} ${
                allowSharedDefault
                  ? "text-muted-foreground"
                  : "text-destructive"
              }`}
            >
              {allowSharedDefault
                ? `Leave blank to use agent@${agentDomain}.`
                : "Enter an agent email address."}
            </p>
          )}
        </>
      ) : (
        <div className="cursor-not-allowed rounded-lg">
          <Input
            aria-label="Agent email address"
            disabled
            value={
              address.handle
                ? `${address.handle}@${agentDomain}`
                : "Not configured"
            }
            className="bg-muted/60 text-muted-foreground disabled:opacity-100"
          />
        </div>
      )}
    </FormSection>
  );
}

function SetupHeader({ step }: { step: SlackSetupStep }) {
  const stepIndex = SLACK_SETUP_STEPS.findIndex((item) => item.id === step);
  const current = SLACK_SETUP_STEPS[stepIndex];
  return (
    <div className="space-y-1 pb-1">
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Step {stepIndex + 1} of {SLACK_SETUP_STEPS.length}
      </p>
      <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
        {current.title}
      </h2>
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        {current.description}
      </p>
    </div>
  );
}

function SlackAvailabilityCard({
  settings,
  canEdit,
  busy,
  onSave,
}: {
  settings: ChannelSettings;
  canEdit: boolean;
  busy: boolean;
  onSave: (settings: ChannelSettings) => void;
}) {
  return (
    <ChannelCard
      title="Available in Slack"
      description="Let members use Spot privately and in connected channels."
      checked={settings.slackEnabled}
      disabled={!canEdit || busy}
      onChange={() =>
        onSave({ ...settings, slackEnabled: !settings.slackEnabled })
      }
    />
  );
}

function AutomationSettings({
  settings,
  automaticChannelId,
  canEdit,
  busy,
  onSave,
  showHeader = true,
}: {
  settings: ChannelSettings;
  automaticChannelId?: string;
  canEdit: boolean;
  busy: boolean;
  onSave: (settings: ChannelSettings) => void;
  showHeader?: boolean;
}) {
  const content = (
    <div className="space-y-3">
      <ChannelCard
        title="Compliance and policy-change alerts"
        description="Post client compliance and policy-change updates."
        checked={settings.slackSafeAlertsEnabled}
        disabled={!canEdit || busy || !settings.slackEnabled}
        onChange={() =>
          onSave({
            ...settings,
            slackSafeAlertsEnabled: !settings.slackSafeAlertsEnabled,
          })
        }
      />
      <ChannelCard
        title="Vendor alerts"
        description="Post vendor compliance updates."
        checked={settings.slackVendorAlertsEnabled}
        disabled={!canEdit || busy || !settings.slackEnabled}
        onChange={() =>
          onSave({
            ...settings,
            slackVendorAlertsEnabled: !settings.slackVendorAlertsEnabled,
          })
        }
      />
    </div>
  );
  return showHeader ? (
    <FormSection
      title="Automations"
      description={
        automaticChannelId
          ? undefined
          : "Automatic posts begin after a default channel is selected."
      }
      divided={false}
    >
      {content}
    </FormSection>
  ) : (
    <div className="space-y-2">
      {content}
      {!automaticChannelId ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Automatic posts begin after a default channel is selected.
        </p>
      ) : null}
    </div>
  );
}

export function AgentChannelsSection({
  clientOrgId,
  defaultClientSlug = "",
  defaultInviteEmail = "",
  defaultInviteUserId,
  setRightPanel: setRightPanelOverride,
}: {
  clientOrgId: Id<"organizations">;
  defaultClientSlug?: string;
  defaultInviteEmail?: string;
  defaultInviteUserId?: Id<"users">;
  setRightPanel?: (node: ReactNode) => void;
}) {
  const { setRightPanel: setSettingsRightPanel } = useSettingsActions();
  const setRightPanel = setRightPanelOverride ?? setSettingsRightPanel;
  const { patchClientSettings } = useOperatorClientCacheActions();
  const viewer = useQuery(api.users.viewer);
  const isOperator = viewer?.accountKind === "operator";
  const customerResult = useQuery(
    api.agentChannels.get,
    viewer && !isOperator ? { clientOrgId } : "skip",
  );
  const operatorResult = useQuery(
    api.agentChannels.getForOperator,
    isOperator ? { clientOrgId } : "skip",
  );
  const clientTeamMembers = useQuery(
    api.orgs.listMembers,
    isOperator ? { operatorClientOrgId: clientOrgId } : "skip",
  );
  const result = isOperator ? operatorResult : customerResult;
  const canEdit = Boolean(result?.permissions.canManage);
  const canRecoverSlack = Boolean(result?.permissions.canRecover);
  const canDisconnectSlack = Boolean(result?.permissions.canDisconnect);

  const update = useMutation(api.agentChannels.update);
  const updateForOperator = useMutation(api.agentChannels.updateForOperator);
  const updateStandaloneAgentEmailHandleForOperator = useMutation(
    api.agentChannels.updateStandaloneAgentEmailHandleForOperator,
  );
  const startSetup = useMutation(api.agentChannels.startSlackSetup);
  const setSetupStep = useMutation(api.agentChannels.setSlackSetupStep);
  const finishSetup = useMutation(api.agentChannels.finishSlackSetup);
  const cancelSetup = useMutation(api.agentChannels.cancelSlackSetup);
  const bindPrimaryChannel = useMutation(
    api.agentChannels.bindPrimaryChannelForOperator,
  );
  const beginOAuth = useAction(api.actions.slackOAuth.begin);
  const sendSlackInstallInvite = useAction(
    api.actions.slackOAuth.sendInstallInvite,
  );
  const disconnect = useAction(api.actions.slackOAuth.disconnect);
  const provisionPrimary = useAction(api.slackOnboarding.createPrimaryChannel);

  const [activeDrawer, setActiveDrawer] = useState<ChannelDrawer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteMemberId, setInviteMemberId] = useState<Id<"users"> | null>(
    defaultInviteUserId ?? null,
  );
  const clientSlug = defaultClientSlug;
  const [channelRefreshToken, setChannelRefreshToken] = useState(0);
  const [compactSlackTab, setCompactSlackTab] = useState("overview");
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [manualSetupReason, setManualSetupReason] = useState<string | null>(
    null,
  );
  const [hostTeamId, setHostTeamId] = useState("");
  const [hostChannelId, setHostChannelId] = useState("");
  const [customerChannelId, setCustomerChannelId] = useState("");
  const [manualChannelName, setManualChannelName] = useState("");

  const connection = result?.connection;
  const slackHealth = result?.slackHealth;
  const agentEmailAddress = result?.agentEmailAddress;
  const supportChannel = result?.supportChannel ?? result?.primaryChannel;
  const joinedChannels = result?.joinedChannels ?? [];
  const settings = result?.settings;
  const setupStatus = result?.setup?.status ?? null;
  const operatorSetup =
    isOperator && result?.setup && "currentStep" in result.setup
      ? (result.setup as SlackSetupState)
      : null;
  const setupInProgress = operatorSetup?.status === "in_progress";
  const slackNeedsReinstall =
    !!connection &&
    (missingSlackCustomerScopes(connection.grantedScopes).length > 0 ||
      slackHealth?.status === "revoked" ||
      slackHealth?.status === "disconnected");
  const slackReady =
    connection?.status === "active" &&
    slackHealth?.status !== "degraded" &&
    !slackNeedsReinstall;
  const isMockSlack = result?.slackMode === "mock";
  const automaticChannel = connection
    ? resolveSlackAutomaticChannel(connection, supportChannel)
    : undefined;
  const automaticChannelId = automaticChannel?.channelId;
  const setupStep = operatorSetup?.currentStep ?? "install";
  const installComplete = Boolean(
    slackReady &&
    operatorSetup &&
    (operatorSetup.mode === "initial" ||
      (operatorSetup.installationCompletedAt &&
        operatorSetup.installationCompletedAt >= operatorSetup.startedAt)),
  );
  const clientSetupPending =
    !isOperator &&
    (!slackReady || setupStatus === "in_progress" || slackNeedsReinstall);
  const persistedManualSetupReason = operatorSetup?.supportInviteError;
  const resolvedManualSetupReason =
    manualSetupReason ?? persistedManualSetupReason ?? null;
  const inviteMembers = (clientTeamMembers ?? []).filter((member) =>
    Boolean(member.email),
  );
  const selectedInviteMember =
    inviteMembers.find((member) => member.userId === inviteMemberId) ??
    inviteMembers.find((member) => member.userId === defaultInviteUserId) ??
    inviteMembers.find(
      (member) =>
        member.email?.toLowerCase() === defaultInviteEmail.toLowerCase(),
    ) ??
    inviteMembers.find((member) => member.role === "admin") ??
    inviteMembers[0];
  const inviteEmail = selectedInviteMember?.email ?? "";
  const canEditAgentEmailAddress = Boolean(
    agentEmailAddress &&
    isOperator &&
    agentEmailAddress.ownerOrgId === clientOrgId,
  );

  async function saveAgentEmailHandle(handle: string | undefined) {
    if (!agentEmailAddress || !canEditAgentEmailAddress) {
      throw new Error("The agent email address is read-only");
    }
    return await updateStandaloneAgentEmailHandleForOperator({
      clientOrgId,
      handle,
    });
  }

  function handleAgentEmailSaved(handle: string | undefined) {
    if (!agentEmailAddress) return;
    void patchClientSettings(clientOrgId, { agentHandle: handle });
  }

  async function save(nextSettings: ChannelSettings) {
    if (!canEdit) return;
    setBusy("settings");
    try {
      if (isOperator) {
        await updateForOperator({ clientOrgId, ...nextSettings });
      } else {
        await update(nextSettings);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Agent channels could not be saved"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function beginSetup(mode: "initial" | "reinstall") {
    setBusy("start-setup");
    try {
      await startSetup({ clientOrgId, mode });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not start"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function openSlackDrawer() {
    setActiveDrawer("slack");
    if (!isOperator || setupInProgress) return;
    if (!connection || slackNeedsReinstall) {
      await beginSetup(connection ? "reinstall" : "initial");
    }
  }

  async function connectMockSlack() {
    setBusy("oauth");
    try {
      await beginOAuth({
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      });
      toast.success(connection ? "Spot updated" : "Slack connected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not start"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function recoverSlack() {
    if (isOperator) {
      await beginSetup("reinstall");
      return;
    }
    const oauthTab = openOAuthTab();
    if (!oauthTab) {
      toast.error("Allow pop-ups for Spot to reinstall Slack in a new tab");
      return;
    }
    setBusy("oauth");
    try {
      const response = await beginOAuth({
        clientOrgId,
        thirdPartyVisibilityAcknowledged: true,
      });
      if (response.url) {
        if (!oauthTab.navigate(response.url)) {
          throw new Error("The Slack setup tab was closed. Try again.");
        }
      } else {
        oauthTab.close();
        toast.success("Slack reinstalled");
      }
    } catch (error) {
      oauthTab.close();
      toast.error(
        getUserFacingErrorMessage(error, "Slack could not be reinstalled"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendInstallInvite() {
    setBusy("install-invite");
    try {
      const response = await sendSlackInstallInvite({
        clientOrgId,
        recipientEmail: inviteEmail,
      });
      toast.success(
        `${response.mode === "reinstall" ? "Slack update" : "Slack install"} invite sent to ${response.recipientEmail}`,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The Slack installation invite could not be sent",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function createPrimary() {
    setBusy("provision");
    try {
      const response = await provisionPrimary({
        clientOrgId,
        clientSlug,
        inviteEmail,
      });
      if (!response.created) {
        setManualSetupReason(
          response.manualSetupRequired ? response.reason : null,
        );
        toast.error(
          response.manualSetupRequired
            ? `Slack requires manual channel setup: ${response.reason}`
            : response.reason,
        );
        return;
      }
      setManualSetupReason(
        response.manualSetupRequired ? (response.reason ?? null) : null,
      );
      if (
        response.reason ||
        response.operatorInvites?.succeeded === false ||
        response.omittedOperators.length > 0
      ) {
        toast.warning(`#${response.channelName} created with setup warnings`);
      } else {
        toast.success(`#${response.channelName} created and invitation sent`);
      }
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The Slack Connect channel could not be created",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveManualPrimaryChannel() {
    setBusy("manual-channel");
    try {
      await bindPrimaryChannel({
        clientOrgId,
        hostTeamId,
        hostChannelId,
        customerChannelId: customerChannelId.trim() || undefined,
        channelName: manualChannelName.replace(/^#/, ""),
      });
      setManualSetupReason(null);
      toast.success("Client support channel connected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "The client support channel could not be connected",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function changeSetupStep(
    step: SlackSetupStep,
    deferredStep?: Exclude<SlackSetupStep, "automations">,
  ) {
    setBusy("setup-step");
    try {
      await setSetupStep({ clientOrgId, step, deferredStep });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not continue"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function completeSetup() {
    setBusy("finish-setup");
    try {
      await finishSetup({ clientOrgId });
      toast.success("Slack setup complete");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack setup could not be completed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function cancelReinstall() {
    setBusy("cancel-setup");
    try {
      await cancelSetup({ clientOrgId });
      toast.success("Slack reinstall cancelled");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Slack reinstall could not be cancelled",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeConnection() {
    setBusy("disconnect");
    try {
      await disconnect({ clientOrgId });
      setDisconnectDialogOpen(false);
      setActiveDrawer(null);
      toast.success("Slack disconnected");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Slack could not be disconnected"),
      );
    } finally {
      setBusy(null);
    }
  }

  const supportStatus: { label: string } & StatusPresentation =
    (supportChannel && supportChannel.status !== "active") ||
    supportChannel?.healthStatus === "degraded"
      ? { label: "Unavailable", tone: "danger" as const }
      : supportChannel?.customerChannelId
        ? { label: "Connected", tone: "success" as const }
        : operatorSetup?.supportInviteError ||
            operatorSetup?.supportOperatorInviteError
          ? { label: "Needs attention", tone: "danger" as const }
          : setupInProgress &&
              supportChannel &&
              !operatorSetup?.supportInviteSentAt
            ? { label: "Ready", tone: "neutral" as const }
            : supportChannel
              ? { label: "Invitation pending", tone: "warning", indicator: "waiting" }
              : { label: "Not set up", tone: "neutral" as const };

  const supportRow = supportChannel ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-3 py-2.5">
      <p
        className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}
      >
        #{supportChannel.channelName}
      </p>
      <StatusTag tone={supportStatus.tone} indicator={supportStatus.indicator}>{supportStatus.label}</StatusTag>
    </div>
  ) : null;

  const inviteContactField = (
    <div className="space-y-1.5">
      <label
        htmlFor="slack-invite-contact"
        className={`text-muted-foreground ${typeStyle("label.field")}`}
      >
        Client contact
      </label>
      <Select
        value={selectedInviteMember?.userId ?? null}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          const member = inviteMembers.find(
            (candidate) => candidate.userId === value,
          );
          if (!member?.email) return;
          setInviteMemberId(member.userId);
        }}
        disabled={inviteMembers.length === 0}
      >
        <SelectTrigger id="slack-invite-contact" className="w-full">
          <SelectValue>
            {selectedInviteMember
              ? selectedInviteMember.name || selectedInviteMember.email
              : clientTeamMembers
                ? "No team member with an email"
                : "Loading client team…"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {inviteMembers.map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              <span>{member.name || member.email}</span>
              {member.name ? (
                <span className="text-muted-foreground">{member.email}</span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const supportChannelField = (
    <div className="space-y-1.5">
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Client support channel
      </p>
      <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-input bg-popover px-3 py-2">
        <p
          className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}
        >
          #{supportChannel?.channelName ?? `spot-${clientSlug}`}
        </p>
        <StatusTag tone={supportStatus.tone} indicator={supportStatus.indicator}>{supportStatus.label}</StatusTag>
      </div>
    </div>
  );

  const manualSupportFields =
    isOperator && resolvedManualSetupReason ? (
      <details className="rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5">
        <summary
          className={`cursor-pointer text-foreground ${typeStyle("control.tab")}`}
        >
          Link a channel manually
        </summary>
        <p
          className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {resolvedManualSetupReason}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label
              htmlFor="slack-host-team-id"
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Clarity team ID
            </label>
            <Input
              id="slack-host-team-id"
              value={hostTeamId}
              onChange={(event) => setHostTeamId(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="slack-host-channel-id"
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Clarity channel ID
            </label>
            <Input
              id="slack-host-channel-id"
              value={hostChannelId}
              onChange={(event) => setHostChannelId(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="slack-customer-channel-id"
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Customer channel ID
            </label>
            <Input
              id="slack-customer-channel-id"
              value={customerChannelId}
              onChange={(event) => setCustomerChannelId(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="slack-manual-channel-name"
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Channel name
            </label>
            <Input
              id="slack-manual-channel-name"
              value={manualChannelName}
              onChange={(event) => setManualChannelName(event.target.value)}
            />
          </div>
        </div>
        <PillButton
          className="mt-3"
          variant="secondary"
          onClick={() => void saveManualPrimaryChannel()}
          disabled={
            busy !== null ||
            !hostTeamId.trim() ||
            !hostChannelId.trim() ||
            !manualChannelName.trim()
          }
        >
          {busy === "manual-channel" ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : null}
          Link support channel
        </PillButton>
      </details>
    ) : null;

  const setupContent =
    operatorSetup && settings ? (
      <div className="space-y-5">
        <SetupHeader step={setupStep} />
        {setupStep === "install" ? (
          <div className="space-y-4">
            {installComplete && connection ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-3 py-2.5">
                <div className="min-w-0">
                  <p
                    className={`truncate text-foreground ${typeStyle("body.default")}`}
                  >
                    {connection.teamName}
                  </p>
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Slack workspace
                  </p>
                </div>
                <StatusTag tone="success">
                  {operatorSetup.mode === "reinstall" ? "Updated" : "Installed"}
                </StatusTag>
              </div>
            ) : isMockSlack ? (
              <div className="rounded-lg border border-dashed border-border-emphasized px-3 py-4">
                <p className={`text-foreground ${typeStyle("body.default")}`}>
                  Local Slack workspace
                </p>
                <p
                  className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  Ready to connect the local fixture.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {inviteContactField}
                {operatorSetup.inviteSentAt &&
                operatorSetup.inviteRecipientEmail ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-3 py-2.5">
                    <div className="min-w-0">
                      <p
                        className={`truncate text-foreground ${typeStyle("body.default")}`}
                      >
                        {operatorSetup.inviteRecipientEmail}
                      </p>
                      <p
                        className={`text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {operatorSetup.inviteExpiresAt &&
                        dayjs().isAfter(operatorSetup.inviteExpiresAt)
                          ? `Expired ${formatDisplayDate(operatorSetup.inviteExpiresAt)}`
                          : `Expires ${formatDisplayDate(operatorSetup.inviteExpiresAt)}`}
                      </p>
                    </div>
                    <StatusTag
                      tone={
                        operatorSetup.inviteExpiresAt &&
                        dayjs().isAfter(operatorSetup.inviteExpiresAt)
                          ? "danger"
                          : "warning"
                      }
                    >
                      {operatorSetup.inviteExpiresAt &&
                      dayjs().isAfter(operatorSetup.inviteExpiresAt)
                        ? "Expired"
                        : "Invite sent"}
                    </StatusTag>
                  </div>
                ) : (
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    The one-time link expires in{" "}
                    {SLACK_INSTALL_INVITE_EXPIRATION_DAYS} days.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {setupStep === "support" ? (
          <div className="space-y-4">
            {supportChannelField}
            {inviteContactField}
            {operatorSetup.supportOmittedOperators?.length ? (
              <div className="rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Operators not added
                </p>
                <div className="mt-2 space-y-1">
                  {operatorSetup.supportOmittedOperators.map((operator) => (
                    <p
                      key={operator.email}
                      className={`text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {operator.displayName} · {operator.reason}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
            {operatorSetup.supportOperatorInviteError ? (
              <p className={`text-destructive ${typeStyle("caption.default")}`}>
                Operators could not be added:{" "}
                {operatorSetup.supportOperatorInviteError}
              </p>
            ) : null}
            {operatorSetup.supportInviteError ? (
              <p className={`text-destructive ${typeStyle("caption.default")}`}>
                The support invitation needs attention:{" "}
                {operatorSetup.supportInviteError}
              </p>
            ) : null}
            {manualSupportFields}
          </div>
        ) : null}

        {setupStep === "channels" ? (
          slackReady ? (
            <SlackConnectionFields
              key={`${connection._id}:${automaticChannelId ?? "unselected"}:setup`}
              clientOrgId={clientOrgId}
              currentChannelId={automaticChannelId}
              knownChannels={joinedChannels}
              supportChannelId={supportChannel?.customerChannelId}
              canEdit
              refreshToken={channelRefreshToken}
            />
          ) : (
            <div className="rounded-lg border border-border bg-foreground/[0.02] px-3 py-3">
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                Waiting for the Slack installation
              </p>
              <p
                className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
              >
                Close this drawer for now. Setup resumes here after the client
                accepts the invitation.
              </p>
            </div>
          )
        ) : null}

        {setupStep === "automations" ? (
          <div className="space-y-3">
            <SlackAvailabilityCard
              settings={settings}
              canEdit={canEdit}
              busy={busy === "settings"}
              onSave={(nextSettings) => void save(nextSettings)}
            />
            <AutomationSettings
              settings={settings}
              automaticChannelId={automaticChannelId}
              canEdit
              busy={busy === "settings"}
              onSave={(nextSettings) => void save(nextSettings)}
              showHeader={false}
            />
          </div>
        ) : null}
      </div>
    ) : (
      <div className="flex min-h-32 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    );

  const compactSlackContent = settings ? (
    <div className="space-y-5">
      <SlackAvailabilityCard
        settings={settings}
        canEdit={canEdit && slackReady}
        busy={busy === "settings"}
        onSave={(nextSettings) => void save(nextSettings)}
      />
      <Tabs
        value={compactSlackTab}
        onValueChange={(value) => setCompactSlackTab(String(value))}
        className="gap-5"
      >
        <TabsList variant="pill">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="channels" disabled={!slackReady}>
            Channels
          </TabsTrigger>
          <TabsTrigger value="automations" disabled={!slackReady}>
            Automations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <FormSection
            title="Connection health"
            description={slackHealth?.reasonSummary}
            divided={false}
          >
            <OperationalLabelValueList>
              <OperationalLabelValueRow
                label="Status"
                value={
                  <StatusTag
                    tone={
                      slackHealth?.status === "healthy"
                        ? "success"
                        : slackHealth?.status === "degraded"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {slackHealth?.status === "healthy"
                      ? "Healthy"
                      : slackHealth?.status === "degraded"
                        ? "Degraded"
                        : slackHealth?.status === "channel_unavailable"
                          ? "Channel unavailable"
                          : slackHealth?.status === "revoked"
                            ? "Reinstall required"
                            : slackHealth?.status === "disconnected"
                              ? "Disconnected"
                              : "Not connected"}
                  </StatusTag>
                }
              />
              <OperationalLabelValueRow
                label="Last verified"
                value={formatDisplayDateTime(
                  slackHealth?.lastVerifiedAt,
                  "Not yet verified",
                )}
              />
              <OperationalLabelValueRow
                label="Last healthy"
                value={formatDisplayDateTime(
                  slackHealth?.lastHealthyAt,
                  "No healthy check recorded",
                )}
              />
              <OperationalLabelValueRow
                label="Issue"
                value={
                  slackHealth?.status === "healthy"
                    ? undefined
                    : slackHealth?.reasonSummary
                }
              />
            </OperationalLabelValueList>
            {slackHealth?.recoveryAction === "rebind" && !isOperator ? (
              <p
                className={`mt-3 text-muted-foreground ${typeStyle("body.default")}`}
              >
                Spot support must rebind the primary Slack Connect channel. Your
                existing Slack history remains available.
              </p>
            ) : null}
          </FormSection>
          <FormSection title="Workspace" divided={false}>
            {connection ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-3 py-2.5">
                <p
                  className={`min-w-0 truncate text-foreground ${typeStyle("body.default")}`}
                >
                  {connection.teamName}
                </p>
                <StatusTag tone={slackNeedsReinstall ? "danger" : "success"}>
                  {slackNeedsReinstall ? "Reinstall required" : "Installed"}
                </StatusTag>
              </div>
            ) : (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Not connected.
              </p>
            )}
          </FormSection>

          {isOperator && result.lifecycleEvents.length > 0 ? (
            <FormSection
              title="Recent Slack activity"
              description="Lifecycle and reconciliation outcomes only; credentials and message bodies are never shown."
              divided={false}
            >
              <div className="space-y-2">
                {result.lifecycleEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-lg border border-border bg-popover px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p
                        className={`text-foreground ${typeStyle("body.medium")}`}
                      >
                        {event.summary}
                      </p>
                      <StatusTag
                        tone={
                          event.status === "failed"
                            ? "danger"
                            : event.status === "ignored"
                              ? "neutral"
                              : "success"
                        }
                      >
                        {event.status}
                      </StatusTag>
                    </div>
                    <p
                      className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
                    >
                      {formatDisplayDateTime(event.receivedAt)} · {event.source}
                    </p>
                  </div>
                ))}
              </div>
            </FormSection>
          ) : null}

          <FormSection
            title="Client support channel"
            description="Dedicated Slack Connect channel with Clarity Labs."
            divided={false}
          >
            {supportRow ?? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Not set up.
              </p>
            )}
            {isOperator && !supportChannel?.customerChannelId
              ? inviteContactField
              : null}
            {manualSupportFields}
          </FormSection>
        </TabsContent>

        <TabsContent value="channels">
          {slackReady ? (
            <SlackConnectionFields
              key={`${connection._id}:${automaticChannelId ?? "unselected"}:compact`}
              clientOrgId={clientOrgId}
              currentChannelId={automaticChannelId}
              knownChannels={joinedChannels}
              supportChannelId={supportChannel?.customerChannelId}
              canEdit={canEdit}
              refreshToken={channelRefreshToken}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="automations">
          {slackReady ? (
            <AutomationSettings
              settings={settings}
              automaticChannelId={automaticChannelId}
              canEdit={canEdit}
              busy={busy === "settings"}
              onSave={(nextSettings) => void save(nextSettings)}
              showHeader={false}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  ) : null;

  const clientPendingStatus: { label: string } & StatusPresentation = slackNeedsReinstall
    ? { label: "Update required", tone: "danger" as const }
    : setupStatus === "in_progress"
      ? { label: "Setup in progress", tone: "warning", indicator: "progress" }
      : { label: "Not connected", tone: "neutral" as const };
  const clientPendingContent = (
    <FormSection
      title="Slack setup"
      description="Spot support is finishing Slack setup for your organization."
      divided={false}
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-3 py-2.5">
        <p className={`text-foreground ${typeStyle("body.default")}`}>
          {slackNeedsReinstall
            ? "An installation update is required."
            : setupStatus === "in_progress"
              ? "Spot support is finishing Slack setup."
              : "Slack is not connected yet."}
        </p>
        <StatusTag tone={clientPendingStatus.tone} indicator={clientPendingStatus.indicator}>
          {clientPendingStatus.label}
        </StatusTag>
      </div>
      {slackHealth?.recoveryAction === "reinstall" && canRecoverSlack ? (
        <PillButton
          onClick={() => void recoverSlack()}
          disabled={busy !== null}
        >
          {busy === "oauth" ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : null}
          Reinstall Slack
        </PillButton>
      ) : null}
    </FormSection>
  );

  const emailContent =
    settings && agentEmailAddress ? (
      <div className="space-y-4">
        <ChannelCard
          title="Available by email"
          description="Let members email the client’s Spot agent."
          checked={settings.emailEnabled}
          disabled={!canEdit || busy === "settings"}
          onChange={() =>
            void save({ ...settings, emailEnabled: !settings.emailEnabled })
          }
        />
        <AgentEmailAddressField
          key={`${agentEmailAddress.ownerOrgId}:${agentEmailAddress.configuredHandle ?? "shared"}`}
          address={agentEmailAddress}
          canEdit={canEditAgentEmailAddress}
          allowSharedDefault
          onSave={canEditAgentEmailAddress ? saveAgentEmailHandle : undefined}
          onSaved={handleAgentEmailSaved}
        />
      </div>
    ) : null;

  const imessageContent = settings ? (
    <ChannelCard
      title="Available by iMessage"
      description="Let linked members message the Spot phone number."
      checked={settings.imessageEnabled}
      disabled={!canEdit || busy === "settings"}
      onChange={() =>
        void save({
          ...settings,
          imessageEnabled: !settings.imessageEnabled,
        })
      }
    />
  ) : null;

  const supportInvitationSent = Boolean(
    (supportChannel?.status === "active" && supportChannel.customerChannelId) ||
    operatorSetup?.supportInviteSentAt,
  );

  const wizardFooter = operatorSetup ? (
    <>
      {setupStep !== "install" ? (
        <PillButton
          variant="secondary"
          onClick={() => {
            const index = SLACK_SETUP_STEPS.findIndex(
              (step) => step.id === setupStep,
            );
            void changeSetupStep(SLACK_SETUP_STEPS[index - 1].id);
          }}
          disabled={busy !== null}
        >
          Back
        </PillButton>
      ) : operatorSetup.mode === "reinstall" ? (
        <PillButton
          variant="secondary"
          onClick={() => void cancelReinstall()}
          disabled={busy !== null}
        >
          Cancel reinstall
        </PillButton>
      ) : null}

      {setupStep === "install" ? (
        <>
          {!installComplete ? (
            <PillButton
              variant="secondary"
              onClick={() => void changeSetupStep("support", "install")}
              disabled={busy !== null}
            >
              Skip for now
            </PillButton>
          ) : null}
          <PillButton
            onClick={() => {
              if (installComplete) {
                void changeSetupStep("support");
              } else if (isMockSlack) {
                void connectMockSlack();
              } else {
                void sendInstallInvite();
              }
            }}
            disabled={
              busy !== null ||
              (!installComplete && !isMockSlack && !inviteEmail.trim())
            }
          >
            {busy === "oauth" || busy === "install-invite" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            {installComplete
              ? "Continue"
              : isMockSlack
                ? connection
                  ? "Update Spot"
                  : "Connect Slack"
                : operatorSetup.inviteSentAt
                  ? "Resend invitation"
                  : operatorSetup.mode === "reinstall"
                    ? "Send update invitation"
                    : "Send invitation"}
          </PillButton>
        </>
      ) : setupStep === "support" ? (
        <>
          {!supportInvitationSent ? (
            <PillButton
              variant="secondary"
              onClick={() => void changeSetupStep("channels", "support")}
              disabled={busy !== null}
            >
              Skip for now
            </PillButton>
          ) : null}
          <PillButton
            onClick={() => {
              if (supportInvitationSent) {
                void changeSetupStep("channels");
              } else {
                void createPrimary();
              }
            }}
            disabled={
              busy !== null ||
              (!supportInvitationSent &&
                (!clientSlug.trim() || !inviteEmail.trim()))
            }
          >
            {busy === "provision" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            {supportInvitationSent
              ? "Continue"
              : operatorSetup.supportInviteError
                ? "Retry invite"
                : "Send invite"}
          </PillButton>
        </>
      ) : setupStep === "channels" ? (
        <>
          <PillButton
            variant="secondary"
            onClick={() => setChannelRefreshToken((value) => value + 1)}
            disabled={busy !== null || !slackReady}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </PillButton>
          <PillButton
            onClick={() =>
              void changeSetupStep(
                "automations",
                automaticChannelId ? undefined : "channels",
              )
            }
            disabled={busy !== null}
          >
            {automaticChannelId ? "Continue" : "Skip for now"}
          </PillButton>
        </>
      ) : (
        <PillButton
          onClick={() => void completeSetup()}
          disabled={busy !== null || !installComplete}
        >
          {busy === "finish-setup" ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          ) : null}
          {installComplete ? "Finish setup" : "Waiting for installation"}
        </PillButton>
      )}
    </>
  ) : null;

  const compactFooter =
    compactSlackTab === "channels" && canEdit ? (
      <PillButton
        variant="secondary"
        onClick={() => setChannelRefreshToken((value) => value + 1)}
      >
        <RefreshCw className="size-3.5" />
        Refresh channels
      </PillButton>
    ) : compactSlackTab === "overview" && connection ? (
      <>
        {canDisconnectSlack ? (
          <PillButton
            variant="destructive"
            size="compact"
            iconOnly
            label="Disconnect Slack"
            className="sm:mr-auto"
            onClick={() => setDisconnectDialogOpen(true)}
            disabled={busy !== null}
          >
            <Unplug className="size-3.5" />
          </PillButton>
        ) : null}
        {canRecoverSlack && slackHealth?.recoveryAction !== "rebind" ? (
          <PillButton
            variant="secondary"
            onClick={() => void recoverSlack()}
            disabled={busy !== null}
          >
            {busy === "start-setup" || busy === "oauth" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            Reinstall
          </PillButton>
        ) : null}
        {isOperator && canEdit && slackHealth?.recoveryAction === "rebind" ? (
          <PillButton
            onClick={() => void createPrimary()}
            disabled={
              busy !== null || !clientSlug.trim() || !inviteEmail.trim()
            }
          >
            {busy === "provision" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            Rebind primary channel
          </PillButton>
        ) : null}
        {isOperator && canEdit && !supportChannel?.customerChannelId ? (
          <PillButton
            onClick={() => void createPrimary()}
            disabled={
              busy !== null || !clientSlug.trim() || !inviteEmail.trim()
            }
          >
            {busy === "provision" ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : null}
            {supportChannel ? "Retry invite" : "Send invite"}
          </PillButton>
        ) : null}
      </>
    ) : null;

  const showWizard = isOperator && setupInProgress;
  const slackContent = showWizard
    ? setupContent
    : clientSetupPending
      ? clientPendingContent
      : compactSlackContent;
  const drawerTitle =
    activeDrawer === "email"
      ? "Email"
      : activeDrawer === "imessage"
        ? "iMessage"
        : showWizard
          ? operatorSetup?.mode === "reinstall"
            ? "Reinstall"
            : "Set up Slack"
          : "Slack";
  const drawerFooter =
    activeDrawer === "slack"
      ? showWizard
        ? wizardFooter
        : clientSetupPending
          ? null
          : compactFooter
      : null;
  const drawerContent =
    activeDrawer === "email"
      ? emailContent
      : activeDrawer === "imessage"
        ? imessageContent
        : slackContent;

  useEffect(() => {
    if (!result || !settings) {
      setRightPanel(null);
      return;
    }
    setRightPanel(
      <SettingsDrawer
        open={activeDrawer !== null}
        onOpenChange={(open) => {
          if (!open) setActiveDrawer(null);
        }}
        title={drawerTitle}
        footer={drawerFooter}
      >
        {drawerContent}
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
    // Keep the drawer synchronized with async setup and form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDrawer,
    automaticChannelId,
    busy,
    channelRefreshToken,
    clientSlug,
    clientTeamMembers,
    compactSlackTab,
    connection,
    customerChannelId,
    hostChannelId,
    hostTeamId,
    installComplete,
    inviteEmail,
    inviteMemberId,
    joinedChannels,
    manualChannelName,
    manualSetupReason,
    operatorSetup,
    result,
    setRightPanel,
    settings,
    setupStep,
    showWizard,
    slackNeedsReinstall,
    supportChannel,
  ]);

  if (!result || !agentEmailAddress) {
    return (
      <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.03] motion-reduce:animate-none" />
    );
  }

  const resolvedSettings = result.settings;
  const agentDomain = getPublicAgentDomain();
  const emailDescription = agentEmailAddress.handle
    ? `${agentEmailAddress.handle}@${agentDomain}`
    : `${agentEmailAddress.ownerName} has not configured an agent email address.`;
  const emailStatus = agentEmailAddress.handle
    ? resolvedSettings.emailEnabled
      ? { label: "On", tone: "success" as const }
      : { label: "Off", tone: "neutral" as const }
    : { label: "Needs setup", tone: "warning" as const };
  const slackDescription =
    slackHealth?.status === "degraded" ||
    slackHealth?.status === "channel_unavailable"
      ? slackHealth.reasonSummary
      : slackNeedsReinstall
        ? `${connection.teamName} needs updated Slack permissions.`
        : setupStatus === "in_progress"
          ? isOperator && operatorSetup?.inviteRecipientEmail
            ? `Installation invitation sent to ${operatorSetup.inviteRecipientEmail}.`
            : "Spot support is finishing Slack setup."
          : slackReady
            ? `${connection.teamName} · ${joinedChannels.length} joined ${joinedChannels.length === 1 ? "channel" : "channels"}`
            : isOperator
              ? "Set up the client Slack workspace."
              : "Slack has not been connected by Spot support.";
  const slackRowStatus = resolveSlackRowStatus({
    connected: slackReady,
    needsUpdate: slackNeedsReinstall,
    setupStatus,
    enabled: resolvedSettings.slackEnabled,
    healthStatus: slackHealth?.status,
  });

  return (
    <>
      <div className="w-full space-y-4">
        <section className="space-y-3" aria-label="Agent channels">
          <ChannelRow
            title="Email"
            description={emailDescription}
            status={emailStatus.label}
            statusTone={emailStatus.tone}
            statusIndicator={agentEmailAddress.handle && !resolvedSettings.emailEnabled ? "inactive" : undefined}
            onClick={() => setActiveDrawer("email")}
          />
          <ChannelRow
            title="iMessage"
            description="Let linked members message the Spot phone number."
            status={resolvedSettings.imessageEnabled ? "On" : "Off"}
            statusIndicator={resolvedSettings.imessageEnabled ? "complete" : "inactive"}
            statusTone={
              resolvedSettings.imessageEnabled ? "success" : "neutral"
            }
            onClick={() => setActiveDrawer("imessage")}
          />
          <ChannelRow
            title="Slack"
            description={slackDescription}
            status={slackRowStatus.label}
            statusTone={slackRowStatus.tone}
            statusIndicator={setupStatus === "in_progress" ? "progress" : slackReady && !resolvedSettings.slackEnabled ? "inactive" : undefined}
            onClick={() => void openSlackDrawer()}
          />
        </section>
      </div>

      <Dialog
        open={disconnectDialogOpen}
        onOpenChange={(open) => {
          if (busy !== "disconnect") setDisconnectDialogOpen(open);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Disconnect Slack</DialogTitle>
            <DialogDescription>
              Disconnect Spot from{" "}
              <strong>{connection?.teamName ?? "this workspace"}</strong>? Spot
              will stop responding and posting there. Reconnecting will require
              a new installation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              onClick={() => setDisconnectDialogOpen(false)}
              disabled={busy === "disconnect"}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={() => void removeConnection()}
              disabled={busy === "disconnect"}
            >
              {busy === "disconnect" ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <Unplug className="size-3.5" />
              )}
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
