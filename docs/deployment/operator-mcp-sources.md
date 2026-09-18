# Operator MCP sources

Settings → MCP connections configures shared remote HTTPS Streamable HTTP servers.
Operators can select **Bearer token** or **OAuth**. Empty bearer credentials allow
anonymous servers. Local stdio and legacy standalone SSE transports are not
supported. The settings list and operator tool activity use each server's logo
URL, with the shared website favicon/initial fallback.

## Credentials and OAuth setup

Set `EMAIL_CONNECTIONS_ENCRYPTION_KEY` on the Convex deployment. This existing
credential encryption key protects bearer tokens, OAuth access/refresh tokens,
client secrets, and temporary PKCE verifiers. Keep it stable across deployments.
No credentials are exposed by portal queries or model tools.

OAuth callbacks use the deployment's `CONVEX_SITE_URL`:

```text
https://<deployment>.convex.site/operator-mcp/oauth/callback
```

The OAuth client metadata document is at
`/operator-mcp/oauth/client-metadata.json` on the same origin. MCP authorization
server discovery selects the issuer and endpoints. The SDK uses client metadata
registration where supported, otherwise dynamic client registration. For a
pre-registered application, enter its client ID and optional secret under
**OAuth client settings** and register the exact **Redirect URL** shown there.

Select **Save and connect** to save configuration and open the provider's consent
page. After authorization, Spot discovers tools and enables the server. Existing
connections offer **Reconnect OAuth**. Connection grants are shared: all active
operators can use them through the normal tool-approval path.

The callback must be reachable from the browser and accepted by the authorization
server. For cloud deployments it is HTTPS. Local development needs a reachable
callback origin accepted by the provider; provider support for HTTP localhost
callbacks varies. OAuth metadata and token endpoints themselves must be public
HTTPS destinations. Redirects and private network destinations are rejected.

## Runtime behavior

`list_mcp_tools` lists enabled servers and tool names; passing `serverId` returns
that server's full saved tool schemas. `call_mcp_tool` invokes an exact server
revision/tool/argument tuple through the shared operator audit, idempotency, and
approval path. Remote read-only annotations do not bypass approval. Approve all
can satisfy the gate. These sources are absent from tenant agents and tenant MCP.

Save and refresh tools replaces the catalog. Editing configuration or reconnecting
increments its revision, so pending approvals cannot switch credentials or target.
Access-token refresh preserves the revision and serializes refresh-token rotation.
Expired grants without a usable refresh token require reconnecting. HTTP failures
do not replay business calls; an unknown outcome must be checked before retrying.

OAuth state is hashed, single-use, bound to the operator and server revision, and
expires after ten minutes. Temporary consent data is encrypted and scheduled for
deletion. Callbacks recheck operator status and impersonation before and after
exchange. Tokens obtained by stale callbacks are never installed.

Disabling or removing a server stops new tool calls. Removing it deletes locally
stored credentials; it does not revoke the grant at the external provider.
Configuration supports up to 16 servers. Each catalog is bounded to 250 tools and
250 KB; individual remote responses are bounded to 1 MB.
