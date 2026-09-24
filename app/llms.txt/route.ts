import { getClientPortalUrl } from "@/convex/lib/domains";
import { webmcpEnabled } from "@/lib/flags";
import {
  describeRegistration,
  WEBMCP_TOOLS,
  type WebMcpToolDefinition,
} from "@/lib/webmcp/catalog";

export const dynamic = "force-dynamic";

function toolLine(name: string, tool: WebMcpToolDefinition) {
  const flags = [
    tool.readOnly ? "read-only" : null,
    tool.consequential ? "consequential" : null,
  ].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  return `- \`${name}\`${suffix}: ${tool.description}`;
}

/** Tools grouped under a heading per registration scope, in catalog order. */
function sections(include: (tool: WebMcpToolDefinition) => boolean) {
  const groups = new Map<string, string[]>();
  for (const [name, tool] of Object.entries(WEBMCP_TOOLS)) {
    if (!include(tool)) continue;
    const scope = describeRegistration(tool);
    groups.set(scope, [...(groups.get(scope) ?? []), toolLine(name, tool)]);
  }
  return [...groups]
    .map(([scope, lines]) => `#### ${scope}\n\n${lines.join("\n")}`)
    .join("\n\n");
}

export async function GET() {
  const enabled = await webmcpEnabled();
  const appUrl = getClientPortalUrl();
  const body = `# Spot

> Spot is an AI insurance operations workspace for businesses. Clients see every policy in one place, ask coverage questions against the actual policy wording, generate certificates of insurance, track contract insurance requirements, and send new-coverage and renewal requests to the Spot team.

This is the Spot web app (${appUrl}). The marketing site and product overview live at https://spot.insure (agent summary: https://spot.insure/llms.txt).

## Client signup (self-serve)

- Start at ${appUrl}/signup/client. Add \`?email=name@company.com\` to prefill the email.
- Signup needs no invite. It creates a new client workspace owned by the signing-up person.
- Email verification is mandatory: Spot emails a 6-digit code that expires after 15 minutes. An agent must get the code from the account owner, or read it from a mailbox it is authorized to access. Never guess codes.
- After verification, onboarding has three steps: your profile, your company, finish. The client workspace then opens at ${appUrl}/policies.
- Existing accounts sign in at ${appUrl}/login.

${enabled ? `## WebMCP tools

Spot registers WebMCP tools in Chrome (see https://developer.chrome.com/docs/ai/webmcp). Anything a signed-in client can do in the app is a tool, and every tool runs the action directly with that person's normal Spot permissions. There is no extra confirmation step. Tools marked consequential send email, spend AI extraction time, or cannot be undone. Tools appear only on the page and for the role where they work: open another page with \`open_spot_page\`. Admin tools register only for organization admins. Each result is JSON with a \`status\` field and often \`next_tool\` or \`next_url\`.

### Signup, login, and onboarding forms (declarative)

${Object.entries(WEBMCP_TOOLS)
  .filter(([, tool]) => tool.surface === "declarative")
  .map(([name, tool]) => `${toolLine(name, tool)} Form: ${describeRegistration(tool)}.`)
  .join("\n")}

### Signed-in client workspace (imperative)

${sections((tool) => tool.surface === "imperative" && tool.audience === "client")}

### Public share pages (imperative)

${sections((tool) => tool.surface === "imperative" && tool.audience === "public")}

` : ""}

## What clients cannot do

- Upload, edit, archive, or re-extract policies, or manage shared files: Spot staff do this. Clients share documents through insurance requests (\`attach_request_document\`).
- Edit, cancel, or comment on a submitted insurance request, see broker proposals, or select a proposal: Spot staff run procurement. Binding coverage is not a client action.
- Edit the agent email address, create Slack channels, or reset the organization.

## Other agent interfaces

- Remote MCP server for signed-in organizations (OAuth): ${appUrl}/mcp. Discovery: ${appUrl}/.well-known/mcp.json.
${enabled ? "- Tool catalog source: https://github.com/claritylabs-inc/spot/blob/main/docs/architecture/webmcp.md" : ""}
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
