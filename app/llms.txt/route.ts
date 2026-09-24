import { getClientPortalUrl } from "@/convex/lib/domains";
import { WEBMCP_TOOLS, type WebMcpToolDefinition } from "@/lib/webmcp/catalog";

export const dynamic = "force-static";

function toolLine(name: string, tool: WebMcpToolDefinition) {
  const flags = [tool.readOnly ? "read-only" : null].filter(Boolean);
  const suffix = flags.length > 0 ? ` (${flags.join(", ")})` : "";
  return `- \`${name}\`${suffix}: ${tool.description} Registered on: ${tool.registeredOn}.`;
}

function section(surface: WebMcpToolDefinition["surface"]) {
  return Object.entries(WEBMCP_TOOLS)
    .filter(([, tool]) => tool.surface === surface)
    .map(([name, tool]) => toolLine(name, tool))
    .join("\n");
}

export function GET() {
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

## WebMCP tools

Spot registers WebMCP tools in Chrome (see https://developer.chrome.com/docs/ai/webmcp). Tools appear only on the page and state where they work, and each result is JSON with a \`status\` field. Results often include \`next_tool\` or \`next_url\`. Every tool uses the signed-in person's normal Spot permissions.

### Signup, login, and onboarding forms (declarative)

${section("declarative")}

### Signed-in client workspace (imperative)

${section("imperative")}

## Boundaries

- Policy documents are uploaded and extracted by Spot staff. Clients share supporting documents through insurance requests (\`attach_request_document\`).
- Spot never sends email to a broker or binds coverage on a tool call. Agent-drafted emails wait for the user's explicit send confirmation in the Spot UI. Requests are reviewed by Spot staff before any broker is contacted.
- Certificates of insurance are informational. Requests needing endorsements or additional-insured changes are held for broker review, not generated.

## Other agent interfaces

- Remote MCP server for signed-in organizations (OAuth): ${appUrl}/mcp. Discovery: ${appUrl}/.well-known/mcp.json.
- Tool catalog source: https://github.com/claritylabs-inc/spot/blob/main/docs/architecture/webmcp.md
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
