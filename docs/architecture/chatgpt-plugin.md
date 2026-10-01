# Spot ChatGPT plugin architecture

This document describes the private CLA-179 ChatGPT plugin boundary. It is a packaging and integration contract, not a promise that every Spot web route is available in ChatGPT.

## Package and transport

`plugins/spot/plugin.json` is the portable Agent Plugins 1.0.0 entrypoint. `plugins/spot/mcp.json` uses the current MCP `streamable-http` transport and points at the canonical production endpoint `https://actions.spot.insure/mcp`, which is also recorded in `docs/deployment/operator-mcp.md`. The compatibility `.codex-plugin/plugin.json` mirrors the connection for older discovery and is not the canonical manifest.

The build script takes an explicit `SPOT_MCP_URL` and rejects non-HTTPS URLs, paths other than `/mcp`, credentials, queries, and fragments. A deployment URL is never inferred. The package contains no provider secret, OAuth credential, website session cookie, or guessed registration ID. The local validator uses the pinned Agent Plugins schema shape through `ajv`; it has no network schema-fetch path.

ChatGPT authentication is OAuth 2.1 for MCP: protected-resource metadata, an authorization-server discovery document, resource propagation, PKCE, issuer/audience/scope validation, and exact resource binding remain server responsibilities. The plugin host must use the authenticated existing MCP connection. It must not borrow Spot website cookies or treat a static package as proof of authorization.

## UI resources and entrypoints

The manager-owned MCP server registers the following ChatGPT extensions against `ui://spot/workspace/v1.html`:

| Entrypoint | Host surface | Input boundary |
| --- | --- | --- |
| `open_spot_workspace` | Global/sidebar workspace | Opens the current authorized workspace; no record is implied |
| `open_spot_record` | Thread/record panel | Requires an exact authorized record reference |
| `open_spot_file` | File viewer | Handles `.pdf`, `.md`, and `.txt`; requires an exact authorized file reference |

`read_spot_workspace` is the read/render operation for the UI. It should return only the minimal model-visible `structuredContent` needed to identify the presentation. The richer current-reference UI payload belongs in `_meta["spot/workspace"]` and is private to the authenticated UI host. Server-side authorization, not `_meta`, decides what may be read.

The UI host consumes the already-authenticated business tools. It does not create a nested existing Spot dock, reproduce website cookie auth, or execute business tools from composition. The manager embeds `plugins/spot/ui/dist/workspace.html` at compile time into `convex/lib/chatgptResourceBundle.ts`; the packaging worker owns no UI source or generated Convex file.

## Role-scoped coverage

Client-native coverage includes bound policies and original policy PDFs, certificates, compliance and requirement comparisons, authorized files, company wiki content, and procurement requests. Client responses must preserve the filename-based `private.md`/`public.md` boundary and separately authorized request files.

Broker access is deliberately limited to profile and team settings. Broker scope is separate from read-only behavior: a read-only broker view does not grant policy, file, procurement, proposal, or company-record access.

Operators retain operator-authorized policy, certificate, compliance, file, wiki, procurement, and mailbox tools. Operator-only coverage includes proposals, market activity, exact approvals, and durable run status. Active role, impersonation, integrations, exact target authorization, and approval are rechecked when a tool executes.

Billing, security/privacy administration, organization administration, and integration setup use the deliberate website handoffs in [`plugins/spot/README.md`](../../plugins/spot/README.md). The package does not claim complete parity with those native web surfaces.

## MCP Events boundary

`/mcp` routes unrecognized methods to the MCP Events adapter (`handleMcpEventRequest`) after the Spot app methods, and merges `MCP_EVENT_CAPABILITIES` into `server/discover`. Adapter errors keep their JSON-RPC `code` and `data` (for example `-32015` callback verification failures). Authorization is unchanged: the adapter receives the already authenticated identity. Events have not been exercised end to end from a live ChatGPT host.

## Safety and outcome semantics

The insurance workflow skill keeps requirement intake, policy evidence, compliance comparison, COI artifact preparation, and sending as separate stages. Exact recipients and attachments are revalidated for a send. Unknown outcomes are durable states, not implicit success or permission to replay. A router failure, missing citation, or uncertain eligibility remains `unverified`/held.

The package contract follows the [current plugin packaging guide](https://developers.openai.com/plugins/build/plugins.md), [extension reference](https://developers.openai.com/plugins/build/extensions.md), [OAuth authentication guide](https://developers.openai.com/plugins/build/auth.md), [OpenAI MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md), and [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

