"use client";

import { useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { Check, Copy, Loader2, MessageCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { Input } from "@/components/ui/input";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabParam } from "@/hooks/use-tab-param";
import { openOAuthTab } from "@/lib/oauth-tab";
import {
  operatorMcpClientConfig,
  operatorMcpClientSetups,
} from "@/lib/operator-mcp-setup";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";
import { OperatorSidebar } from "../operator-sidebar";
import { typeStyle } from "@/lib/typography";
import {
  OperatorGoogleWorkspaceContent,
  OperatorGoogleWorkspaceSettingsDrawer,
} from "./google-workspace-content";

type OperatorSlackProfile = {
  role: "operator" | "owner";
  status: "active" | "disabled";
  slackTeamId?: string;
  slackUserId?: string;
};

type OperatorSlackIdentity = {
  userId: string;
  name: string | null;
  email: string;
  role: "operator" | "owner";
  status: "active" | "disabled";
  slackTeamId: string | null;
  slackUserId: string | null;
  isCurrent: boolean;
};

function ChannelCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-popover px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ChannelDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 border-t border-border py-3 first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className={`text-muted-foreground ${typeStyle("label.metadata")}`}>
        {label}
      </dt>
      <dd
        className={`min-w-0 break-words text-foreground ${typeStyle("body.default")}`}
      >
        {children}
      </dd>
    </div>
  );
}

const CHANNEL_TABS = ["slack", "imessage", "google-workspace", "mcp"] as const;

function OperatorChannelTabs({
  children,
  imessageContent,
  googleWorkspaceContent,
  mcpContent,
}: {
  children: ReactNode;
  imessageContent?: ReactNode;
  googleWorkspaceContent?: ReactNode;
  mcpContent?: ReactNode;
}) {
  const placeholder = (
    <ChannelCard className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </ChannelCard>
  );

  const [activeTab, selectTab] = useTabParam(CHANNEL_TABS);

  return (
    <Tabs value={activeTab} onValueChange={selectTab} className="gap-4">
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-hide">
        <TabsList variant="pill" aria-label="Channel">
          <TabsTrigger value="slack">Slack</TabsTrigger>
          <TabsTrigger value="imessage">iMessage</TabsTrigger>
          <TabsTrigger value="google-workspace">Google Workspace</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="slack">{children}</TabsContent>
      <TabsContent value="imessage">
        {imessageContent ?? placeholder}
      </TabsContent>
      <TabsContent value="google-workspace">
        {googleWorkspaceContent ?? placeholder}
      </TabsContent>
      <TabsContent value="mcp">{mcpContent ?? placeholder}</TabsContent>
    </Tabs>
  );
}

function CopySnippetButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <PillButton
      variant="secondary"
      size="compact"
      onClick={copy}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </PillButton>
  );
}

function McpSetupCard({ title, snippet }: { title: string; snippet: string }) {
  return (
    <ChannelCard>
      <div className="flex items-start justify-between gap-3">
        <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
          {title}
        </h2>
        <CopySnippetButton value={snippet} label={`Copy ${title} setup`} />
      </div>
      <pre
        className={`mt-3 overflow-x-auto rounded-lg border border-border bg-foreground/3 p-3 text-muted-foreground ${typeStyle("technical.codeCompact")}`}
      >
        {snippet}
      </pre>
    </ChannelCard>
  );
}

function OperatorMcpContent() {
  const status = useQuery(api.agentChannels.getOperatorMcpStatus, {});

  if (status === undefined) {
    return (
      <ChannelCard className="flex min-h-20 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </ChannelCard>
    );
  }

  if (!status.endpoint) {
    return (
      <ChannelCard>
        <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
          Operator MCP unavailable
        </h2>
        <p
          className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
        >
          This deployment is missing its Convex site URL, so the MCP endpoint
          cannot be resolved.
        </p>
      </ChannelCard>
    );
  }

  const endpoint = status.endpoint;

  return (
    <section className="space-y-3" aria-label="Operator MCP">
      {operatorMcpClientSetups({ endpoint }).map((setup) => (
        <McpSetupCard
          key={setup.id}
          title={setup.label}
          snippet={setup.snippet}
        />
      ))}

      <McpSetupCard
        title="Other MCP clients"
        snippet={operatorMcpClientConfig(endpoint)}
      />
    </section>
  );
}

function formatPhoneNumber(value: string | null) {
  if (!value) return null;
  const phone = parsePhoneNumberFromString(value, "US");
  if (!phone?.isValid()) return value;
  return phone.countryCallingCode === "1"
    ? phone.formatNational()
    : phone.formatInternational();
}

function OperatorImessageContent() {
  const status = useQuery(api.agentChannels.getOperatorImessageStatus, {});

  if (status === undefined) {
    return (
      <ChannelCard className="flex min-h-20 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </ChannelCard>
    );
  }

  if (!status.enabled) {
    return (
      <ChannelCard>
        <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
          iMessage not enabled
        </h2>
      </ChannelCard>
    );
  }

  if (status.mode === "terminal") {
    return (
      <ChannelCard>
        <div className="flex items-center justify-between gap-3">
          <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
            Operator iMessage
          </h2>
          <StatusTag tone="info">Test mode</StatusTag>
        </div>
        <p
          className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
        >
          Start the local operator terminal with{" "}
          <code className={typeStyle("technical.codeCompact")}>
            npm run conductor:operator-spectrum
          </code>
          .
        </p>
      </ChannelCard>
    );
  }

  if (!status.configured || !status.contactPhone) {
    return (
      <ChannelCard>
        <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
          iMessage unavailable
        </h2>
        <p
          className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
        >
          This deployment is missing its operator number or worker
          configuration.
        </p>
      </ChannelCard>
    );
  }

  const contactPhone = status.contactPhone;
  const senderPhone = formatPhoneNumber(status.senderPhone);

  return (
    <section className="space-y-3" aria-label="Operator iMessage">
      <ChannelCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
              Operator iMessage
            </h2>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Text this private line from the phone linked to your Spot account.
            </p>
          </div>
          <StatusTag tone="success">Enabled</StatusTag>
        </div>

        <dl className="mt-3 border-t border-border">
          <ChannelDetail label="Number to text">
            <a
              href={`sms:${contactPhone}`}
              className={`underline decoration-border-emphasized underline-offset-4 hover:text-muted-foreground ${typeStyle("technical.code")}`}
            >
              {formatPhoneNumber(contactPhone)}
            </a>
          </ChannelDetail>
          <ChannelDetail label="Your sender number">
            {senderPhone ?? "Not linked"}
          </ChannelDetail>
          <ChannelDetail label="Conversation type">
            Direct messages only
          </ChannelDetail>
        </dl>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {senderPhone ? (
            <PillButton variant="primary" href={`sms:${contactPhone}`}>
              <MessageCircle className="size-3.5" />
              Open Messages
            </PillButton>
          ) : (
            <PillButton variant="primary" href="/operator/profile">
              Add your phone
            </PillButton>
          )}
        </div>
      </ChannelCard>

      {senderPhone ? (
        <p
          className={`px-1 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Your sender number must also be registered in the Spot Operator Photon
          project.
        </p>
      ) : null}
    </section>
  );
}

function IdentityStatus({
  teamId,
  userId,
  workspaceTeamId,
}: {
  teamId: string | null;
  userId: string | null;
  workspaceTeamId?: string;
}) {
  if (!teamId || !userId) {
    return <StatusTag>Not linked</StatusTag>;
  }
  if (!workspaceTeamId || teamId !== workspaceTeamId) {
    return <StatusTag tone="danger">Workspace mismatch</StatusTag>;
  }
  return <StatusTag tone="success">Linked</StatusTag>;
}

function OperatorIdentityRow({
  identity,
  workspaceTeamId,
  onEdit,
}: {
  identity: OperatorSlackIdentity;
  workspaceTeamId?: string;
  onEdit?: () => void;
}) {
  const displayName = identity.name?.trim() || identity.email;
  const accountDetail = identity.name?.trim()
    ? `${identity.email} · ${identity.role === "owner" ? "Owner" : "Operator"}`
    : identity.role === "owner"
      ? "Owner"
      : "Operator";
  const linkedToWorkspace =
    !!workspaceTeamId &&
    identity.slackTeamId === workspaceTeamId &&
    !!identity.slackUserId;

  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(9rem,0.8fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`truncate text-foreground ${typeStyle("body.medium")}`}>
            {displayName}
          </p>
          {identity.isCurrent ? (
            <IdentityStatus
              teamId={identity.slackTeamId}
              userId={identity.slackUserId}
              workspaceTeamId={workspaceTeamId}
            />
          ) : null}
          {identity.status === "disabled" ? (
            <StatusTag>Disabled</StatusTag>
          ) : null}
        </div>
        <p
          className={`mt-0.5 truncate text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {accountDetail}
        </p>
      </div>

      <div className="min-w-0">
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Slack member ID
        </p>
        <p
          className={`mt-0.5 truncate text-foreground ${typeStyle("body.default")}`}
        >
          {identity.slackUserId ? (
            <code className={`${typeStyle("technical.codeCompact")}`}>
              {identity.slackUserId}
            </code>
          ) : (
            "Not set"
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {!identity.isCurrent ? (
          <IdentityStatus
            teamId={identity.slackTeamId}
            userId={identity.slackUserId}
            workspaceTeamId={workspaceTeamId}
          />
        ) : null}
        {onEdit ? (
          <PillButton variant="secondary" size="compact" onClick={onEdit}>
            <Pencil className="size-3.5" />
            {linkedToWorkspace ? "Change" : "Set identity"}
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}

function OperatorChannelsContent({
  operatorName,
  operatorEmail,
  profile,
}: {
  operatorName?: string;
  operatorEmail: string;
  profile: OperatorSlackProfile;
}) {
  const hostStatus = useQuery(api.agentChannels.getSlackHostStatus, {});
  const operatorIdentities = useQuery(
    api.agentChannels.listOperatorSlackIdentities,
    {},
  );
  const beginHostOAuth = useAction(api.actions.slackOAuth.beginHost);
  const setOperatorSlackIdentity = useMutation(
    api.agentChannels.setOperatorSlackIdentity,
  );
  const [savedIdentity, setSavedIdentity] = useState(profile);
  const [slackUserId, setSlackUserId] = useState(profile.slackUserId ?? "");
  const [identityDrawerOpen, setIdentityDrawerOpen] = useState(false);
  const [googleSettingsDrawerOpen, setGoogleSettingsDrawerOpen] =
    useState(false);
  const [busy, setBusy] = useState<"host" | "identity" | null>(null);
  const hostInstallation = hostStatus?.installation;
  const workspaceTeamId = hostStatus?.hostTeamId;
  const mockMode = hostStatus?.mode === "mock";
  const workspaceName = mockMode
    ? "Clarity local fixture"
    : hostInstallation?.teamName;
  const currentIdentityLinked =
    !!workspaceTeamId &&
    savedIdentity.slackTeamId === workspaceTeamId &&
    !!savedIdentity.slackUserId;
  const currentIdentityWorkspaceMismatch =
    !!savedIdentity.slackTeamId &&
    !!workspaceTeamId &&
    savedIdentity.slackTeamId !== workspaceTeamId;
  const currentOperator = operatorIdentities?.find(
    (operator) => operator.isCurrent,
  );
  const currentIdentity: OperatorSlackIdentity = {
    userId: currentOperator?.userId ?? "current-operator",
    name: currentOperator?.name ?? operatorName ?? null,
    email: currentOperator?.email ?? operatorEmail,
    role: currentOperator?.role ?? profile.role,
    status: currentOperator?.status ?? profile.status,
    slackTeamId: savedIdentity.slackTeamId ?? null,
    slackUserId: savedIdentity.slackUserId ?? null,
    isCurrent: true,
  };
  const otherOperators = operatorIdentities?.filter(
    (operator) => !operator.isCurrent,
  );

  async function installHost() {
    const oauthTab = openOAuthTab();
    if (!oauthTab) {
      toast.error("Allow pop-ups for Spot to connect Slack in a new tab");
      return;
    }

    setBusy("host");
    try {
      const { url } = await beginHostOAuth({});
      if (!url) throw new Error("Slack OAuth did not return a setup URL");
      if (!oauthTab.navigate(url)) {
        throw new Error("The Slack setup tab was closed. Try again.");
      }
    } catch (error) {
      oauthTab.close();
      toast.error(
        getUserFacingErrorMessage(error, "Clarity Slack setup could not start"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveIdentity() {
    if (!workspaceTeamId) return;
    setBusy("identity");
    try {
      await setOperatorSlackIdentity({
        teamId: workspaceTeamId,
        userId: slackUserId.trim(),
      });
      const savedUserId = slackUserId.trim();
      setSavedIdentity((current) => ({
        ...current,
        slackTeamId: workspaceTeamId,
        slackUserId: savedUserId,
      }));
      setSlackUserId(savedUserId);
      setIdentityDrawerOpen(false);
      toast.success(
        `Slack identity updated for ${workspaceName ?? workspaceTeamId}`,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Slack identity could not be connected",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  function startEditingIdentity() {
    setSlackUserId(savedIdentity.slackUserId ?? "");
    setGoogleSettingsDrawerOpen(false);
    setIdentityDrawerOpen(true);
  }

  function cancelEditingIdentity() {
    setSlackUserId(savedIdentity.slackUserId ?? "");
    setIdentityDrawerOpen(false);
  }

  const identityDrawer = (
    <SettingsDrawer
      open={identityDrawerOpen}
      onOpenChange={(open) => {
        if (!open && busy !== "identity") cancelEditingIdentity();
      }}
      title={
        currentIdentityLinked
          ? "Change your Slack identity"
          : "Set your Slack identity"
      }
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            onClick={cancelEditingIdentity}
            disabled={busy !== null}
          >
            Cancel
          </PillButton>
          <PillButton
            type="submit"
            form="operator-slack-identity-form"
            variant="primary"
            disabled={busy !== null || !slackUserId.trim()}
          >
            {busy === "identity" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Save identity
          </PillButton>
        </>
      }
    >
      <form
        id="operator-slack-identity-form"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void saveIdentity();
        }}
      >
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This changes the Slack identity for the signed-in Spot account{" "}
          <span className={`text-foreground ${typeStyle("body.medium")}`}>
            {operatorEmail}
          </span>
          {workspaceName ? (
            <>
              {" "}
              in{" "}
              <span className={`text-foreground ${typeStyle("body.medium")}`}>
                {workspaceName}
              </span>
              .
            </>
          ) : (
            "."
          )}
        </p>

        <div>
          <label
            htmlFor="operator-slack-member-id"
            className={`text-foreground ${typeStyle("label.field")}`}
          >
            Slack member ID
          </label>
          <Input
            id="operator-slack-member-id"
            className="mt-2"
            value={slackUserId}
            onChange={(event) => setSlackUserId(event.target.value)}
            placeholder="U…"
            autoComplete="off"
            autoFocus
          />
          <p
            className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Slack member IDs usually begin with U.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-foreground/[0.025] p-3">
          <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
            How to find your member ID
          </h3>
          <ol
            className={`mt-2 list-decimal space-y-1 pl-4 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            <li>Open Slack and select your profile picture.</li>
            <li>Open your profile, then select More (•••).</li>
            <li>Select Copy member ID and paste it above.</li>
          </ol>
        </div>
      </form>
    </SettingsDrawer>
  );
  const rightPanel = googleSettingsDrawerOpen ? (
    <OperatorGoogleWorkspaceSettingsDrawer
      open
      onOpenChange={setGoogleSettingsDrawerOpen}
    />
  ) : (
    identityDrawer
  );

  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="channels"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      rightPanel={rightPanel}
    >
      <main className="w-full">
        <OperatorChannelTabs
          imessageContent={<OperatorImessageContent />}
          googleWorkspaceContent={
            <OperatorGoogleWorkspaceContent
              onConfigure={() => {
                setIdentityDrawerOpen(false);
                setGoogleSettingsDrawerOpen(true);
              }}
            />
          }
          mcpContent={<OperatorMcpContent />}
        >
          <section className="space-y-3" aria-label="Slack channels">
            {hostStatus === undefined ? (
              <ChannelCard className="flex min-h-20 items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </ChannelCard>
            ) : !hostStatus.enabled ? (
              <ChannelCard>
                <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
                  Slack not enabled
                </h2>
              </ChannelCard>
            ) : !hostStatus.configured ? (
              <ChannelCard>
                <h2 className={`text-foreground ${typeStyle("heading.micro")}`}>
                  Slack unavailable
                </h2>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  {hostStatus.mode === "mock"
                    ? "The local Slack simulator is missing its fixture workspace. Run the Conductor workspace setup again."
                    : "This deployment is missing the credentials or callback configuration required to connect Slack."}
                </p>
              </ChannelCard>
            ) : (
              <>
                <ChannelCard>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2
                        className={`text-foreground ${typeStyle("heading.micro")}`}
                      >
                        Clarity workspace
                      </h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {mockMode ? (
                        <StatusTag tone="info">Test mode</StatusTag>
                      ) : hostInstallation ? (
                        <StatusTag tone="success">Connected</StatusTag>
                      ) : (
                        <StatusTag>Not connected</StatusTag>
                      )}
                      {!mockMode ? (
                        <PillButton
                          variant={hostInstallation ? "secondary" : "primary"}
                          onClick={() => void installHost()}
                          disabled={busy !== null}
                        >
                          {busy === "host" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : null}
                          {hostInstallation ? "Reconnect" : "Connect workspace"}
                        </PillButton>
                      ) : null}
                    </div>
                  </div>

                  <dl className="mt-3 border-t border-border">
                    <ChannelDetail label="Slack workspace name">
                      {workspaceName ?? "No workspace connected"}
                    </ChannelDetail>
                    <ChannelDetail label="Slack team ID">
                      <code className={`${typeStyle("technical.codeCompact")}`}>
                        {workspaceTeamId ?? "Not configured"}
                      </code>
                    </ChannelDetail>
                  </dl>
                </ChannelCard>

                {mockMode || hostInstallation ? (
                  <ChannelCard>
                    <div className="min-w-0">
                      <h2
                        className={`text-foreground ${typeStyle("heading.micro")}`}
                      >
                        Operator Slack identities
                      </h2>
                      <p
                        className={`mt-1 max-w-2xl text-muted-foreground ${typeStyle("body.default")}`}
                      >
                        Spot uses these links to recognize which operator
                        replied in Slack.
                      </p>
                    </div>

                    <div className="mt-3 border-t border-border">
                      <OperatorIdentityRow
                        identity={currentIdentity}
                        workspaceTeamId={workspaceTeamId}
                        onEdit={startEditingIdentity}
                      />

                      {currentIdentityWorkspaceMismatch ? (
                        <p
                          className={`pb-3 text-destructive ${typeStyle("caption.default")}`}
                        >
                          Your identity points to {savedIdentity.slackTeamId},
                          not the current workspace {workspaceTeamId}. Change it
                          before handling Slack messages.
                        </p>
                      ) : null}

                      <div className="border-t border-border">
                        <p
                          className={`pt-3 text-muted-foreground ${typeStyle("caption.medium")}`}
                        >
                          Other Spot operators
                        </p>
                        {otherOperators === undefined ? (
                          <div className="flex min-h-16 items-center justify-center">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : otherOperators.length ? (
                          <div className="divide-y divide-border">
                            {otherOperators.map((operator) => (
                              <OperatorIdentityRow
                                key={operator.userId}
                                identity={operator}
                                workspaceTeamId={workspaceTeamId}
                              />
                            ))}
                          </div>
                        ) : (
                          <p
                            className={`py-3 text-muted-foreground ${typeStyle("body.default")}`}
                          >
                            No other Spot operators.
                          </p>
                        )}
                      </div>
                    </div>
                  </ChannelCard>
                ) : null}
              </>
            )}
          </section>
        </OperatorChannelTabs>
      </main>
    </AppShell>
  );
}

export default function OperatorChannelsPage() {
  const current = useCachedOperatorCurrent();

  return current ? (
    <OperatorChannelsContent
      key={`${current.user._id}:${current.profile.slackTeamId ?? ""}:${current.profile.slackUserId ?? ""}`}
      operatorName={current.user.name}
      operatorEmail={current.user.email ?? current.profile.email}
      profile={current.profile}
    />
  ) : (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="channels"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      <main className="w-full">
        <OperatorChannelTabs>
          <ChannelCard className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </ChannelCard>
        </OperatorChannelTabs>
      </main>
    </AppShell>
  );
}
