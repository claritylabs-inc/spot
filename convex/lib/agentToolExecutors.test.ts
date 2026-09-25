import { expect, test, vi } from "vitest";
import dayjs from "dayjs";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildAgentToolExecutors } from "./agentToolExecutors";

test("exact policy lookup treats null filters as omitted and still honors a real expiry window", async () => {
  const orgId = "org-cove" as Id<"organizations">;
  const policyId = "policy-cove" as Id<"policies">;
  const policies = [
    {
      _id: policyId,
      orgId,
      policyNumber: "QA-POLICY-1",
      expirationDate: dayjs().add(90, "day").format("YYYY-MM-DD"),
      extractionDataStage: "final",
      pipelineStatus: "complete",
    },
  ];
  const runQuery = vi.fn(async (ref, args) => {
    expect(args.orgId ?? args.id).toBe(orgId);
    return getFunctionName(ref).startsWith("policies:")
      ? policies
      : { name: "Cove" };
  });
  const tool = buildAgentToolExecutors({ runQuery } as unknown as ActionCtx, {
    surface: "imessage",
    orgId,
    userId: "operator" as Id<"users">,
    scope: {
      mode: "client",
      surface: "imessage",
      primaryOrgId: orgId,
      readOrgIds: [orgId],
      writableOrgIds: [],
      brokerInternal: false,
      orgs: [
        {
          orgId,
          name: "Cove",
          type: "client",
          isPrimary: true,
          canWrite: false,
        },
      ],
    },
  }).lookup_policy;
  const input = {
    policyIds: [policyId],
    query: null,
    expiringWithinDays: null,
    lineOfBusiness: null,
    policyType: null,
    carrier: null,
  };
  const omitted = await tool.execute({ policyIds: [policyId] });
  expect(await tool.execute(input)).toEqual(omitted);
  expect(omitted).toEqual([
    expect.objectContaining({ id: policyId, number: "QA-POLICY-1" }),
  ]);
  expect(await tool.execute({ ...input, expiringWithinDays: 30 })).toContain(
    "No policies matched",
  );
  expect(await tool.execute({ ...input, expiringWithinDays: 120 })).toEqual(
    omitted,
  );
});

test("requirements expose saved compliance findings without inferring compliance from limits", async () => {
  const orgId = "org-cove" as Id<"organizations">;
  const runQuery = vi.fn(async (ref, args) => {
    expect(getFunctionName(ref)).toBe("compliance:listRequirementsInternal");
    expect(args).toEqual({ orgId });
    return [
      {
        _id: "requirement-a",
        title: "Occurrence limit",
        scope: "own_org",
        requirementText: "Carry occurrence coverage",
        limits: [{ kind: "per_occurrence", amount: 1_000_000 }],
        complianceCheck: {
          status: "not_met",
          reasons: ["Missing occurrence evidence"],
          matchedPolicyIds: ["policy-a"],
        },
        privateInternalValue: "must not be returned",
      },
      {
        _id: "requirement-b",
        title: "Waiver",
        scope: "own_org",
        requirementText: "Waiver required",
      },
    ];
  });
  const tools = buildAgentToolExecutors({ runQuery } as unknown as ActionCtx, {
    surface: "web",
    orgId,
    userId: "client" as Id<"users">,
    scope: {
      mode: "client",
      surface: "web",
      primaryOrgId: orgId,
      readOrgIds: [orgId],
      writableOrgIds: [],
      brokerInternal: false,
      orgs: [
        {
          orgId,
          name: "Cove",
          type: "client",
          isPrimary: true,
          canWrite: false,
        },
      ],
    },
  });
  const result = await tools.lookup_compliance_requirements.execute({});
  expect(result.requirements).toEqual([
    expect.objectContaining({
      requirementId: "requirement-a",
      currentComplianceStatus: "not_met",
      currentComplianceReasons: ["Missing occurrence evidence"],
      matchedPolicyIds: ["policy-a"],
    }),
    expect.objectContaining({
      requirementId: "requirement-b",
      currentComplianceStatus: "unverified",
      currentComplianceReasons: [],
    }),
  ]);
  expect(JSON.stringify(result)).not.toContain("must not be returned");
});

test("certificate and policy history tools keep results inside the readable organization", async () => {
  const orgId = "org-cove" as Id<"organizations">;
  const runQuery = vi.fn(async (ref, args) => {
    expect(args.orgId).toBe(orgId);
    if (getFunctionName(ref) === "certificateLifecycle:listVersionsInternal") {
      return [
        {
          _id: "version-1",
          orgId,
          policyId: "policy-1",
          certificateId: "certificate-1",
          holderId: "holder-1",
          versionNumber: 2,
          status: "issued",
          fileId: "file-1",
          createdAt: 10,
          updatedAt: 10,
          holder: {
            _id: "holder-1",
            orgId,
            displayName: "Acme",
            email: "holder@example.com",
            createdAt: 1,
            updatedAt: 1,
          },
          url: "https://example.test/certificate.pdf",
        },
      ];
    }
    if (getFunctionName(ref) === "policyVersions:listForOrgInternal") {
      return [
        {
          _id: "policy-version-1",
          orgId,
          policyId: "policy-1",
          versionNumber: 2,
          versionKind: "renewal",
          createdAt: 5,
        },
      ];
    }
    throw new Error("Unexpected query");
  });
  const tools = buildAgentToolExecutors({ runQuery } as unknown as ActionCtx, {
    surface: "mcp",
    orgId,
    userId: "user-1" as Id<"users">,
    scope: {
      mode: "client",
      surface: "mcp",
      primaryOrgId: orgId,
      readOrgIds: [orgId],
      writableOrgIds: [],
      brokerInternal: false,
      orgs: [
        {
          orgId,
          name: "Cove",
          type: "client",
          isPrimary: true,
          canWrite: false,
        },
      ],
    },
  });
  const certificates = await tools.list_certificates.execute({
    policyId: "policy-1",
    holderQuery: "acme",
  });
  expect(certificates.certificates).toEqual([
    expect.objectContaining({
      id: "version-1",
      policy_id: "policy-1",
      holder: expect.objectContaining({ display_name: "Acme" }),
      version_number: 2,
    }),
  ]);
  expect(
    (await tools.list_certificates.execute({ holderQuery: "unrelated" }))
      .certificates,
  ).toEqual([]);
  expect(
    await tools.list_policy_versions.execute({ policyId: "policy-1" }),
  ).toEqual([
    expect.objectContaining({
      id: "policy-version-1",
      version_kind: "renewal",
    }),
  ]);
});

test("new write tools require capability and explicit text-channel confirmation", async () => {
  const orgId = "org-cove" as Id<"organizations">;
  const userId = "user-1" as Id<"users">;
  const runMutation = vi.fn(async (ref) =>
    getFunctionName(ref) === "orgWiki:saveForMcp"
      ? { revision: 3, markdown: "# Cove" }
      : "requirement-1",
  );
  const create = (
    canWrite: boolean,
    surface: "web" | "email" | "slack" | "imessage" = "web",
  ) =>
    buildAgentToolExecutors({ runMutation } as unknown as ActionCtx, {
      surface,
      orgId,
      userId,
      canWrite,
      scope: {
        mode: "client",
        surface,
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
      },
    });
  const wiki = { markdown: "# Cove", expectedRevision: 2 };
  const requirement = {
    kind: "coverage" as const,
    scope: "own_org" as const,
    title: "CGL",
    requirementText: "Carry liability",
    lineOfBusiness: "CGL",
    limits: [{ kind: "per_occurrence", amount: 1000000 }],
  };
  expect(
    await create(false).update_company_wiki.execute({
      ...wiki,
      confirmed: true,
    }),
  ).toMatch(/permission/);
  expect(
    await create(false).create_compliance_requirement.execute({
      ...requirement,
      confirmed: true,
    }),
  ).toMatch(/permission/);
  for (const surface of ["web", "email", "slack", "imessage"] as const) {
    expect(
      await create(true, surface).update_company_wiki.execute(wiki),
    ).toMatch(/confirm/);
    expect(
      await create(true, surface).create_compliance_requirement.execute(
        requirement,
      ),
    ).toMatch(/confirm/);
  }
  expect(
    await create(true).update_company_wiki.execute({
      ...wiki,
      orgId: "org-other",
      confirmed: true,
    }),
  ).toMatch(/permission/);
  expect(runMutation).not.toHaveBeenCalled();
  expect(
    await create(true).update_company_wiki.execute({
      ...wiki,
      confirmed: true,
    }),
  ).toMatchObject({ revision: 3 });
  expect(
    await create(true).create_compliance_requirement.execute({
      ...requirement,
      confirmed: true,
    }),
  ).toEqual({ requirementId: "requirement-1" });
  expect(runMutation).toHaveBeenCalledTimes(2);
});
