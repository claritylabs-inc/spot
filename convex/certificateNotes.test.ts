/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseMarkdownDocument } from "./lib/markdownDocument";
import { readHolderNotes, readRequirementNotes, readWorkflowNotes, saveHolderNotes, saveRequirementNotes, saveWorkflowNotes } from "./certificateNotes";
import { upsertCertificateHolder } from "./certificateHolders";

const modules = import.meta.glob("./**/*.ts");

describe("certificate note documents", () => {
  test("keeps source notes separate from holder notes and preserves ordered holder associations", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const userId = await ctx.db.insert("users", { accountKind: "customer" });
      const manager = await ctx.db.insert("certificateHolders", { orgId, displayName: "Manager", normalizedName: "manager", createdAt: 1, updatedAt: 1 });
      const owner = await ctx.db.insert("certificateHolders", { orgId, displayName: "Owner", normalizedName: "owner", createdAt: 1, updatedAt: 1 });
      const sourceId = await ctx.db.insert("requirementSourceDocuments", {
        orgId, title: "Lease", sourceType: "lease_agreement", status: "complete", certificateHolderIds: [manager, owner],
        createdByUserId: userId, createdAt: 1, updatedAt: 1,
      });
      const source = (await ctx.db.get(sourceId))!;
      const ownerHolder = (await ctx.db.get(owner))!;
      await saveRequirementNotes(ctx, source, "## Delivery\n\nDeliver through the property manager.", { actorUserId: userId });
      await saveHolderNotes(ctx, ownerHolder, "Keep the owner contact separate.", { actorUserId: userId });
      expect(await readRequirementNotes(ctx, source)).toBe("## Delivery\n\nDeliver through the property manager.");
      expect(await readHolderNotes(ctx, ownerHolder)).toBe("Keep the owner contact separate.");
      expect(await readHolderNotes(ctx, (await ctx.db.get(manager))!)).toBeUndefined();
      expect((await ctx.db.get(sourceId))?.certificateHolderIds).toEqual([manager, owner]);
      const documents = await ctx.db.query("markdownDocuments").collect();
      expect(documents.map((document) => document.kind).sort()).toEqual(["holder_notes", "requirement_notes"]);
      expect(documents.every((document) => document.filename.endsWith(".md") && parseMarkdownDocument(document.markdown).frontmatter.visibility === "shared")).toBe(true);
    });
  });

  test("retains arbitrary Markdown headings independently in review and delivery notes", async () => {
    const t = convexTest(schema, modules);
    const { jobId, sendNotes } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const policyId = await ctx.db.insert("policies", {
        orgId, carrier: "Carrier", policyNumber: "P-1", linesOfBusiness: ["CGL"], policyYear: 2026,
        effectiveDate: "2026-01-01", expirationDate: "2027-01-01", isRenewal: false, coverages: [], insuredName: "Client",
      });
      const holderId = await ctx.db.insert("certificateHolders", {
        orgId, displayName: "Holder", normalizedName: "holder", createdAt: 1, updatedAt: 1,
      });
      const certificateId = await ctx.db.insert("policyCertificates", {
        orgId, policyId, holderId, status: "active", dedupeKey: "fixture", createdAt: 1, updatedAt: 1,
      });
      const sendNotes = "## Delivery\n\nOriginal delivery note.\n\n## Other detail\n\nKeep this too.";
      const jobId = await ctx.db.insert("certificateWorkflowJobs", {
        orgId, policyId, holderId, certificateId, kind: "renewal_reissue", status: "sent", idempotencyKey: "fixture",
        createdAt: 1, updatedAt: 1,
      });
      const job = (await ctx.db.get(jobId))!;
      await saveWorkflowNotes(ctx, job, { reviewNotes: "Newer operator review", sendNotes });
      return { jobId, sendNotes };
    });
    const notes = await t.run(async (ctx) => readWorkflowNotes(ctx, (await ctx.db.get(jobId))!, true));
    expect(notes.sendNotes).toBe(sendNotes);
    expect(notes.reviewNotes).toBe("Newer operator review");
  });

  test("automatic holder refresh preserves human notes when no replacement was supplied", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
      const holderId = await upsertCertificateHolder(ctx, { orgId, displayName: "Holder", source: "manual" });
      await saveHolderNotes(ctx, (await ctx.db.get(holderId))!, "Only use the verified contact.");
      const refreshedId = await upsertCertificateHolder(ctx, { orgId, displayName: "Holder", source: "extraction" });
      return { holderId, refreshedId, notes: await readHolderNotes(ctx, (await ctx.db.get(holderId))!, true) };
    });
    expect(result.refreshedId).toBe(result.holderId);
    expect(result.notes).toBe("Only use the verified contact.");
  });
});

test("private note files stay out of tenant DTOs and tenant edits cannot overwrite them", async () => {
  const t = convexTest(schema, modules);
  const { orgId, userId, sourceId, holderId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const userId = await ctx.db.insert("users", { accountKind: "customer" });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    const holderId = await ctx.db.insert("certificateHolders", { orgId, displayName: "Holder", normalizedName: "holder", createdAt: 1, updatedAt: 1 });
    const sourceId = await ctx.db.insert("requirementSourceDocuments", { orgId, title: "Lease", sourceType: "lease_agreement", status: "complete", createdByUserId: userId, createdAt: 1, updatedAt: 1 });
    const policyId = await ctx.db.insert("policies", { orgId, carrier: "Carrier", policyNumber: "P-1", linesOfBusiness: ["CGL"], policyYear: 2026, effectiveDate: "2026-01-01", expirationDate: "2027-01-01", isRenewal: false, coverages: [], insuredName: "Client" });
    const certificateId = await ctx.db.insert("policyCertificates", { orgId, policyId, holderId, status: "active", dedupeKey: "fixture", createdAt: 1, updatedAt: 1 });
    const jobId = await ctx.db.insert("certificateWorkflowJobs", { orgId, policyId, holderId, certificateId, kind: "manual_review", status: "review_required", idempotencyKey: "fixture", createdAt: 1, updatedAt: 1 });
    await saveWorkflowNotes(ctx, (await ctx.db.get(jobId))!, { reviewNotes: "Operator review", sendNotes: "Private delivery draft" });
    await saveHolderNotes(ctx, (await ctx.db.get(holderId))!, "Operator holder note");
    await saveRequirementNotes(ctx, (await ctx.db.get(sourceId))!, "---\nvisibility: private\ncustom: preserved\n---\nOperator source note");
    return { orgId, userId, sourceId, holderId };
  });
  const tenant = t.withIdentity({ subject: `${userId}|session` });
  expect((await tenant.query(api.certificateHolders.listForOrg, { orgId }))[0].notes).toBeUndefined();
  const visibleJob = (await tenant.query(api.certificateWorkflowJobs.listForOrg, { orgId }))[0];
  expect(visibleJob.reviewNotes).toBeUndefined();
  expect(visibleJob.sendNotes).toBeUndefined();
  expect((await tenant.query(api.compliance.listRequirementSources, { orgId }))[0].internalNotes).toBeUndefined();
  await expect(tenant.mutation(api.compliance.updateRequirementSource, { orgId, sourceDocumentId: sourceId, internalNotes: "Overwrite private text" })).rejects.toThrow("Private notes");
  await t.run(async (ctx) => {
    await saveRequirementNotes(ctx, (await ctx.db.get(sourceId))!, "---\nvisibility: shared\ncustom: preserved\n---\nShared source note");
    expect(await readHolderNotes(ctx, (await ctx.db.get(holderId))!, true)).toBe("Operator holder note");
  });
  expect((await tenant.query(api.compliance.listRequirementSources, { orgId }))[0].internalNotes).toBe("Shared source note");
  await tenant.mutation(api.compliance.updateRequirementSource, { orgId, sourceDocumentId: sourceId, internalNotes: "Tenant revision" });
  await expect(tenant.mutation(api.compliance.updateRequirementSource, { orgId, sourceDocumentId: sourceId, internalNotes: "---\nvisibility: private\n---\nHidden revision" })).rejects.toThrow("Private notes");
  await t.run(async (ctx) => {
    const documents = await ctx.db.query("markdownDocuments").collect();
    const document = documents.find((row) => row.requirementSourceDocumentId === sourceId)!;
    expect(parseMarkdownDocument(document.markdown)).toEqual({ frontmatter: { title: "Lease notes", custom: "preserved", visibility: "shared" }, body: "Tenant revision" });
  });
});
