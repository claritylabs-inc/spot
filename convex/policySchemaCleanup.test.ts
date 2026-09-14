/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const cleanupPage = makeFunctionReference<"mutation">("policySchemaCleanup:cleanupPage");
const verifyPage = makeFunctionReference<"query">("policySchemaCleanup:verifyPage");

describe("policy schema cleanup", () => {
  test("preserves the client renewal preference and only removes inert settings", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const clientOrgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const brokerOrgId = await ctx.db.insert("organizations", { name: "Broker", type: "broker" });
      const defaults = {
        brokerOrgId,
        populateHoldersFromEndorsements: false,
        renewalReissueMode: "review_queue" as const,
        renewalReviewLeadDays: 12,
        policyChangeRequestsForHeldCertificatesEnabled: true,
        channels: ["imessage" as const],
        copyInstructions: "Retired copy instructions",
        createdAt: 1,
        updatedAt: 2,
      };
      const client = await ctx.db.insert("certificateWorkflowSettings", {
        ...defaults, clientOrgId, renewalReissueEnabled: false,
      });
      const broker = await ctx.db.insert("certificateWorkflowSettings", {
        ...defaults, renewalReissueEnabled: true,
      });
      return { client, broker, clientOrgId };
    });
    const dry = await t.mutation(cleanupPage, { target: "certificateWorkflowSettings" });
    expect(dry).toMatchObject({ dryRun: true, changed: 2, removed: 1 });
    expect(await t.run((ctx) => ctx.db.get(ids.broker))).not.toBeNull();
    await t.mutation(cleanupPage, { target: "certificateWorkflowSettings", dryRun: false });
    const cleaned = await t.run((ctx) => ctx.db.get(ids.client));
    expect(cleaned).toMatchObject({ clientOrgId: ids.clientOrgId, renewalReissueEnabled: false, createdAt: 1, updatedAt: 2 });
    expect(cleaned).not.toHaveProperty("brokerOrgId");
    expect(cleaned).not.toHaveProperty("channels");
    expect(await t.run((ctx) => ctx.db.get(ids.broker))).toBeNull();
    expect(await t.query(verifyPage, { target: "certificateWorkflowSettings" })).toMatchObject({ remaining: 0, isDone: true });
    expect(await t.mutation(cleanupPage, { target: "certificateWorkflowSettings", dryRun: false })).toMatchObject({ changed: 0 });
  });

  test("removes redundant compatibility chunks in resumable pages while preserving source evidence", async () => {
    const t = convexTest(schema, modules);
    const evidence = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const spanId = await ctx.db.insert("sourceSpans", {
        orgId, spanId: "exact-source", documentId: "policy", sourceKind: "policy_pdf",
        text: "Exact contractual wording", textHash: "source-hash", createdAt: 1,
      });
      const nodeId = await ctx.db.insert("sourceNodes", {
        orgId, nodeId: "section", documentId: "policy", kind: "section", title: "Coverage",
        description: "Coverage wording", sourceSpanIds: ["exact-source"], order: 1, path: "Coverage", createdAt: 1,
      });
      for (let i = 0; i < 3; i += 1) await ctx.db.insert("sourceChunks", {
        orgId, chunkId: `compatibility-${i}`, documentId: "policy", sourceSpanIds: ["exact-source"],
        text: "Redundant compatibility text", createdAt: 1,
      });
      return { spanId, nodeId };
    });
    const first = await t.mutation(cleanupPage, { target: "sourceChunks", limit: 1, dryRun: false });
    expect(first).toMatchObject({ scanned: 1, removed: 1, isDone: false });
    expect(await t.query(verifyPage, { target: "sourceChunks" })).toMatchObject({ remaining: 2 });
    const rest = await t.mutation(cleanupPage, { target: "sourceChunks", cursor: first.continueCursor, dryRun: false });
    expect(rest).toMatchObject({ removed: 2, isDone: true });
    expect(await t.query(verifyPage, { target: "sourceChunks" })).toMatchObject({ remaining: 0, isDone: true });
    expect(await t.run((ctx) => ctx.db.get(evidence.spanId))).toMatchObject({ text: "Exact contractual wording" });
    expect(await t.run((ctx) => ctx.db.get(evidence.nodeId))).toMatchObject({ sourceSpanIds: ["exact-source"] });
  });

  test("preserves extracted policy values and original files while removing dormant reconciliation output", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const fileId = await ctx.storage.store(new Blob(["original policy"], { type: "application/pdf" }));
      const policyId = await ctx.db.insert("policies", {
        orgId, fileId, carrier: "Insurer", policyNumber: "P-1", linesOfBusiness: ["CGL"],
        policyYear: 2026, effectiveDate: "2026-01-01", expirationDate: "2027-01-01",
        isRenewal: false, coverages: [], insuredName: "Client LLC", premiumAmount: 1250,
        reconciliationStatus: "pending", reconciliationLog: [{ timestamp: 1, message: "Old log" }],
        analysis: { retired: true }, operationalProfile: { sourceBacked: true },
      });
      const policyFileId = await ctx.db.insert("policyFiles", {
        orgId, policyId, fileId, fileName: "policy.pdf", fileType: "declaration", createdAt: 1,
        extractedData: { obsolete: true },
      });
      return { policyId, policyFileId, fileId };
    });
    await t.mutation(cleanupPage, { target: "policies", dryRun: false });
    await t.mutation(cleanupPage, { target: "policyFiles", dryRun: false });
    const policy = await t.run((ctx) => ctx.db.get(ids.policyId));
    expect(policy).toMatchObject({ insuredName: "Client LLC", premiumAmount: 1250, operationalProfile: { sourceBacked: true } });
    expect(policy).not.toHaveProperty("reconciliationStatus");
    expect(policy).not.toHaveProperty("reconciliationLog");
    expect(policy).not.toHaveProperty("analysis");
    const file = await t.run((ctx) => ctx.db.get(ids.policyFileId));
    expect(file).toMatchObject({ fileId: ids.fileId, fileName: "policy.pdf" });
    expect(file).not.toHaveProperty("extractedData");
    expect(await t.run(async (ctx) => (await ctx.storage.get(ids.fileId)) !== null)).toBe(true);
  });
});
