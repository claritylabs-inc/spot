/**
 * Source of truth for every WebMCP tool Spot registers in the browser.
 * Forms, imperative registration, `/llms.txt`, and docs/architecture/webmcp.md
 * all read names and descriptions from here. Tool names are a contract with
 * the spot.insure agent docs.
 */
import { agentTools } from "@/lib/webmcp/definitions/agent";
import { authTools } from "@/lib/webmcp/definitions/auth";
import { connectTools } from "@/lib/webmcp/definitions/connect";
import { insuranceTools } from "@/lib/webmcp/definitions/insurance";
import { settingsTools } from "@/lib/webmcp/definitions/settings";
import { workspaceTools } from "@/lib/webmcp/definitions/workspace";
import type {
  ImperativeToolDefinition,
  WebMcpToolDefinition,
} from "@/lib/webmcp/types";

export type { WebMcpJsonSchema, WebMcpToolDefinition } from "@/lib/webmcp/types";
export { WEBMCP_CLIENT_PAGES } from "@/lib/webmcp/definitions/workspace";

export const WEBMCP_TOOLS = {
  ...authTools,
  ...workspaceTools,
  ...insuranceTools,
  ...agentTools,
  ...connectTools,
  ...settingsTools,
} satisfies Record<string, WebMcpToolDefinition>;

export type WebMcpToolName = keyof typeof WEBMCP_TOOLS;

export function getWebMcpTool(name: WebMcpToolName): WebMcpToolDefinition {
  return WEBMCP_TOOLS[name];
}

export function imperativeToolAppliesTo(
  tool: ImperativeToolDefinition,
  pathname: string,
): boolean {
  if (!tool.pages) return true;
  return tool.pages.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Human-readable registration scope for docs and `/llms.txt`. */
export function describeRegistration(tool: WebMcpToolDefinition): string {
  if (tool.surface === "declarative") return tool.registeredOn;
  const where = tool.pages
    ? tool.pages.join(", ")
    : "every signed-in client page";
  const audience =
    tool.audience === "public"
      ? "public page, no sign-in needed"
      : tool.adminOnly
        ? "organization admins"
        : null;
  return audience ? `${where} (${audience})` : where;
}
