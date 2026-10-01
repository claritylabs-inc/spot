#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const pluginRoot = resolve(new URL("..", import.meta.url).pathname);

// These are the small, stable Agent Plugins 1.0.0 schemas published at
// https://agent-plugins.org/schemas/1.0.0. Keep validation local and deterministic;
// this command never downloads a schema at runtime.
const pluginSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  type: "object",
  properties: {
    $schema: { const: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" },
    name: { type: "string", minLength: 1, maxLength: 64, pattern: "^(?!.*(?:--|\\.\\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$" },
    version: { type: "string" },
    description: { type: "string" },
    author: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, url: { type: "string" } }, additionalProperties: false },
    homepage: { type: "string" },
    repository: { type: "string" },
    license: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    extensions: { type: "object", additionalProperties: { type: "object" } },
  },
  required: ["$schema", "name"],
  additionalProperties: false,
};

const mcpSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  type: "object",
  properties: {
    $schema: { const: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" },
    mcpServers: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          type: { const: "streamable-http" },
          url: { type: "string", minLength: 1 },
          headers: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["type", "url"],
        additionalProperties: false,
      },
    },
  },
  required: ["$schema", "mcpServers"],
  additionalProperties: false,
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(pluginRoot, relativePath), "utf8"));
}

function mcpEndpoint(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/mcp" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`${label} must be HTTPS with the exact /mcp path and no credentials/query/fragment`);
  }
  return url.toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const plugin = await readJson("plugin.json");
const mcp = await readJson("mcp.json");
const compatibility = await readJson(".codex-plugin/plugin.json");
const ajv = new Ajv2020({ allErrors: true, strict: false });

for (const [label, schema, value] of [
  ["plugin.json", pluginSchema, plugin],
  ["mcp.json", mcpSchema, mcp],
]) {
  const validator = ajv.compile(schema);
  const valid = validator(value);
  if (!valid) {
    throw new Error(`${label} schema errors:\n${ajv.errorsText(validator.errors)}`);
  }
}

const endpoint = mcpEndpoint(mcp.mcpServers.spot.url, "mcp.json spot URL");
assert(mcp.mcpServers.spot.type === "streamable-http", "mcp.json must use streamable-http");
assert(plugin.name === "spot", "plugin.json name must be spot");
const openAiInterface = plugin.extensions?.["com.openai"]?.interface;
assert(plugin.version === "1.0.2", "plugin.json version must match the private ChatGPT rollout");
assert(plugin.author?.name === "Tools for Enlightenment", "plugin.json author must use the Spot developer name");
assert(openAiInterface?.developerName === "Tools for Enlightenment", "plugin.json developerName must use the Spot developer name");
assert(openAiInterface?.composerIcon === "./assets/icon.jpg", "plugin.json must use the bundled Spot composer icon");
assert(openAiInterface?.logo === "./assets/logo.png", "plugin.json must use the bundled Spot logo");
await readFile(resolve(pluginRoot, "assets/icon.jpg"));
const logoBytes = await readFile(resolve(pluginRoot, "assets/logo.png"));
assert(
  logoBytes.toString("hex", 0, 8) === "89504e470d0a1a0a" &&
    logoBytes.readUInt32BE(16) === logoBytes.readUInt32BE(20) &&
    logoBytes.readUInt32BE(16) >= 48,
  "Spot logo must be a readable square PNG of at least 48×48 pixels",
);
assert(compatibility.name === "spot", "compatibility manifest name must be spot");
assert(compatibility.mcpServers?.spot?.url === endpoint, "compatibility MCP URL must match mcp.json");
assert(compatibility.mcpServers?.spot?.type === "streamable-http", "compatibility manifest must use streamable-http");
assert(compatibility.skills === "./skills/", "compatibility manifest must discover ./skills/");

console.log(`Plugin validation passed: ${pluginRoot}`);
console.log(`MCP endpoint: ${endpoint}`);
console.log("No runtime schema downloads or registration IDs were used.");
