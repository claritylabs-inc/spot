import { expect, test } from "vitest";
import {
  buildTenantMcpToolCatalog,
  tenantMcpToolAccess,
  tenantMcpToolNames,
  resolveTenantMcpToolCall,
} from "./tenantMcpToolCatalog";

const requiredNames = [
  "ask_spot",
  "list_policies",
  "get_policy",
  "search_policies",
  "list_email_drafts",
  "draft_email",
  "update_email_draft",
  "send_email_draft",
  "send_email_drafts",
  "cancel_email_draft",
  "list_connected_vendors",
  "get_connected_vendor",
  "list_connected_vendor_policies",
  "list_vendor_compliance",
  "list_certificates",
  "list_policy_versions",
  "update_company_wiki",
  "create_compliance_requirement",
  "list_my_policies",
  "get_org_info",
  "read_company_wiki",
  "write_company_wiki",
  "list_client_files",
  "get_client_file",
  "list_insurance_requirements",
  "create_insurance_requirement",
  "get_policy_stats",
  "list_policy_certificates",
  "list_certificate_holders",
  "list_certificate_versions",
  "generate_policy_certificate",
];

test("tenant MCP catalog preserves external names and projects annotations from access metadata", () => {
  const names = tenantMcpToolNames();
  expect(names).toEqual(expect.arrayContaining(requiredNames));
  expect(new Set(names).size).toBe(names.length);
  const tools = buildTenantMcpToolCatalog();
  expect(tools).toMatchSnapshot();
  expect(names).not.toContain("get_thread_messages");
  expect(names).not.toContain("list_threads");
  for (const tool of tools) {
    const access = tenantMcpToolAccess(tool.name);
    expect(access).not.toBeNull();
    expect(tool.annotations.readOnlyHint).toBe(access?.effect === "read");
    expect(tool.securitySchemes[0].scopes).toEqual(
      access?.effect === "write" ? ["read", "write"] : ["read"],
    );
  }
});

test("read-only tokens cannot dispatch write tools or alias around the scope gate", () => {
  for (const name of [
    "draft_email",
    "send_email_draft",
    "cancel_email_draft",
    "generate_coi",
    "save_note",
    "update_company_wiki",
    "create_compliance_requirement",
    "write_company_wiki",
    "create_insurance_requirement",
    "generate_policy_certificate",
  ]) {
    expect(() => resolveTenantMcpToolCall(name, {}, false)).toThrow(
      /write scope/i,
    );
  }
  expect(resolveTenantMcpToolCall("list_policies", {}, false).name).toBe(
    "list_policies",
  );
  expect(() => resolveTenantMcpToolCall("unknown_tool", {}, true)).toThrow(
    /Unknown tool/,
  );
});

test("deprecated aliases keep old input names and route to their shared tool", () => {
  const cases: Array<
    [string, Record<string, unknown>, string, Record<string, unknown>]
  > = [
    ["list_my_policies", {}, "lookup_policy", {}],
    ["get_org_info", {}, "lookup_company_context", {}],
    ["read_company_wiki", {}, "lookup_company_context", {}],
    [
      "list_client_files",
      { client_org_id: "org-1", query: "lease" },
      "lookup_client_files",
      { orgId: "org-1", query: "lease" },
    ],
    [
      "get_client_file",
      { client_file_id: "file-1" },
      "read_client_file",
      { clientFileId: "file-1" },
    ],
    ["list_insurance_requirements", {}, "lookup_compliance_requirements", {}],
    ["get_policy_stats", {}, "lookup_policy", {}],
    [
      "list_policy_certificates",
      { policy_id: "policy-1" },
      "list_certificates",
      { policyId: "policy-1" },
    ],
    [
      "list_certificate_holders",
      { q: "holder" },
      "list_certificates",
      { holderQuery: "holder" },
    ],
    [
      "list_certificate_versions",
      { certificate_holder_id: "holder-1" },
      "list_certificates",
      { holderId: "holder-1" },
    ],
    [
      "write_company_wiki",
      { markdown: "# Company", expected_revision: 2 },
      "update_company_wiki",
      { markdown: "# Company", expectedRevision: 2 },
    ],
    [
      "create_insurance_requirement",
      {
        kind: "coverage",
        scope: "own_org",
        title: "Liability",
        requirement_text: "Carry CGL",
        line_of_business: "CGL",
      },
      "create_compliance_requirement",
      {
        kind: "coverage",
        scope: "own_org",
        title: "Liability",
        requirementText: "Carry CGL",
        lineOfBusiness: "CGL",
      },
    ],
  ];
  for (const [name, input, sharedName, mapped] of cases) {
    const call = resolveTenantMcpToolCall(name, input, true);
    expect(call).toMatchObject({
      sharedName,
      input: mapped,
      retiredAlias: true,
      compatibility: false,
    });
    const entry = buildTenantMcpToolCatalog().find(
      (tool) => tool.name === name,
    );
    expect(entry?.description).toMatch(
      new RegExp(`^Deprecated alias of ${sharedName}\\.`),
    );
  }
  expect(
    resolveTenantMcpToolCall(
      "generate_policy_certificate",
      { policy_id: "policy-1", holderName: "Acme" },
      true,
    ),
  ).toMatchObject({
    sharedName: "generate_coi",
    input: { policyId: "policy-1", certificateHolder: "Acme" },
  });
});

test("preserved aliases map inputs to their shared handler contracts", () => {
  expect(
    resolveTenantMcpToolCall(
      "list_policies",
      { carrier: "Acme", type: "CGL" },
      true,
    ),
  ).toMatchObject({
    name: "list_policies",
    sharedName: "lookup_policy",
    input: { carrier: "Acme", lineOfBusiness: "CGL" },
  });
  expect(
    resolveTenantMcpToolCall("get_policy", { id: "policy-1" }, true),
  ).toMatchObject({
    sharedName: "lookup_policy",
    input: { policyIds: ["policy-1"] },
  });
  expect(
    resolveTenantMcpToolCall("search_policies", { q: "cyber" }, true),
  ).toMatchObject({
    sharedName: "lookup_policy",
    input: { query: "cyber" },
  });
  expect(
    resolveTenantMcpToolCall(
      "list_connected_vendor_policies",
      { vendor_org_id: "org-1" },
      true,
    ),
  ).toMatchObject({
    sharedName: "lookup_vendor_policies",
    input: { vendorOrgId: "org-1" },
  });
});
