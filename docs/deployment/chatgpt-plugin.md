# Private ChatGPT plugin rollout

This is an internal rollout checklist for the Spot plugin package. It does not authorize deployment, publication, installation, or registration from this repository worker.

## Known endpoint

The production canonical MCP endpoint is:

```text
https://actions.spot.insure/mcp
```

It is the endpoint documented by Spot’s operator MCP setup and is served by the Convex site. Discovery is available at:

```text
https://actions.spot.insure/.well-known/mcp.json
```

Do not substitute the app origin, a Vercel preview, a Conductor port, or a guessed hostname for the OAuth resource. Development testing must use a real user-provided HTTPS `/mcp` endpoint passed to `SPOT_MCP_URL`.

## Package commands

From the repository root, with Node 24.x:

```bash
SPOT_MCP_URL=https://actions.spot.insure/mcp \
  node plugins/spot/scripts/build-plugin.mjs
node plugins/spot/scripts/validate-plugin.mjs
python3 /home/vercel-sandbox/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/spot
```

The first command writes the portable `mcp.json` and refreshes the compatibility manifest. The second validates the root Agent Plugins manifest and MCP configuration with local `ajv` and checks the endpoint/asset/compatibility invariants. The optional Codex validator checks the compatibility overlay and skill frontmatter. None of these commands calls a live business tool or modifies a deployment.

## Link and test in ChatGPT

Use the current OpenAI documentation flow:

1. Enable ChatGPT **Developer mode** under **Settings → Security and login**.
2. In **ChatGPT Plugins**, select **+** and register the exact HTTPS MCP endpoint. Complete OAuth linking with a test Spot account that has the intended role.
3. Copy the technical ID from the browser URL. It must be the exact user-supplied `plugin_asdk_app...` value. Never invent, redact into a placeholder, or commit this ID.
4. Load the package from an approved private/local marketplace source in the ChatGPT desktop app, or use the approved internal linking flow. This repository change creates no marketplace file and performs no installation.
5. Start a new chat and verify the OAuth connection, tool list, and role boundary. Check that client users see only their native workspace capabilities, brokers see only profile/team settings, and operators see operator tools only when the authenticated operator scope allows them.
6. Verify the ChatGPT UI registration and resource read for `ui://spot/workspace/v1.html`: global workspace, record panel, and `.pdf`/`.md`/`.txt` file viewers. Confirm `structuredContent` is minimal, `_meta` carries the private presentation payload, and a stale or unauthorized reference is rejected.
7. Exercise the insurance workflow: requirements → cited policy evidence → compliance status → held or grounded COI artifact → separate draft/send authorization. Force an unknown/interrupt path and confirm no automatic replay.

End-to-end ChatGPT verification requires the user-linked development endpoint, a real OAuth registration, and the manager-generated UI resource bundle. This worker has not deployed or published anything.

## Manager handoff gates

- UI worker output exists at `plugins/spot/ui/dist/workspace.html`.
- Manager embeds that file in `convex/lib/chatgptResourceBundle.ts`.
- Manager verifies server registration for `open_spot_workspace`, `open_spot_record`, `open_spot_file`, and `read_spot_workspace`.
- Manager verifies current-reference authorization and role-specific tool selection.
- MCP Events peer separately verifies its methods and six role-scoped events before any combined claim.
- A human supplies and reviews the exact `plugin_asdk_app` registration ID if an app mapping is needed.

No production deployment, Vercel preview, secret/config artifact, publication, or actual installation is part of this change.

## Current specifications

- [Package your plugin](https://developers.openai.com/plugins/build/plugins.md)
- [Plugin Extensions](https://developers.openai.com/plugins/build/extensions.md)
- [Authentication](https://developers.openai.com/plugins/build/auth.md)
- [OpenAI MCP Extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.org/specification/2025-11-25/basic/transports)

