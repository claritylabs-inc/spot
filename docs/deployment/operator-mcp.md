# Operator MCP setup

The operator MCP server is the Convex site's `/mcp` endpoint. It exposes the
operator agent tool registry plus the durable operator task tools to an
authenticated operator, and it is the same endpoint tenants use — the principal
on the OAuth token decides which catalog is served.

| Deployment         | Endpoint                                              |
| ------------------ | ----------------------------------------------------- |
| Production         | `https://actions.spot.insure/mcp`                     |
| Shared dev         | `https://acoustic-caiman-755.convex.site/mcp`         |
| Conductor worktree | `http://127.0.0.1:<site port>/mcp` (see `.env.local`) |

The operator portal shows the endpoint for the deployment you are signed into,
with copy-paste commands, under **Channels → MCP**.

## One command

```bash
npm run operator:mcp                      # production, Claude Code + Codex
npm run operator:mcp -- --env local       # this worktree's Convex deployment
npm run operator:mcp -- --client codex    # one agent only
npm run operator:mcp -- --print           # show the commands, change nothing
npm run operator:mcp -- --url https://acoustic-caiman-755.convex.site
```

The script writes the user-scoped Claude Code and Codex configuration, then
prints the sign-in step for each. Conductor has no MCP format of its own: its
Claude Code and Codex sessions load exactly these files, so a workspace picks
the server up as soon as it starts.

## What the commands do

Claude Code:

```bash
claude mcp add --transport http --scope user spot https://actions.spot.insure/mcp
```

Then run `/mcp` inside Claude Code, choose `spot`, and authenticate with your
operator email. Claude Code reads the protected-resource metadata, so it
requests the `read` and `write` scopes and the correct audience automatically.

Codex:

```bash
codex mcp add spot --url https://actions.spot.insure/mcp --oauth-resource https://actions.spot.insure/mcp
codex mcp login spot --scopes read,write
```

`codex mcp login` opens the browser consent screen. Both flags matter:

- **`--oauth-resource`** pins the RFC 8707 resource indicator. Operator
  authorization is rejected without one, and the issued token is bound to that
  exact endpoint (`convex/oauth.ts`, `convex/http.ts`).
- **`--scopes read,write`** is required for anything beyond reads. Without the
  `write` scope the server lists only read tools and rejects
  `run_operator_task`, `confirm_operator_action`, `cancel_operator_run`, and
  every registered write tool with `insufficient_scope`.

Any other client works if it supports remote MCP over streamable HTTP with
OAuth and requests both scopes:

```json
{
  "mcpServers": {
    "spot": { "type": "http", "url": "https://actions.spot.insure/mcp" }
  }
}
```

## Access and safety

- Only an active operator profile can complete the operator authorization; a
  tenant account signing in at the same endpoint gets the tenant catalog.
- Owner-only tools appear only for owners; protected writes still pause for
  exact confirmation and can be resumed from another internal channel.
- Disconnect from the client side with `codex mcp logout <name>` or
  `claude mcp remove <name>`; both revoke through `/oauth/revoke`. Operator
  connections are not listed in the tenant Connected apps settings, which are
  scoped to an organization membership.
- `/oauth/revoke` accepts a form-encoded `token` containing either the access or
  refresh token, and an optional matching `client_id`. Revoking either invalidates
  its stored access/refresh pair. Unknown tokens succeed idempotently; the legacy
  Bearer-token request also remains supported.
- The endpoint is also reachable through the app origin (`/mcp` is proxied by
  `next.config.ts`), but configure clients with the Convex site URL above so the
  token audience matches without relying on the proxy.

The tool inventory itself lives in [AGENT_TOOLS.md](../../AGENT_TOOLS.md).
