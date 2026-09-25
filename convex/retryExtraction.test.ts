/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const retried = vi.hoisted(() => vi.fn());

// The pipeline itself is out of scope; only the authorization gate is tested.
vi.mock("./actions/policyExtraction", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/policyExtraction")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    retryPolicyExtraction: internalAction({
      args: { policyId: v.id("policies"), mode: v.string() },
      handler: async (_ctx, args) => {
        retried(args);
        return { success: true };
      },
    }),
  };
});

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => retried.mockReset());

async function setup(options: {
  uploadedBySide: "client" | "broker" | "operator";
  pipelineStatus?: "complete" | "error" | "running" | "paused";
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client Member",
      email: "member@client.example",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "member",
    });
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const policyId = await ctx.db.insert("policies", {
      orgId: clientOrgId,
      carrier: "Carrier",
      policyNumber: "POL-1",
      linesOfBusiness: [],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Client",
      uploadedBySide: options.uploadedBySide,
      pipelineStatus: options.pipelineStatus ?? "error",
      fileId: await ctx.storage.store(new Blob(["%PDF-1.4"])),
    });
    return { clientOrgId, clientUserId, operatorUserId, policyId };
  });
  const as = (userId: Id<"users">) =>
    t.withIdentity({ subject: `${userId}|session` });
  return { t, as, ...ids };
}

async function auditActions(
  t: ReturnType<typeof convexTest>,
  policyId: Id<"policies">,
) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("policyAuditLog")
        .filter((q) => q.eq(q.field("policyId"), policyId))
        .collect()
    ).map((row) => row.action),
  );
}

describe("retryExtraction", () => {
  test("rejects a client member for a policy their org did not upload", async () => {
    const { t, as, clientUserId, policyId } = await setup({
      uploadedBySide: "broker",
    });
    await expect(
      as(clientUserId).action(api.actions.retryExtraction.retryExtraction, {
        policyId,
      }),
    ).rejects.toThrow("Only policies your organization uploaded");
    expect(retried).not.toHaveBeenCalled();
    expect(await auditActions(t, policyId)).toEqual([]);
  });

  test("rejects an operator while impersonating", async () => {
    const { t, as, operatorUserId, clientOrgId, policyId } = await setup({
      uploadedBySide: "operator",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId,
        targetOrgId: clientOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: 1,
      });
    });
    await expect(
      as(operatorUserId).action(api.actions.retryExtraction.retryExtraction, {
        policyId,
      }),
    ).rejects.toThrow("impersonation is read-only");
    expect(retried).not.toHaveBeenCalled();
  });

  test("rejects while an extraction is already running", async () => {
    const { as, operatorUserId, policyId } = await setup({
      uploadedBySide: "operator",
      pipelineStatus: "paused",
    });
    await expect(
      as(operatorUserId).action(api.actions.retryExtraction.retryExtraction, {
        policyId,
      }),
    ).rejects.toThrow("already running");
    expect(retried).not.toHaveBeenCalled();
  });

  test("lets an operator re-extract and records the operator audit", async () => {
    const { t, as, operatorUserId, policyId } = await setup({
      uploadedBySide: "broker",
      pipelineStatus: "complete",
    });
    await expect(
      as(operatorUserId).action(api.actions.retryExtraction.retryExtraction, {
        policyId,
      }),
    ).resolves.toEqual({ success: true });
    expect(retried).toHaveBeenCalledWith({ policyId, mode: "full" });
    expect(await auditActions(t, policyId)).toEqual([
      "operator_full_extraction",
    ]);
    const operatorAudit = await t.run(async (ctx) =>
      ctx.db.query("operatorAuditEvents").collect(),
    );
    expect(operatorAudit).toEqual([
      expect.objectContaining({
        operatorUserId,
        metadata: expect.objectContaining({
          policyId,
          operation: "full_extraction",
        }),
      }),
    ]);
  });

  test("lets the uploading client member re-extract", async () => {
    const { t, as, clientUserId, policyId } = await setup({
      uploadedBySide: "client",
    });
    await expect(
      as(clientUserId).action(api.actions.retryExtraction.retryExtraction, {
        policyId,
      }),
    ).resolves.toEqual({ success: true });
    expect(retried).toHaveBeenCalledWith({ policyId, mode: "full" });
    expect(await auditActions(t, policyId)).toEqual(["re_extraction"]);
  });
});
