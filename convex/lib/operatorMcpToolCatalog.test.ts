import { describe, expect, test } from "vitest";

import {
  operatorAgentToolJsonCatalog,
  parseOperatorAgentToolInput,
} from "./operatorAgentToolRegistry";
import { buildOperatorMcpToolCatalog } from "./operatorMcpToolCatalog";

describe("operator MCP tool catalog", () => {
  test("publishes exact broker taxonomies and rejects invented values before confirmation", () => {
    const catalog = operatorAgentToolJsonCatalog();
    const brokerTool = catalog.find(
      ({ name }) => name === "update_broker_network_profile",
    );
    expect(brokerTool).toBeDefined();
    const schema = brokerTool?.inputSchema as {
      properties?: Record<
        string,
        { description?: string; anyOf?: Array<Record<string, unknown>> }
      >;
    };
    const lineArray = schema.properties?.lineOfBusinessCodes?.anyOf?.find(
      (branch) => branch.type === "array",
    ) as { items?: { enum?: string[]; description?: string } } | undefined;
    expect(lineArray?.items?.enum).toContain("AUTOB");
    expect(lineArray?.items?.enum).not.toContain("CAUT");
    expect(lineArray?.items?.description).toContain("Business Automobile");
    expect(schema.properties?.website?.description).toContain(
      "Omit to preserve",
    );

    expect(() =>
      parseOperatorAgentToolInput("update_broker_network_profile", {
        brokerOrgId: "broker-1",
        lineOfBusinessCodes: ["CGL", "PROP", "CAUT"],
      }),
    ).toThrow();
    expect(
      parseOperatorAgentToolInput("update_broker_network_profile", {
        brokerOrgId: "broker-1",
        writingStates: ["CA", "NY"],
        lineOfBusinessCodes: ["CGL", "PROP", "AUTOB"],
      }),
    ).toStrictEqual({
      brokerOrgId: "broker-1",
      writingStates: ["CA", "NY"],
      lineOfBusinessCodes: ["CGL", "PROP", "AUTOB"],
    });
    for (const invalid of [
      { writingStates: ["California"] },
      { website: "blisins.com" },
    ]) {
      expect(() =>
        parseOperatorAgentToolInput("update_broker_network_profile", {
          brokerOrgId: "broker-1",
          ...invalid,
        }),
      ).toThrow();
    }
  });

  test("grounds representative dates, emails, and websites in executable schemas", () => {
    expect(
      parseOperatorAgentToolInput("create_procurement_request", {
        orgId: "client-1",
        title: "Renewal",
        narrative: "Renew the current program.",
        targetEffectiveDate: "2027-01-15",
      }),
    ).toMatchObject({ targetEffectiveDate: "2027-01-15" });
    expect(() =>
      parseOperatorAgentToolInput("create_procurement_request", {
        orgId: "client-1",
        title: "Renewal",
        narrative: "Renew the current program.",
        targetEffectiveDate: "01/15/2027",
      }),
    ).toThrow();
    expect(() =>
      parseOperatorAgentToolInput("create_procurement_broker_outreach", {
        procurementRequestId: "request-1",
        brokerOrgId: "broker-1",
        contactEmail: "broker at example.com",
      }),
    ).toThrow("Enter a valid email address");
    expect(() =>
      parseOperatorAgentToolInput("create_client_organization", {
        name: "Example Client",
        website: "example.com",
      }),
    ).toThrow();
    expect(
      parseOperatorAgentToolInput("update_organization_profile", {
        orgId: "client-1",
        website: null,
      }),
    ).toStrictEqual({ orgId: "client-1", website: null });
  });

  test("rejects null-only omitted updates but accepts explicit clears", () => {
    const cases = [
      {
        name: "update_procurement_request",
        id: "procurementRequestId",
        omitted: "title",
        cleared: "targetEffectiveDate",
      },
      {
        name: "update_broker_network_profile",
        id: "brokerOrgId",
        omitted: "name",
        cleared: "website",
      },
      {
        name: "update_procurement_broker_outreach",
        id: "procurementOutreachId",
        omitted: "status",
        cleared: "log",
      },
      {
        name: "update_procurement_file_item",
        id: "procurementFileItemId",
        omitted: "label",
        cleared: "notes",
      },
    ];
    for (const { name, id, omitted, cleared } of cases) {
      expect(() =>
        parseOperatorAgentToolInput(name, {
          [id]: "record-1",
          [omitted]: null,
        }),
      ).toThrow("At least one");
      const clear = { [id]: "record-1", [cleared]: null };
      expect(parseOperatorAgentToolInput(name, clear)).toStrictEqual(clear);
    }
  });
  test("omits absent inputs while preserving explicit clears and rejecting invalid types", () => {
    expect(
      parseOperatorAgentToolInput("create_broker_network_profile", {
        name: "Example supplier",
        officeAddress: { city: "Boston", street2: null },
      }),
    ).toStrictEqual({
      name: "Example supplier",
      officeAddress: { city: "Boston" },
    });
    expect(
      parseOperatorAgentToolInput("list_company_mailboxes", {
        cursor: null,
        limit: 1,
      }),
    ).toStrictEqual({ limit: 1 });
    expect(
      parseOperatorAgentToolInput("search_company_email", {
        query: "warehouse",
        mailboxes: null,
        cursor: null,
        limit: 10,
      }),
    ).toStrictEqual({ query: "warehouse", limit: 10 });
    expect(
      parseOperatorAgentToolInput("update_procurement_request", {
        procurementRequestId: "request-1",
        title: null,
        clientVisible: false,
        targetEffectiveDate: null,
      }),
    ).toStrictEqual({
      procurementRequestId: "request-1",
      clientVisible: false,
      targetEffectiveDate: null,
    });
    for (const input of [{ cursor: false }, { limit: "1" }]) {
      expect(() =>
        parseOperatorAgentToolInput("list_company_mailboxes", input),
      ).toThrow();
    }
    for (const input of [
      { query: null },
      { query: "warehouse", mailboxes: "a@example.com" },
    ]) {
      expect(() =>
        parseOperatorAgentToolInput("search_company_email", input),
      ).toThrow();
    }
    expect(() =>
      parseOperatorAgentToolInput("get_company_email_attachment", {
        mailbox: "a@example.com",
        messageId: "message-1",
        attachmentId: null,
      }),
    ).toThrow();
  });

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
