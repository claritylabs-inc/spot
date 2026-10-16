/**
 * Shared operator MCP connection contract.
 *
 * The operator MCP server is the Convex site's `/mcp` endpoint. Operator
 * tokens are audience-bound to that exact URL and need both `read` and
 * `write` scope to reach the durable operator task tools, so the Codex
 * commands below pin the resource and the scopes explicitly.
 *
 * Used by the operator Channels UI, `scripts/setup-operator-mcp.mjs`, and
 * `docs/deployment/operator-mcp.md`.
 */

const OPERATOR_MCP_SERVER_NAME = "spot";

type OperatorMcpClientId = "claude-code" | "codex";

export type OperatorMcpClientSetup = {
  id: OperatorMcpClientId;
  label: string;
  /** Argv-style command that registers the server. */
  command: string[];
  /** Sign-in command that opens a browser, when the client has one. */
  authCommand?: string[];
  /** Copy-paste block covering every command. */
  snippet: string;
  /** What the operator still has to do after the commands run. */
  followUp: string;
};

export function operatorMcpEndpoint(siteUrl: string): string {
  return `${new URL(siteUrl).origin}/mcp`;
}

export function operatorMcpClientSetups({
  endpoint,
  claudeScope = "user",
}: {
  endpoint: string;
  claudeScope?: "local" | "user" | "project";
}): OperatorMcpClientSetup[] {
  const name = OPERATOR_MCP_SERVER_NAME;
  const claudeCommand = [
    "claude",
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    claudeScope,
    name,
    endpoint,
  ];
  const codexCommand = [
    "codex",
    "mcp",
    "add",
    name,
    "--url",
    endpoint,
    "--oauth-resource",
    endpoint,
  ];
  const codexAuthCommand = [
    "codex",
    "mcp",
    "login",
    name,
    "--scopes",
    "read,write",
  ];

  return [
    {
      id: "claude-code",
      label: "Claude Code",
      command: claudeCommand,
      snippet: claudeCommand.join(" "),
      followUp: `Run /mcp inside Claude Code, choose ${name}, and authenticate with your operator email.`,
    },
    {
      id: "codex",
      label: "Codex",
      command: codexCommand,
      authCommand: codexAuthCommand,
      snippet: [codexCommand, codexAuthCommand]
        .map((c) => c.join(" "))
        .join("\n"),
      followUp: `${codexAuthCommand.join(" ")} opens the Spot consent screen in your browser.`,
    },
  ];
}

/** Configuration body for clients without a Spot-aware CLI. */
export function operatorMcpClientConfig(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [OPERATOR_MCP_SERVER_NAME]: { type: "http", url: endpoint },
      },
    },
    null,
    2,
  );
}
