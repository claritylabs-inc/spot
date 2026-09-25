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
];

test("tenant MCP catalog preserves external names and projects annotations from access metadata", () => {
  const names = tenantMcpToolNames();
  expect(names).toEqual(expect.arrayContaining(requiredNames));
  expect(new Set(names).size).toBe(names.length);
  const tools = buildTenantMcpToolCatalog();
  expect(tools.map(({ name, annotations }) => ({ name, annotations }))).toMatchSnapshot();
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
  for (const name of ["draft_email", "send_email_draft", "cancel_email_draft", "generate_coi", "save_note"]) {
    expect(() => resolveTenantMcpToolCall(name, {}, false)).toThrow(/write scope/i);
  }
  expect(resolveTenantMcpToolCall("list_policies", {}, false).name).toBe("list_policies");
  expect(() => resolveTenantMcpToolCall("unknown_tool", {}, true)).toThrow(/Unknown tool/);
});

test("preserved aliases map inputs to their shared handler contracts", () => {
  expect(resolveTenantMcpToolCall("list_policies", { carrier: "Acme", type: "CGL" }, true)).toMatchObject({
    name: "list_policies",
    sharedName: "lookup_policy",
    input: { carrier: "Acme", lineOfBusiness: "CGL" },
  });
  expect(resolveTenantMcpToolCall("get_policy", { id: "policy-1" }, true)).toMatchObject({
    sharedName: "lookup_policy",
    input: { policyIds: ["policy-1"] },
  });
  expect(resolveTenantMcpToolCall("search_policies", { q: "cyber" }, true)).toMatchObject({
    sharedName: "lookup_policy",
    input: { query: "cyber" },
  });
  expect(resolveTenantMcpToolCall("list_connected_vendor_policies", { vendor_org_id: "org-1" }, true)).toMatchObject({
    sharedName: "lookup_vendor_policies",
    input: { vendorOrgId: "org-1" },
  });
});
