# Spot ChatGPT plugin (private rollout)

This directory is the isolated internal packaging layer for Spot’s ChatGPT MCP plugin. It contains the portable Agent Plugins manifest, a streamable HTTP connection, one insurance workflow skill, and the Spot logo and composer icon. Both bundled images are referenced directly by the manifest so ChatGPT can render the listing and composer branding.

The portable package connects to the production OAuth MCP endpoint documented by Spot at `https://actions.spot.insure/mcp`. The endpoint is also the source of the current discovery document at `https://actions.spot.insure/.well-known/mcp.json`. The package does not contain provider credentials, OAuth secrets, website cookies, or a `plugin_asdk_app` registration ID.

## Coverage and boundaries

The authenticated host consumes Spot’s existing MCP tools. The plugin does not recreate the web app’s auth, add a nested Spot agent dock, or imply complete website parity.

| Role | Native plugin coverage | Explicit boundary |
| --- | --- | --- |
| Client | Bound policies and policy PDFs, certificates, compliance and requirement comparisons, authorized files, company wiki, and procurement requests | Client-visible content only; no `private.md`, proposals, operator market activity, or operator approvals |
| Broker | Profile and team settings only | Broker data access is separate and read-only where applicable; no policy, file, procurement, proposal, or company-record expansion |
| Operator | The operator-authorized policy, certificate, compliance, file, wiki, procurement, and mailbox tools, plus operator-only proposals, market activity, exact approvals, and durable run status | Active operator role, impersonation, exact target authorization, and approval are rechecked at execution |

MCP Events (`events/list`, `events/subscribe`, `events/unsubscribe`, six role-scoped events) are served by the same `/mcp` endpoint and advertised in `server/discover`. They have not been exercised end to end from a live ChatGPT host.

## Website handoffs

These are deliberate links for work that the ChatGPT host contract does not natively provide:

- Billing and plan information: [Spot pricing](https://spot.insure/pricing).
- Security, privacy, and support questions: [Contact Spot](https://spot.insure/contact). Spot has no verified dedicated security route in this package, so the link is not presented as a security portal.
- Client organization administration: [Spot organization settings](https://app.spot.insure/settings?section=organization).
- Client integration connections: [Spot integrations](https://app.spot.insure/settings?section=integrations); mailbox connections are under [Spot mailbox settings](https://app.spot.insure/settings?section=mailboxes).
- Operator MCP and channel setup: [Spot operator channels](https://app.spot.insure/operator/channels?tab=mcp).

These handoffs are not claims that the ChatGPT plugin supports billing, security administration, all organization settings, or every integration.

## Build and validate

Run from the Spot repository with Node 24.x:

```bash
SPOT_MCP_URL=https://actions.spot.insure/mcp \
  node plugins/spot/scripts/build-plugin.mjs
node plugins/spot/scripts/validate-plugin.mjs
```

`build-plugin.mjs` requires an explicitly supplied `SPOT_MCP_URL` (or `--mcp-url`), accepts only HTTPS URLs with the exact `/mcp` path, and updates both `mcp.json` and the compatibility manifest. It never invents a deployment URL or a registered `plugin_asdk_app` ID. The validator uses the locally installed `ajv` package and embedded copies of the grounded Agent Plugins 1.0.0 manifest/MCP schemas; it never downloads schemas at runtime.

The portable root manifest is `plugin.json`. `.codex-plugin/plugin.json` is retained only as a compatibility fallback for older Codex package discovery. No `.app.json` is committed because no real registered app ID was supplied. When the registration owner supplies the exact ID returned by ChatGPT developer mode, add that mapping in a separately approved packaging change; do not put a placeholder in this package.

## Install, link, and run verification

The current OpenAI flow is:

1. In ChatGPT, enable **Settings → Security and login → Developer mode**.
2. Open **ChatGPT Plugins**, select **+**, and register the exact linked development MCP endpoint. For this production-configured package that endpoint is `https://actions.spot.insure/mcp`; for a user-provided development deployment, pass that exact URL to the build script instead.
3. Copy the technical ID from the resulting URL. It starts with `plugin_asdk_app`; do not guess or commit it.
4. For a local/private package test, expose the repository package through the user’s approved local or repo marketplace source, then install/refresh it in the ChatGPT desktop app. This change intentionally does not create or install a marketplace entry.
5. Start a new chat, invoke the plugin, and verify OAuth sign-in, role-scoped tool discovery, and the global workspace entrypoint. Test file entrypoints with `.pdf`, `.md`, and `.txt` only.

For Codex-local inspection, the package can be validated in place and loaded through the user’s own marketplace configuration. Do not deploy a Vercel preview, run a production deploy, publish the plugin, or treat static validation as an end-to-end authorization test.

## UI contract and live gates

The server-side manager owns the registered UI tools and the embedded resource. The expected entrypoints are:

- `open_spot_workspace` — global sidebar entrypoint;
- `open_spot_record` — thread/record entrypoint;
- `open_spot_file` — file entrypoint for `.pdf`, `.md`, and `.txt`;
- `read_spot_workspace` — read/render operation that separates UI presentation from business-tool execution;
- `find_insurance_quotes` — opens the authorized quote request workspace;
- `create_insurance_certificate` — opens the certificate workspace without generating or sending a certificate;
- `compare_insurance_coverage` — opens bound policy evidence;
- `check_insurance_compliance` — opens compliance requirements and status;
- resource URI `ui://spot/workspace/v2.html` (the server keeps the v1 URI readable for cached registrations).

The four task tools are read-only UI launchers for client and operator roles; brokers retain their profile/team/settings workspace. Business writes continue through their separately authorized tools and existing confirmation rules. Task descriptions intentionally name user goals so requests such as “find me insurance quotes” and “create an insurance certificate” discover the matching Spot view.

The UI build path is `plugins/spot/ui/dist/workspace.html`; the UI worker owns that directory. At compile time the manager embeds it in `convex/lib/chatgptResourceBundle.ts`. Tool results should keep `structuredContent` minimal and put the private UI payload in `_meta` under the Spot workspace namespace, with current-reference authorization enforced by the server. Composition must not execute business tools.

The remaining live gates are a user-linked development endpoint, a real OAuth registration, the manager’s generated resource bundle, and manager verification of the separate MCP Events peer. None is proven by this packaging-only change.

## Source specifications

- [Package your plugin](https://developers.openai.com/plugins/build/plugins.md)
- [Plugin Extensions](https://developers.openai.com/plugins/build/extensions.md)
- [Authentication](https://developers.openai.com/plugins/build/auth.md)
- [OpenAI MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
