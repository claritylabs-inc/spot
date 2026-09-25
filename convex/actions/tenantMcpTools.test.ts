import { expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  toCertificateDto,
  toCertificateHolderDto,
  toCertificateVersionDto,
  toMcpMyPolicyDto,
  toPolicyStatsDto,
  toPolicyVersionDto,
} from "../lib/apiDto";
import { executeTenantMcpTool } from "./tenantMcpTools";

const orgId = "org-1" as Id<"organizations">;
const userId = "user-1" as Id<"users">;
const policy = {
  _id: "policy-1",
  orgId,
  carrier: "Acme",
  policyNumber: "P-1",
  policyYear: 2026,
  policyTypes: ["CGL"],
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  pipelineStatus: "complete",
  insuredName: "Cove",
  isRenewal: false,
  coverages: [],
};
const holder = {
  _id: "holder-1",
  orgId,
  displayName: "Holder",
  createdAt: 1,
  updatedAt: 1,
};
const certificate = {
  _id: "certificate-1",
  policyId: "policy-1",
  fileId: "file-1",
  fileName: "coi.pdf",
  createdAt: 1,
  url: "https://example.test/coi.pdf",
};
const certificateVersion = {
  _id: "version-1",
  orgId,
  certificateId: "parent-1",
  policyId: "policy-1",
  holderId: "holder-1",
  versionNumber: 1,
  status: "issued",
  createdAt: 1,
  updatedAt: 1,
  holder,
};
const policyVersion = {
  _id: "policy-version-1",
  orgId,
  policyId: "policy-1",
  versionNumber: 1,
  versionKind: "renewal",
  createdAt: 1,
};
const file = {
  clientFileId: "client-file-1",
  name: "lease.pdf",
  fileId: "file-1",
};
const wiki = {
  orgId,
  filename: "company-wiki.md",
  revision: 2,
  markdown: "# Company",
  body: "# Company",
};
const requirement = {
  _id: "requirement-1",
  orgId,
  kind: "coverage",
  scope: "own_org",
  title: "CGL",
};

function context() {
  const runQuery = vi.fn(async (ref, args) => {
    switch (getFunctionName(ref)) {
      case "lib/agentScope:resolveForAction":
        return {
          mode: "client",
          surface: "mcp",
          primaryOrgId: orgId,
          readOrgIds: [orgId],
          writableOrgIds: [orgId],
          brokerInternal: false,
          orgs: [
            {
              orgId,
              name: "Cove",
              type: "client",
              isPrimary: true,
              canWrite: true,
            },
          ],
        };
      case "policies:listAllPreviewReadableInternal":
        return [policy];
      case "orgs:getInternal":
        return { _id: orgId, name: "Cove", website: "https://cove.test" };
      case "orgWiki:getForMcp":
        return wiki;
      case "clientFiles:listVisibleInternal":
        return [file];
      case "clientFiles:getVisibleInternal":
        return file;
      case "compliance:listRequirementsInternal":
        return [requirement];
      case "certificates:listByPolicyInternal":
        return [certificate];
      case "certificateHolders:listForOrgInternal":
        return [holder];
      case "certificateLifecycle:listVersionsInternal":
        return [certificateVersion];
      case "policyVersions:listForOrgInternal":
        return [policyVersion];
      default:
        throw new Error(
          `Unexpected query ${getFunctionName(ref)} ${JSON.stringify(args)}`,
        );
    }
  });
  const runMutation = vi.fn(async (ref) =>
    getFunctionName(ref) === "orgWiki:saveForMcp" ? wiki : "requirement-1",
  );
  const runAction = vi.fn(async () => ({
    results: [{ status: "generated", fileId: "file-1" }],
    gaps: [],
  }));
  return {
    ctx: { runQuery, runMutation, runAction } as unknown as ActionCtx,
    runQuery,
    runMutation,
    runAction,
  };
}

test("deprecated read names return their former DTO shapes", async () => {
  const { ctx } = context();
  const call = (name: string, input: Record<string, unknown> = {}) =>
    executeTenantMcpTool(ctx, { orgId, userId, name, input, canWrite: false });
  expect(await call("list_my_policies")).toEqual([toMcpMyPolicyDto(policy)]);
  expect(await call("get_policy_stats")).toEqual(toPolicyStatsDto([policy]));
  expect(await call("get_org_info")).toEqual({
    _id: orgId,
    name: "Cove",
    website: "https://cove.test",
  });
  expect(await call("read_company_wiki")).toEqual(wiki);
  expect(await call("list_client_files")).toEqual([file]);
  await expect(
    call("list_client_files", { client_org_id: "org-other" }),
  ).rejects.toThrow(/readable scope/);
  expect(
    await call("get_client_file", { client_file_id: "client-file-1" }),
  ).toEqual(file);
  expect(await call("list_insurance_requirements")).toEqual([requirement]);
  expect(
    await call("list_policy_certificates", { policyId: "policy-1" }),
  ).toEqual([toCertificateDto(certificate)]);
  expect(await call("list_certificate_holders")).toEqual([
    toCertificateHolderDto(holder),
  ]);
  expect(await call("list_certificate_versions")).toEqual([
    toCertificateVersionDto(certificateVersion),
  ]);
  expect(await call("list_policy_versions")).toEqual([
    toPolicyVersionDto(policyVersion),
  ]);
});

test("deprecated write names preserve results and reject read-only tokens", async () => {
  const { ctx, runMutation, runAction } = context();
  const wikiInput = { markdown: "# Company", expected_revision: 2 };
  const requirementInput = {
    kind: "coverage",
    scope: "own_org",
    title: "CGL",
    requirement_text: "Carry CGL",
    line_of_business: "CGL",
    limits: [{ kind: "per_occurrence", amount: 1000000 }],
  };
  const certificateInput = {
    policy_id: "policy-1",
    certificate_holder: "Holder",
  };
  for (const [name, input] of [
    ["write_company_wiki", wikiInput],
    ["create_insurance_requirement", requirementInput],
    ["generate_policy_certificate", certificateInput],
  ] as const) {
    await expect(
      executeTenantMcpTool(ctx, {
        orgId,
        userId,
        name,
        input,
        canWrite: false,
      }),
    ).rejects.toThrow(/write scope/i);
  }
  expect(runMutation).not.toHaveBeenCalled();
  expect(runAction).not.toHaveBeenCalled();
  expect(
    await executeTenantMcpTool(ctx, {
      orgId,
      userId,
      name: "write_company_wiki",
      input: wikiInput,
      canWrite: true,
    }),
  ).toEqual(wiki);
  expect(
    await executeTenantMcpTool(ctx, {
      orgId,
      userId,
      name: "create_insurance_requirement",
      input: requirementInput,
      canWrite: true,
    }),
  ).toEqual({ requirementId: "requirement-1" });
  expect(
    await executeTenantMcpTool(ctx, {
      orgId,
      userId,
      name: "generate_policy_certificate",
      input: certificateInput,
      canWrite: true,
    }),
  ).toEqual({ status: "generated", fileId: "file-1" });
  expect(runMutation).toHaveBeenCalledTimes(2);
  expect(runAction).toHaveBeenCalledTimes(1);
});

test("direct email projections reject read-only MCP tokens before reaching execution", async () => {
  const { ctx, runQuery, runMutation, runAction } = context();
  for (const name of [
    "draft_email",
    "update_email_draft",
    "send_email_draft",
    "send_email_drafts",
    "cancel_email_draft",
  ]) {
    await expect(
      executeTenantMcpTool(ctx, {
        orgId,
        userId,
        name,
        input: { draftId: "draft-1" },
        canWrite: false,
      }),
    ).rejects.toThrow(/write scope/i);
  }
  expect(runQuery).not.toHaveBeenCalled();
  expect(runMutation).not.toHaveBeenCalled();
  expect(runAction).not.toHaveBeenCalled();
});
