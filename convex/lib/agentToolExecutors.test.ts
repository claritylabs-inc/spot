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
