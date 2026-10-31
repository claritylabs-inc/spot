"use client";

import { useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { AppShell } from "@/components/app-shell";
import {
  OperatorPageContextRegistration,
  operatorContextSummary,
} from "@/components/operator-agent/operator-page-context";
import { Input } from "@claritylabs-inc/ui/components/input";
import { PillButton } from "@/components/ui/pill-button";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTabParam } from "@/hooks/use-tab-param";
import { openOAuthTab } from "@/lib/oauth-tab";
import {
  operatorMcpClientConfig,
  operatorMcpClientSetups,
} from "@/lib/operator-mcp-setup";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";
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

const CHANNEL_TABS = ["slack", "google-workspace", "mcp"] as const;
const CHANNEL_TAB_LABELS: Record<(typeof CHANNEL_TABS)[number], string> = {
  slack: "Slack",
  "google-workspace": "Google Workspace",
  mcp: "MCP",
};

function OperatorChannelTabs({
  children,
  googleWorkspaceContent,
  mcpContent,
  onTabChange,
}: {
  children: ReactNode;
  googleWorkspaceContent?: ReactNode;
  mcpContent?: ReactNode;
  onTabChange?: () => void;
}) {
  const placeholder = (
    <ChannelCard className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </ChannelCard>
  );

  const [activeTab, selectTab] = useTabParam(CHANNEL_TABS);

  return (
    <PageTabs
      value={activeTab}
      onValueChange={(value) => {
        selectTab(value);
        onTabChange?.();
      }}
    >
      <PageTabsList aria-label="Channel">
        <TabsTrigger value="slack">Slack</TabsTrigger>
        <TabsTrigger value="google-workspace">Google Workspace</TabsTrigger>
        <TabsTrigger value="mcp">MCP</TabsTrigger>
      </PageTabsList>
      <TabsContent value="slack">{children}</TabsContent>
      <TabsContent value="google-workspace">
        {googleWorkspaceContent ?? placeholder}
      </TabsContent>
      <TabsContent value="mcp">{mcpContent ?? placeholder}</TabsContent>
    </PageTabs>
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
  const status = useCachedQuery(
    "agentChannels.getOperatorMcpStatus",
    api.agentChannels.getOperatorMcpStatus,
    {},
  );

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
    return <StatusTag indicator="inactive">Not linked</StatusTag>;
  }
  if (!workspaceTeamId || teamId !== workspaceTeamId) {
    return <StatusTag tone="danger">Workspace mismatch</StatusTag>;
  }
  return <StatusTag tone="success">Linked</StatusTag>;
}

function OperatorIdentityRow({
  identity,
  workspaceTeamId,
  editor,
}: {
  identity: OperatorSlackIdentity;
  workspaceTeamId?: string;
  editor?: ReactNode;
}) {
  const displayName = identity.name?.trim() || identity.email;
  const accountDetail = identity.name?.trim()
    ? `${identity.email} · ${identity.role === "owner" ? "Owner" : "Operator"}`
    : identity.role === "owner"
      ? "Owner"
      : "Operator";
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
            <StatusTag indicator="inactive">Disabled</StatusTag>
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
        {editor ?? (
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
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {!identity.isCurrent ? (
          <IdentityStatus
            teamId={identity.slackTeamId}
            userId={identity.slackUserId}
            workspaceTeamId={workspaceTeamId}
          />
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
  const hostStatus = useCachedQuery(
    "agentChannels.getSlackHostStatus",
    api.agentChannels.getSlackHostStatus,
    {},
  );
  const operatorIdentities = useCachedQuery(
    "agentChannels.listOperatorSlackIdentities",
    api.agentChannels.listOperatorSlackIdentities,
    {},
  );
  const beginHostOAuth = useAction(api.actions.slackOAuth.beginHost);
  const setOperatorSlackIdentity = useMutation(
    api.agentChannels.setOperatorSlackIdentity,
  );
  const [savedIdentity, setSavedIdentity] = useState(profile);
  const [slackUserId, setSlackUserId] = useState(profile.slackUserId ?? "");
  const [googleSettingsDrawerOpen, setGoogleSettingsDrawerOpen] =
    useFollowedState("operator-channels:google-workspace:settings-drawer", false);
  const [busy, setBusy] = useState<"host" | "identity" | null>(null);
  const hostInstallation = hostStatus?.installation;
  const workspaceTeamId = hostStatus?.hostTeamId;
  const mockMode = hostStatus?.mode === "mock";
  const workspaceName = mockMode
    ? "Clarity local fixture"
    : hostInstallation?.teamName;
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

  const [activeTab] = useTabParam(CHANNEL_TABS);
  const pageSummary = operatorContextSummary(
    "Agent channels",
    `${CHANNEL_TAB_LABELS[activeTab]} tab`,
    activeTab === "slack" &&
      hostStatus &&
      (mockMode || hostInstallation
        ? `Slack workspace ${workspaceName ?? workspaceTeamId} connected`
        : "Slack workspace not connected"),
    activeTab === "slack" &&
      (savedIdentity.slackUserId
        ? `your Slack member ID ${savedIdentity.slackUserId}${currentIdentityWorkspaceMismatch ? " (other workspace)" : ""}`
        : "your Slack identity is not linked"),
    googleSettingsDrawerOpen && "Google Workspace settings drawer open",
  );

  const rightPanel = googleSettingsDrawerOpen ? (
    <OperatorGoogleWorkspaceSettingsDrawer
      open
      onOpenChange={setGoogleSettingsDrawerOpen}
    />
  ) : null;

  return (
    <AppShell rightPanel={rightPanel}>
      <OperatorPageContextRegistration
        context={{ pageType: "operator_channels", summary: pageSummary }}
      />
      <main className="w-full">
        <OperatorChannelTabs
          onTabChange={() => {
            setGoogleSettingsDrawerOpen(false);
          }}
          googleWorkspaceContent={
            <OperatorGoogleWorkspaceContent
              onConfigure={() => {
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
                        <Badge variant="outline">Test mode</Badge>
                      ) : hostInstallation ? (
                        <StatusTag tone="success">Connected</StatusTag>
                      ) : (
                        <StatusTag indicator="inactive">
                          Not connected
                        </StatusTag>
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
                        editor={
                          <div data-operator-inline-fields>
                            <Input
                              aria-label="Slack member ID"
                              value={slackUserId}
                              placeholder="Not set"
                              autoComplete="off"
                              disabled={busy !== null || !workspaceTeamId}
                              onChange={(event) =>
                                setSlackUserId(event.target.value)
                              }
                              onBlur={() => {
                                if (
                                  slackUserId.trim() &&
                                  (slackUserId.trim() !==
                                    (savedIdentity.slackUserId ?? "") ||
                                    currentIdentityWorkspaceMismatch)
                                )
                                  void saveIdentity();
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter")
                                  event.currentTarget.blur();
                              }}
                            />
                          </div>
                        }
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
    <AppShell>
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
