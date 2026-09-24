"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import {
  OperationalPanel,
  OperationalPanelHeader,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type Server = FunctionReturnType<typeof api.operatorMcpServers.list>[number];

export function useMcpSettings(disabled: boolean) {
  const servers = useQuery(api.operatorMcpServers.list);
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("mcp");
    if (outcome === "connected") toast.success("MCP server connected");
    else if (outcome === "oauth_error")
      toast.error(
        "OAuth connection was not completed. Reopen the server and connect again.",
      );
    else return;
    url.searchParams.delete("mcp");
    window.history.replaceState(null, "", url.toString());
  }, []);
  const [selected, setSelected] = useState<Server | "new" | null>(null);
  return {
    panel: (
      <OperationalPanel>
        <OperationalPanelHeader
          title="MCP servers"
          action={
            <PillButton
              type="button"
              size="compact"
              disabled={disabled}
              onClick={() => setSelected("new")}
            >
              Add server
            </PillButton>
          }
        />
        <OperationalPanelBody>
          {servers === undefined ? (
            <p>Loading servers…</p>
          ) : servers.length === 0 ? (
            <p className="text-muted-foreground">No MCP servers connected.</p>
          ) : (
            <div className="divide-y divide-border">
              {servers.map((server) => (
                <button
                  key={server._id}
                  type="button"
                  onClick={() => setSelected(server)}
                  className="flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <OrgBrandIcon
                    name={server.name}
                    iconUrl={server.logoUrl}
                    website={server.url}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate ${typeStyle("body.medium")}`}
                  >
                    {server.name}
                  </span>
                  <span
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {server.authType === "oauth" && !server.hasOAuth
                      ? "Not connected"
                      : server.enabled
                        ? `${server.toolCount} tools`
                        : "Disabled"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </OperationalPanelBody>
      </OperationalPanel>
    ),
    drawer: selected ? (
      <McpServerEditor
        key={selected === "new" ? "new" : selected._id}
        server={selected === "new" ? undefined : selected}
        disabled={disabled}
        onClose={() => setSelected(null)}
      />
    ) : null,
  };
}

function McpServerEditor({
  server,
  disabled,
  onClose,
}: {
  server?: Server;
  disabled: boolean;
  onClose: () => void;
}) {
  const save = useAction(api.actions.operatorMcp.save);
  const remove = useMutation(api.operatorMcpServers.remove);
  const connect = useAction(api.actions.operatorMcpOAuth.connect);
  const [authType, setAuthType] = useState<"bearer" | "oauth">(
    server?.authType ?? "bearer",
  );
  const redirectUrl = useQuery(
    api.operatorMcpServers.oauthRedirectUrl,
    authType === "oauth" ? {} : "skip",
  );
  const [oauthClientId, setOauthClientId] = useState(
    server?.oauthClientId ?? "",
  );
  const [oauthClientSecret, setOauthClientSecret] = useState<
    string | undefined
  >();
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [logoUrl, setLogoUrl] = useState(server?.logoUrl ?? "");
  const [token, setToken] = useState<string | undefined>();
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty =
    name !== (server?.name ?? "") ||
    url !== (server?.url ?? "") ||
    logoUrl !== (server?.logoUrl ?? "") ||
    token !== undefined ||
    authType !== (server?.authType ?? "bearer") ||
    oauthClientId !== (server?.oauthClientId ?? "") ||
    oauthClientSecret !== undefined ||
    enabled !== (server?.enabled ?? true);
  const [discard, setDiscard] = useState(false);
  const needsOAuth =
    authType === "oauth" &&
    enabled &&
    (!server?.hasOAuth ||
      server.authType !== "oauth" ||
      server.url !== url ||
      (server.oauthClientId ?? "") !== oauthClientId ||
      oauthClientSecret !== undefined);
  async function reconnect() {
    if (!server) return;
    setBusy(true);
    try {
      const result = await connect({ serverId: server._id });
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not start OAuth. Check the server and OAuth client settings.",
        ),
      );
      setBusy(false);
    }
  }
  async function persist() {
    setBusy(true);
    let saved = false;
    try {
      const serverId = await save({
        serverId: server?._id,
        revision: server?.revision,
        name,
        url,
        logoUrl,
        token,
        enabled: needsOAuth ? false : enabled,
        authType,
        oauthClientId: authType === "oauth" ? oauthClientId : undefined,
        oauthClientSecret: authType === "oauth" ? oauthClientSecret : undefined,
      });
      saved = true;
      if (needsOAuth) {
        const result = await connect({ serverId });
        window.location.assign(result.authorizationUrl);
        return;
      }
      toast.success(
        enabled ? "Server connected and tools refreshed" : "Server disabled",
      );
      onClose();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          saved
            ? "Server saved, but OAuth could not start. Check the server and OAuth client settings."
            : "Could not save MCP server.",
        ),
      );
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (dirty) setDiscard(true);
          else onClose();
        }
      }}
      title={server ? server.name : "Add MCP server"}
      footer={
        <div className="flex flex-wrap gap-2">
          {discard ? (
            <>
              <PillButton onClick={() => setDiscard(false)}>
                Keep editing
              </PillButton>
              <PillButton variant="destructive" onClick={onClose}>
                Discard changes
              </PillButton>
            </>
          ) : (
            <>
              <PillButton
                disabled={disabled || busy || !name.trim() || !url.trim()}
                onClick={() => void persist()}
              >
                {busy
                  ? "Connecting…"
                  : needsOAuth
                    ? "Save and connect"
                    : enabled
                      ? "Save and refresh tools"
                      : "Save"}
              </PillButton>
              {server?.authType === "oauth" ? (
                <PillButton
                  disabled={disabled || busy || dirty}
                  onClick={() => void reconnect()}
                >
                  {server.hasOAuth ? "Reconnect OAuth" : "Connect OAuth"}
                </PillButton>
              ) : null}
              {server ? (
                <PillButton
                  variant="destructive"
                  disabled={disabled || busy}
                  onClick={() => {
                    if (!confirmRemove) {
                      setConfirmRemove(true);
                      return;
                    }
                    setBusy(true);
                    void remove({
                      serverId: server._id,
                      revision: server.revision,
                    })
                      .then(onClose)
                      .catch((error) =>
                        toast.error(
                          getUserFacingErrorMessage(
                            error,
                            "Could not remove server.",
                          ),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {confirmRemove ? "Confirm remove" : "Remove server"}
                </PillButton>
              ) : null}
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          Tools are shared with all operators. Remote HTTPS servers use
          Streamable HTTP.
        </p>
        <fieldset disabled={disabled || busy} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-url">Server URL</Label>
            <Input
              id="mcp-url"
              type="url"
              placeholder="https://example.com/mcp"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-logo">Logo URL (optional)</Label>
            <Input
              id="mcp-logo"
              type="url"
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
            />
            <OrgBrandIcon name={name} iconUrl={logoUrl} website={url} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-auth">Authentication</Label>
            <Select
              value={authType}
              onValueChange={(value) => {
                if (value === "bearer" || value === "oauth") setAuthType(value);
              }}
              disabled={disabled || busy}
            >
              <SelectTrigger id="mcp-auth" className="w-full">
                <SelectValue>
                  {authType === "oauth" ? "OAuth" : "Bearer token"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "bearer" ? (
            <div className="space-y-2">
              <Label htmlFor="mcp-token">Bearer token (optional)</Label>
              <Input
                id="mcp-token"
                type="password"
                autoComplete="new-password"
                placeholder={
                  server?.hasToken
                    ? "Saved token · leave unchanged to keep"
                    : ""
                }
                value={token ?? ""}
                onChange={(event) => setToken(event.target.value)}
              />
              {server?.hasToken ? (
                <PillButton onClick={() => setToken("")}>
                  Clear token
                </PillButton>
              ) : null}
            </div>
          ) : (
            <>
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Connect in your browser to authorize Spot. All operators will
                use this connection.
              </p>
              <details>
                <summary className="cursor-pointer">
                  OAuth client settings (optional)
                </summary>
                <div className="mt-4 space-y-4">
                  <p
                    className={`text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    Leave blank for automatic client registration.
                  </p>
                  {redirectUrl ? (
                    <div className="space-y-2">
                      <Label htmlFor="mcp-redirect">Redirect URL</Label>
                      <Input
                        id="mcp-redirect"
                        readOnly
                        value={redirectUrl}
                        onFocus={(event) => event.target.select()}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="mcp-client-id">Client ID</Label>
                    <Input
                      id="mcp-client-id"
                      value={oauthClientId}
                      onChange={(event) => setOauthClientId(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-client-secret">Client secret</Label>
                    <Input
                      id="mcp-client-secret"
                      type="password"
                      autoComplete="new-password"
                      value={oauthClientSecret ?? ""}
                      placeholder={
                        server?.hasOAuthClientSecret
                          ? "Saved secret · leave unchanged to keep"
                          : ""
                      }
                      onChange={(event) =>
                        setOauthClientSecret(event.target.value)
                      }
                    />
                    {server?.hasOAuthClientSecret ? (
                      <PillButton onClick={() => setOauthClientSecret("")}>
                        Clear secret
                      </PillButton>
                    ) : null}
                  </div>
                </div>
              </details>
            </>
          )}
          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <SettingsSwitch
              label="Server enabled"
              checked={enabled}
              onCheckedChange={() => setEnabled(!enabled)}
              disabled={disabled || busy}
            />
          </div>
        </fieldset>
      </div>
    </SettingsDrawer>
  );
}
