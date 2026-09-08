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
