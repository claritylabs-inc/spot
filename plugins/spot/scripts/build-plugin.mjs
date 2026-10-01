#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const pluginRoot = resolve(new URL("..", import.meta.url).pathname);
const mcpPath = resolve(pluginRoot, "mcp.json");
const compatibilityManifestPath = resolve(
  pluginRoot,
  ".codex-plugin",
  "plugin.json",
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireMcpUrl(value) {
  if (!value) {
    throw new Error(
      "Set SPOT_MCP_URL or pass --mcp-url. The build never guesses a deployment endpoint.",
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SPOT_MCP_URL must be a valid URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/mcp" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "SPOT_MCP_URL must be an HTTPS origin endpoint with the exact /mcp path and no credentials, query, or fragment.",
    );
  }

  return url.toString();
}

const mcpUrl = requireMcpUrl(
  argumentValue("--mcp-url") ?? process.env.SPOT_MCP_URL,
);

const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: {
    spot: {
      type: "streamable-http",
      url: mcpUrl,
    },
  },
};

await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`, "utf8");

const compatibility = JSON.parse(
  await readFile(compatibilityManifestPath, "utf8"),
);
compatibility.mcpServers = {
  spot: {
    type: "streamable-http",
    url: mcpUrl,
  },
};
await writeFile(
  compatibilityManifestPath,
  `${JSON.stringify(compatibility, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${mcpPath}`);
console.log(`Updated ${compatibilityManifestPath}`);
console.log(`MCP endpoint: ${mcpUrl}`);
console.log(
  "No plugin_asdk_app ID was created or persisted; registration remains an explicit user-supplied rollout gate.",
);

