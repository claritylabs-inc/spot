import { flag } from "flags/next";

/**
 * Gates WebMCP (browser-agent tool registration via `document.modelContext`).
 * Defaults to off; toggle per environment with `WEBMCP_ENABLED=true` or an
 * override from the Vercel Toolbar (requires `FLAGS_SECRET`).
 */
export const webmcpEnabled = flag<boolean>({
  key: "webmcp-enabled",
  description: "Registers WebMCP browser-agent tools (document.modelContext).",
  defaultValue: false,
  decide: () => process.env.WEBMCP_ENABLED === "true",
});
