/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { getVisibleInternal, listVisibleInternal } from "./clientFiles";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const getVisibleInternalFn = getVisibleInternal as any;
const listVisibleInternalFn = listVisibleInternal as any;

async function seedClientFileFixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client",
      email: "client@example.com",
      accountKind: "customer",
    });
    const outsiderUserId = await ctx.db.insert("users", {
      name: "Outsider",
      email: "outsider@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const otherOrgId = await ctx.db.insert("organizations", {
      name: "Other Client",
      type: "client",
    });
    await Promise.all([
      ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: clientUserId,
        role: "admin",
      }),
      ctx.db.insert("orgMemberships", {
        orgId: otherOrgId,
        userId: outsiderUserId,
        role: "admin",
      }),
    ]);
    const policyId = await ctx.db.insert("policies", {
      orgId: clientOrgId,
      carrier: "Travelers",
      policyNumber: "COV-100",
      linesOfBusiness: ["Property"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Cove",
      extractionDataStage: "final",
    });
    const otherPolicyId = await ctx.db.insert("policies", {
      orgId: otherOrgId,
      carrier: "Hartford",
      policyNumber: "OTHER-1",
      linesOfBusiness: ["Property"],
      documentType: "policy",
      policyYear: 2026,
      effectiveDate: "01/01/2026",
      expirationDate: "01/01/2027",
      isRenewal: false,
      coverages: [],
      insuredName: "Other Client",
      extractionDataStage: "final",
    });
    return {
      operatorUserId,
      clientUserId,
      outsiderUserId,
      clientOrgId,
      policyId,
      otherPolicyId,
    };
  });
  return { t, ...ids };
}

describe("client files", () => {
  test("agent and MCP reads expose only visible files in the supplied scope", async () => {
    const fixture = await seedClientFileFixture();
    const rows = await fixture.t.run(async (ctx) => {
      const privateStorageId = await ctx.storage.store(new Blob(["private"]));
      const visibleStorageId = await ctx.storage.store(new Blob(["visible"]));
      const base = {
        orgId: fixture.clientOrgId,
        originalName: "document.txt",
        contentType: "text/plain",
        size: 7,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator" as const,
        nameSource: "operator" as const,
        nameStatus: "ready" as const,
        createdAt: 1,
        updatedAt: 1,
      };
      const privateId = await ctx.db.insert("clientFiles", {
        ...base,
        fileId: privateStorageId,
        name: "Private report.txt",
        clientVisible: false,
      });
      const visibleId = await ctx.db.insert("clientFiles", {
        ...base,
        fileId: visibleStorageId,
        name: "Shared report.txt",
        clientVisible: true,
      });
      return { privateId, visibleId };
    });

    const listed = await fixture.t.query(listVisibleInternalFn, {
      orgIds: [fixture.clientOrgId],
      query: "report",
    });
    expect(listed).toMatchObject([
      {
        clientFileId: rows.visibleId,
        orgName: "Cove",
      },
    ]);
    await expect(
      fixture.t.query(getVisibleInternalFn, {
        clientFileId: rows.privateId,
        orgIds: [fixture.clientOrgId],
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.t.query(getVisibleInternalFn, {
        clientFileId: rows.visibleId,
        orgIds: [],
      }),
    ).resolves.toBeNull();
  });

  test("keeps uploads operator-owned and schedules content naming", async () => {
    const fixture = await seedClientFileFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const client = fixture.t.withIdentity({
      subject: `${fixture.clientUserId}|session`,
    });
    const fileId = await fixture.t.run((ctx) =>
      ctx.storage.store(
        new Blob(["Roof inspection report for 123 Main Street"], {
          type: "text/plain",
        }),
      ),
    );

    await expect(
      client.mutation(api.clientFiles.generateUploadUrl, {
        clientOrgId: fixture.clientOrgId,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");

    const upload = await operator.mutation(api.clientFiles.generateUploadUrl, {
      clientOrgId: fixture.clientOrgId,
    });
    const registered = await operator.mutation(api.clientFiles.registerUpload, {
      uploadIntentId: upload.uploadIntentId,
      fileId,
      originalName: "scan-004.txt",
      contentType: "text/plain",
      clientVisible: false,
      policyId: fixture.policyId,
      hint: "Latest roof report",
    });

    await expect(
      fixture.t.run((ctx) => ctx.db.get(registered.clientFileId)),
    ).resolves.toMatchObject({
      name: "scan-004.txt",
      clientVisible: false,
      policyId: fixture.policyId,
      nameSource: "original",
      nameStatus: "pending",
      uploadedBySide: "operator",
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(upload.uploadIntentId)),
    ).resolves.toBeNull();

    const replayFileId = await fixture.t.run((ctx) =>
      ctx.storage.store(
        new Blob(["Roof inspection report for 123 Main Street"], {
          type: "text/plain",
        }),
      ),
    );
    const replayUpload = await operator.mutation(
      api.clientFiles.generateUploadUrl,
      { clientOrgId: fixture.clientOrgId },
    );
    const replay = await operator.mutation(api.clientFiles.registerUpload, {
      uploadIntentId: replayUpload.uploadIntentId,
      fileId: replayFileId,
      originalName: "duplicate-roof-report.txt",
      contentType: "text/plain",
      clientVisible: false,
      policyId: fixture.policyId,
    });
    expect(replay).toEqual({
      clientFileId: registered.clientFileId,
      status: "reused",
    });
    await expect(
      fixture.t.run((ctx) => ctx.storage.get(replayFileId)),
    ).resolves.toBeNull();
    await expect(
      fixture.t.run((ctx) =>
        ctx.db
          .query("clientFiles")
          .withIndex("organization", (query) =>
            query.eq("orgId", fixture.clientOrgId),
          )
          .collect(),
      ),
    ).resolves.toHaveLength(1);
  });

  test("shows private files only to operators and protects their URLs", async () => {
    const fixture = await seedClientFileFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const client = fixture.t.withIdentity({
      subject: `${fixture.clientUserId}|session`,
    });
    const outsider = fixture.t.withIdentity({
      subject: `${fixture.outsiderUserId}|session`,
    });
    const rows = await fixture.t.run(async (ctx) => {
      const privateStorageId = await ctx.storage.store(
        new Blob(["private"], { type: "application/pdf" }),
      );
      const visibleStorageId = await ctx.storage.store(
        new Blob(["visible"], { type: "image/png" }),
      );
      const base = {
        orgId: fixture.clientOrgId,
        originalName: "document.pdf",
        size: 7,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator" as const,
        nameSource: "operator" as const,
        nameStatus: "ready" as const,
        createdAt: 1,
        updatedAt: 1,
      };
      const privateId = await ctx.db.insert("clientFiles", {
        ...base,
        fileId: privateStorageId,
        name: "Private appraisal.pdf",
        contentType: "application/pdf",
        clientVisible: false,
      });
      const visibleId = await ctx.db.insert("clientFiles", {
        ...base,
        fileId: visibleStorageId,
        name: "Shared roof photo.png",
        originalName: "photo.png",
        contentType: "image/png",
        clientVisible: true,
        policyId: fixture.policyId,
      });
      return { privateId, visibleId };
    });

    const operatorList = await operator.query(api.clientFiles.list, {
      clientOrgId: fixture.clientOrgId,
    });
    expect(operatorList.canManage).toBe(true);
    expect(operatorList.files.map((file) => file._id)).toEqual(
      expect.arrayContaining([rows.privateId, rows.visibleId]),
    );

    const clientList = await client.query(api.clientFiles.list, {
      clientOrgId: fixture.clientOrgId,
    });
    expect(clientList.canManage).toBe(false);
    expect(clientList.files).toHaveLength(1);
    expect(clientList.files[0]).toMatchObject({
      _id: rows.visibleId,
      policyLabel: "Travelers · COV-100",
    });
    await expect(
      client.query(api.clientFiles.getUrl, { clientFileId: rows.privateId }),
    ).resolves.toBeNull();
    await expect(
      client.query(api.clientFiles.getUrl, { clientFileId: rows.visibleId }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      outsider.query(api.clientFiles.list, {
        clientOrgId: fixture.clientOrgId,
      }),
    ).rejects.toThrow();
  });

  test("allows operator edits while enforcing same-client policy links", async () => {
    const fixture = await seedClientFileFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const client = fixture.t.withIdentity({
      subject: `${fixture.clientUserId}|session`,
    });
    const clientFileId = await fixture.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["report"]));
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.clientOrgId,
        fileId,
        name: "report.docx",
        originalName: "report.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 6,
        clientVisible: false,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "original",
        nameStatus: "failed",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      client.mutation(api.clientFiles.update, {
        clientFileId,
        clientVisible: true,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(
      operator.mutation(api.clientFiles.update, {
        clientFileId,
        policyId: fixture.otherPolicyId,
      }),
    ).rejects.toThrow("Policy is not an active policy for this client");

    await operator.mutation(api.clientFiles.update, {
      clientFileId,
      name: "Building appraisal",
      clientVisible: true,
      policyId: fixture.policyId,
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(clientFileId)),
    ).resolves.toMatchObject({
      name: "Building appraisal.docx",
      clientVisible: true,
      policyId: fixture.policyId,
      nameSource: "operator",
      nameStatus: "ready",
    });

    await operator.mutation(api.clientFiles.update, {
      clientFileId,
      policyId: null,
    });
    expect(
      (await fixture.t.run((ctx) => ctx.db.get(clientFileId)))?.policyId,
    ).toBeUndefined();
  });

  test("archives and restores files without exposing them to clients", async () => {
    const fixture = await seedClientFileFixture();
    const operator = fixture.t.withIdentity({
      subject: `${fixture.operatorUserId}|session`,
    });
    const client = fixture.t.withIdentity({
      subject: `${fixture.clientUserId}|session`,
    });
    const clientFileId = await fixture.t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["report"]));
      return await ctx.db.insert("clientFiles", {
        orgId: fixture.clientOrgId,
        fileId,
        name: "Shared appraisal.pdf",
        originalName: "appraisal.pdf",
        contentType: "application/pdf",
        size: 6,
        clientVisible: true,
        uploadedByUserId: fixture.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "operator",
        nameStatus: "ready",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      client.mutation(api.clientFiles.setArchived, {
        clientFileId,
        archived: true,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");

    await operator.mutation(api.clientFiles.setArchived, {
      clientFileId,
      archived: true,
    });

    const archivedList = await operator.query(api.clientFiles.list, {
      clientOrgId: fixture.clientOrgId,
      archived: true,
    });
    expect(archivedList.files).toMatchObject([
      { _id: clientFileId, archivedAt: expect.any(Number) },
    ]);
    await expect(
      operator.query(api.clientFiles.list, {
        clientOrgId: fixture.clientOrgId,
      }),
    ).resolves.toMatchObject({ files: [] });
    await expect(
      client.query(api.clientFiles.list, { clientOrgId: fixture.clientOrgId }),
    ).resolves.toMatchObject({ files: [] });
    await expect(
      client.query(api.clientFiles.list, {
        clientOrgId: fixture.clientOrgId,
        archived: true,
      }),
    ).resolves.toMatchObject({ files: [] });
    await expect(
      operator.mutation(api.clientFiles.update, {
        clientFileId,
        name: "Renamed while archived",
      }),
    ).rejects.toThrow("Client file not found");

    await operator.mutation(api.clientFiles.setArchived, {
      clientFileId,
      archived: false,
    });
    const restored = await operator.query(api.clientFiles.list, {
      clientOrgId: fixture.clientOrgId,
    });
    expect(restored.files.map((file) => file._id)).toEqual([clientFileId]);
    await expect(
      operator.query(api.clientFiles.list, {
        clientOrgId: fixture.clientOrgId,
        archived: true,
      }),
    ).resolves.toMatchObject({ files: [] });
    expect(
      (await fixture.t.run((ctx) => ctx.db.get(clientFileId)))?.archivedAt,
    ).toBeUndefined();
  });

});
