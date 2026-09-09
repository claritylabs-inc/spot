import { describe, expect, test } from "vitest";

import {
  operatorAgentToolJsonCatalog,
  parseOperatorAgentToolInput,
} from "./operatorAgentToolRegistry";
import { buildOperatorMcpToolCatalog } from "./operatorMcpToolCatalog";

describe("operator MCP tool catalog", () => {

  test("limits read-only operators to read tools and run status", () => {
    const tools = buildOperatorMcpToolCatalog({
      canWrite: false,
      operatorRole: "operator",
    });
    const names = tools.map(({ name }) => name);

    expect(names).toContain("get_operator_run");
    expect(names).toContain("get_organization");
    expect(names).toContain("lookup_address");
    expect(names).toContain("list_procurement_requests");
    expect(names).toContain("get_procurement_forwarding_address");
    expect(names).toContain("get_procurement_email_thread");
    expect(names).toContain("lookup_policy");
    expect(names).toContain("lookup_compliance_requirements");
    expect(names).toContain("read_client_file");
    expect(names).toContain("lookup_client_wiki");
    for (const name of [
      "list_company_mailboxes",
      "search_company_email",
      "read_company_email_thread",
      "get_company_email_attachment",
    ]) {
      expect(tools.find((tool) => tool.name === name)).toMatchObject({
        annotations: { readOnlyHint: true, openWorldHint: true },
        securitySchemes: [{ type: "oauth2", scopes: ["read"] }],
      });
    }
    expect(names).not.toContain("generate_coi");
    expect(names).not.toContain("create_procurement_request");
    expect(names).not.toContain("update_procurement_email_thread");
    expect(names).not.toContain("update_client_wiki_section");
    expect(names).not.toContain("run_operator_task");
    expect(names).not.toContain("retry_failed_policy_extraction");
    expect(names).not.toContain("clear_all_agent_memory");
    expect(tools.every(({ annotations }) => annotations.readOnlyHint)).toBe(
      true,
    );
  });

  test("keeps model-callable schemas free of unsupported regex lookaround", () => {
    const catalog = operatorAgentToolJsonCatalog();
    const schemaJson = JSON.stringify(catalog.map((tool) => tool.inputSchema));

    expect(schemaJson).not.toMatch(/\(\?(?:[=!]|<[=!])/);
    expect(() =>
      parseOperatorAgentToolInput("send_operator_slack_message", {
        recipientEmail: "not-an-email",
        message: "Status update",
      }),
    ).toThrow("Enter a valid email address");
    expect(
      parseOperatorAgentToolInput("send_operator_slack_message", {
        recipientEmail: " adyan@spot.insure ",
        message: "Status update",
      }).recipientEmail,
    ).toBe("adyan@spot.insure");
  });
});
