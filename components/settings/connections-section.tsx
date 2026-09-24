"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { SiClaude } from "react-icons/si";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Plug,
  Terminal,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { ModelProviderLogo } from "@/components/model-provider-logo";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

type ConnectedAppRow = {
  tokenId: Id<"oauthTokens">;
  clientId: string;
  clientName: string;
  connectedAt: number;
  [key: string]: unknown;
};

function useMcpUrl() {
  return useSyncExternalStore(
    () => () => undefined,
    () => `${window.location.origin}/mcp`,
    () => "/mcp",
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded p-1.5 transition-colors hover:bg-foreground/5"
      aria-label={label}
    >
      {copied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative">
      <pre
        className={`overflow-x-auto rounded-lg border border-border bg-foreground/3 p-4 pr-11 text-muted-foreground ${typeStyle("technical.codeCompact")}`}
      >
        {value}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton label={label} value={value} />
      </div>
    </div>
  );
}

function ClientSetup({
  icon,
  name,
  action,
  children,
}: {
  icon: ReactNode;
  name: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <OperationalItem className="grid gap-3 px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
      <div className="flex items-center justify-between gap-3 md:block">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className={`text-foreground ${typeStyle("heading.micro")}`}>
            {name}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </OperationalItem>
  );
}

function SetupSteps({ children }: { children: ReactNode }) {
  return (
    <ol
      className={`list-decimal space-y-1.5 pl-5 text-muted-foreground marker:text-muted-foreground/60 ${typeStyle("body.default")}`}
    >
      {children}
    </ol>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return (
    <span className={`text-foreground ${typeStyle("body.medium")}`}>
      {children}
    </span>
  );
}

const CLI_SNIPPET = [
  "npm install -g @claritylabs/spot-cli",
  "spot auth:login",
  "spot auth:whoami",
  "spot auth:whoami --set-org <orgId>",
  "spot policies:list",
].join("\n");

export function ConnectionsSection() {
  const { setActions } = useSettingsActions();
  const mcpUrl = useMcpUrl();

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  const localClientSnippet = JSON.stringify(
    { mcpServers: { spot: { command: "npx", args: ["-y", "mcp-remote", mcpUrl] } } },
    null,
    2,
  );

  return (
    <div className="space-y-4">
      <OperationalPanel>
        <OperationalPanelHeader
          title="MCP endpoint"
          description="Connect Spot to an AI assistant with your existing Spot account."
          className="px-5 py-3.5"
        />
        <OperationalPanelBody className="px-5 py-5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-foreground/3 p-3">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <code
              className={`flex-1 break-all text-foreground ${typeStyle("technical.codeCompact")}`}
            >
              {mcpUrl}
            </code>
            <CopyButton label="Copy MCP endpoint" value={mcpUrl} />
          </div>
        </OperationalPanelBody>

        <ClientSetup
          name="Claude"
          icon={
            <SiClaude aria-hidden="true" className="size-[17px] text-[#D97757]" />
          }
          action={
            <PillButton
              href="https://claude.ai/new#settings/customize-connectors"
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="compact"
              className="md:mt-3"
            >
              Open Claude
              <ExternalLink className="size-3.5" />
            </PillButton>
          }
        >
          <SetupSteps>
            <li>
              Open <Strong>Settings → Connectors</Strong>. Team and Enterprise
              owners should first choose Organization connectors.
            </li>
            <li>
              Select <Strong>Add custom connector</Strong>, name it Spot, and
              paste the endpoint above.
            </li>
            <li>Add the connector, select Connect, and sign in to Spot.</li>
          </SetupSteps>
        </ClientSetup>

        <ClientSetup
          name="ChatGPT"
          icon={
            <ModelProviderLogo provider="openai" size={17} className="dark:invert" />
          }
          action={
            <PillButton
              href="https://chatgpt.com/#settings/Connectors"
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="compact"
              className="md:mt-3"
            >
              Open ChatGPT
              <ExternalLink className="size-3.5" />
            </PillButton>
          }
        >
          <SetupSteps>
            <li>
              Open <Strong>Settings → Apps → Advanced settings</Strong> and
              enable Developer mode. Your workspace may require admin access.
            </li>
            <li>
              Return to Apps, select <Strong>Create</Strong>, name the app Spot,
              and paste the endpoint above.
            </li>
            <li>
              Choose OAuth when prompted, scan the tools, create the app, and
              sign in to Spot.
            </li>
          </SetupSteps>
        </ClientSetup>

        <ClientSetup
          name="Local clients"
          icon={<Terminal className="size-[17px] text-muted-foreground" />}
        >
          <div className="space-y-3">
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Add this server to Claude Code, Cursor, Codex, or any other local
              MCP client. A browser window opens for Spot sign-in on first use.
            </p>
            <CodeBlock
              label="Copy local MCP configuration"
              value={localClientSnippet}
            />
          </div>
        </ClientSetup>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Command line"
          description="Use the Spot CLI for terminal workflows, scripts, and local automation."
          className="px-5 py-3.5"
        />
        <OperationalPanelBody className="px-5 py-5">
          <CodeBlock label="Copy CLI install commands" value={CLI_SNIPPET} />
        </OperationalPanelBody>
      </OperationalPanel>

      <ConnectedApps />
    </div>
  );
}

function ConnectedApps() {
  const { setRightPanel } = useSettingsActions();
  const connectedApps = useCachedQuery(
    "oauth.listConnectedApps",
    api.oauth.listConnectedApps,
    {},
  ) as ConnectedAppRow[] | undefined;
  const updateConnectedApps = useUpdateCachedQuery<
    ConnectedAppRow[],
    Record<string, never>
  >("oauth.listConnectedApps");
  const revokeApp = useMutation(api.oauth.revokeApp);
  const [revokeTarget, setRevokeTarget] = useState<{
    clientName: string;
    clientId: string;
  } | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    setRightPanel(
      <SettingsDrawer
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke connection"
        footer={
          <>
            <PillButton
              variant="secondary"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              onClick={handleRevokeApp}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke"}
            </PillButton>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 size-5 shrink-0 text-red-500" />
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            This will disconnect <strong>{revokeTarget?.clientName}</strong> and
            revoke its access to your Spot data.
          </p>
        </div>
      </SettingsDrawer>,
    );
    return () => setRightPanel(null);
    // The drawer must be rebuilt as its local mutation state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revokeTarget, revoking]);

  async function handleRevokeApp() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApp({ clientId: revokeTarget.clientId });
      await updateConnectedApps({}, (current) =>
        current.filter((app) => app.clientId !== revokeTarget.clientId),
      );
      toast.success("Connection revoked");
      setRevokeTarget(null);
    } catch {
      toast.error("Failed to revoke connection");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <OperationalPanel>
      <OperationalPanelHeader title="Connected apps" className="px-5 py-3.5" />
      {connectedApps === undefined ? (
        <div className="px-5 py-8 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </div>
      ) : connectedApps.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <Plug className="mx-auto mb-2 size-6 text-muted-foreground/20" />
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            No connected apps yet
          </p>
          <p
            className={`mt-0.5 text-muted-foreground/50 ${typeStyle("caption.default")}`}
          >
            Apps appear here after they complete the OAuth sign-in.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {connectedApps.map((app) => (
            <div
              key={app.tokenId}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  {app.clientName}
                </p>
                <p
                  className={`mt-0.5 text-muted-foreground/50 ${typeStyle("caption.default")}`}
                >
                  Connected {formatDisplayDate(app.connectedAt)}
                </p>
              </div>
              <PillButton
                variant="destructive"
                size="compact"
                onClick={() =>
                  setRevokeTarget({
                    clientName: app.clientName,
                    clientId: app.clientId,
                  })
                }
              >
                <Trash2 className="size-3.5" />
                Revoke
              </PillButton>
            </div>
          ))}
        </div>
      )}
    </OperationalPanel>
  );
}
