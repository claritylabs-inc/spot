/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { PDFDocument } from "pdf-lib";
import { afterEach, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture() {
  const extraction = vi.fn();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const t = convexTest(schema, {
    ...modules,
    "./actions/policyExtraction.ts": async () => ({
      startPolicyExtractionFromUpload: internalAction({
        args: {
          policyId: v.id("policies"),
          fileId: v.id("_storage"),
          fileName: v.optional(v.string()),
          orgId: v.id("organizations"),
          userId: v.id("users"),
          policyFileId: v.optional(v.id("policyFiles")),
        },
        handler: async (_ctx, args) => {
          extraction(args);
        },
      }),
    }),
    "./actions/operatorGoogleWorkspace.ts": async () => ({
      runToolInternal: internalAction({
        args: {
          operatorUserId: v.id("users"),
          threadId: v.id("operatorAgentThreads"),
          toolName: v.string(),
          input: v.any(),
          channel: v.string(),
        },
        handler: async (ctx) => {
          const fileId = await ctx.storage.store(
            new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
          );
          const attachment = {
            fileId,
            filename: "email-policy.pdf",
            contentType: "application/pdf",
            size: bytes.length,
          };
          return { result: attachment, attachments: [attachment] };
        },
      }),
    }),
  });
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const operatorProfileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    return { operatorUserId, operatorProfileId, orgId };
  });
  const threadId = await t
    .withIdentity({ subject: `${ids.operatorUserId}|session` })
    .mutation(api.operatorAgent.createThread, {});
  return { t, ...ids, threadId, extraction, bytes };
}

test("imports company-email PDFs only after exact approval and reuses content without deleting the source", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const retrieved = await f.t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    {
      operatorUserId: f.operatorUserId,
      threadId: f.threadId,
      channel: "chat",
      toolName: "get_company_email_attachment",
      input: {
        mailbox: "staff@example.com",
        messageId: "policy-message",
        attachmentId: "policy-attachment",
      },
      idempotencyKey: "retrieve-policy",
    },
  );
  expect(retrieved.outcome.status).toBe("succeeded");
  const attachments = await f.t.run((ctx) =>
    ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (q) => q.eq("threadId", f.threadId))
      .collect(),
  );
  expect(attachments).toHaveLength(1);
  const invoke = (key: string) =>
    f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      operatorUserId: f.operatorUserId,
      threadId: f.threadId,
      channel: "chat",
      toolName: "import_policy_files",
      input: {
        orgId: f.orgId,
        attachmentFileIds: [attachments[0].fileId],
        mode: "combined",
      },
      idempotencyKey: key,
    });
  for (const key of ["first-import", "repeat-import"]) {
    const proposed = await invoke(key);
    if (
      proposed.outcome.status !== "confirmation_required" ||
      !proposed.outcome.confirmationId
    )
      throw new Error("Missing import confirmation");
    expect(proposed.outcome.summary).toContain("Cove");
    expect(proposed.outcome.summary).toContain("email-policy.pdf");
    expect(proposed.outcome.summary).not.toContain(attachments[0].fileId);
    if (key === "first-import")
      expect(
        await f.t.run((ctx) => ctx.db.query("policies").collect()),
      ).toHaveLength(0);
    await f.t.mutation(internal.operatorAgent.confirmActionInternal, {
      operatorUserId: f.operatorUserId,
      threadId: f.threadId,
      confirmationId: proposed.outcome.confirmationId,
      decision: "approve",
      channel: "chat",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const run = await f.t.query(
      internal.operatorAgent.getRunResultForOperatorInternal,
      { operatorUserId: f.operatorUserId, runId: proposed.runId },
    );
    expect(run.run.status).toBe("completed");
  }
  const policies = await f.t.run((ctx) => ctx.db.query("policies").collect());
  expect(policies).toHaveLength(1);
  expect(policies[0]).toMatchObject({
    orgId: f.orgId,
    fileId: attachments[0].fileId,
    uploadedBySide: "operator",
    uploadedByUserId: f.operatorUserId,
    extractionDataStage: "placeholder",
  });
  expect(f.extraction).toHaveBeenCalledTimes(1);
  expect(
    await f.t.run(async (ctx) =>
      Boolean(await ctx.storage.get(attachments[0].fileId)),
    ),
  ).toBe(true);
});

test("revalidates client-file ownership and availability at approval and refuses unbound attachments", async () => {
  vi.useFakeTimers();
  const f = await fixture();
  const file = await f.t.run(async (ctx) => {
    const fileId = await ctx.storage.store(
      new Blob([new Uint8Array(f.bytes)], { type: "application/pdf" }),
    );
    const now = dayjs().valueOf();
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: f.orgId,
      fileId,
      name: "saved-policy.pdf",
      originalName: "saved-policy.pdf",
      contentType: "application/pdf",
      size: f.bytes.length,
      clientVisible: false,
      nameSource: "original",
      nameStatus: "ready",
      uploadedByUserId: f.operatorUserId,
      uploadedBySide: "operator",
      createdAt: now,
      updatedAt: now,
    });
    return { fileId, clientFileId };
  });
  const base = {
    operatorUserId: f.operatorUserId,
    threadId: f.threadId,
    channel: "chat" as const,
    toolName: "import_policy_files",
  };
  expect(
    (
      await f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        ...base,
        input: {
          orgId: f.orgId,
          attachmentFileIds: [file.fileId],
          mode: "combined",
        },
        idempotencyKey: "unbound",
      })
    ).outcome.status,
  ).toBe("failed");
  const otherOrgId = await f.t.run((ctx) =>
    ctx.db.insert("organizations", { name: "Other", type: "client" }),
  );
  expect(
    (
      await f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        ...base,
        input: {
          orgId: otherOrgId,
          clientFileIds: [file.clientFileId],
          mode: "combined",
        },
        idempotencyKey: "cross-client",
      })
    ).outcome.status,
  ).toBe("failed");
  const proposed = await f.t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    {
      ...base,
      input: {
        orgId: f.orgId,
        clientFileIds: [file.clientFileId],
        mode: "combined",
      },
      idempotencyKey: "saved-file",
    },
  );
  if (
    proposed.outcome.status !== "confirmation_required" ||
    !proposed.outcome.confirmationId
  )
    throw new Error("Missing approval");
  await f.t.run((ctx) =>
    ctx.db.patch(file.clientFileId, { archivedAt: dayjs().valueOf() }),
  );
  await expect(
    f.t.mutation(internal.operatorAgent.confirmActionInternal, {
      operatorUserId: f.operatorUserId,
      threadId: f.threadId,
      confirmationId: proposed.outcome.confirmationId,
      decision: "approve",
      channel: "chat",
    }),
  ).rejects.toThrow(/active file/);
  expect(
    await f.t.run((ctx) => ctx.db.query("policies").collect()),
  ).toHaveLength(0);
  expect(f.extraction).not.toHaveBeenCalled();
  await f.t.run(async (ctx) => {
    const replacement = await ctx.storage.store(new Blob([new Uint8Array([...f.bytes, 99])], { type: "application/pdf" }));
    await ctx.db.patch(file.clientFileId, { archivedAt: undefined, fileId: replacement });
  });
  const approval = { operatorUserId: f.operatorUserId, threadId: f.threadId, confirmationId: proposed.outcome.confirmationId, decision: "approve" as const, channel: "chat" as const };
  await expect(f.t.mutation(internal.operatorAgent.confirmActionInternal, approval)).rejects.toThrow(/sources changed/);
  await f.t.run((ctx) => ctx.db.patch(file.clientFileId, { fileId: file.fileId }));
  await f.t.mutation(internal.operatorAgent.confirmActionInternal, approval);
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.run((ctx) => ctx.db.query("policies").collect())).toHaveLength(1);
  expect(f.extraction).toHaveBeenCalledTimes(1);
});

test.each(["combined", "separate"] as const)(
  "imports portal files in %s mode through the shared operator upload owner",
  async (mode) => {
    vi.useFakeTimers();
    const f = await fixture();
    const source = await f.t.run(async (ctx) => {
      const files = [];
      for (const index of [1, 2]) {
        const bytes = new Uint8Array([...f.bytes, index]);
        const fileId = await ctx.storage.store(
          new Blob([bytes], { type: "application/pdf" }),
        );
        const intentId = await ctx.db.insert("operatorAgentUploadIntents", {
          operatorUserId: f.operatorUserId,
          fileId,
          expiresAt: dayjs().add(1, "hour").valueOf(),
          createdAt: dayjs().valueOf(),
        });
        files.push({
          fileId,
          filename: `policy-${index}.pdf`,
          contentType: "application/pdf",
          size: bytes.length,
          uploadIntentId: intentId,
        });
      }
      return files;
    });
    const operator = f.t.withIdentity({
      subject: `${f.operatorUserId}|session`,
    });
    await operator.mutation(api.operatorAgent.sendMessage, {
      threadId: f.threadId,
      content: "Import these policies",
      attachments: source,
    });
    await operator.mutation(api.operatorAgent.cancelRun, {
      threadId: f.threadId,
    });
    // Convex-test storage URLs are resolved locally for the real PDF merger.
    const blobs = new Map(
      await Promise.all(
        source.map(
          async (file) =>
            await f.t.run(
              async (ctx) =>
                [
                  await ctx.storage.getUrl(file.fileId),
                  await (await ctx.storage.get(file.fileId))!.arrayBuffer(),
                ] as const,
            ),
        ),
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const blob = blobs.get(url);
        return blob ? new Response(blob) : new Response(null, { status: 404 });
      }),
    );
    const proposed = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId: f.threadId,
        channel: "chat",
        toolName: "import_policy_files",
        input: {
          orgId: f.orgId,
          attachmentFileIds: source.map((file) => file.fileId),
          mode,
        },
        idempotencyKey: mode,
      },
    );
    if (
      proposed.outcome.status !== "confirmation_required" ||
      !proposed.outcome.confirmationId
    )
      throw new Error("Missing approval");
    await f.t.mutation(internal.operatorAgent.confirmActionInternal, {
      operatorUserId: f.operatorUserId,
      threadId: f.threadId,
      confirmationId: proposed.outcome.confirmationId,
      decision: "approve",
      channel: "chat",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const policies = await f.t.run((ctx) => ctx.db.query("policies").collect());
    expect(policies).toHaveLength(mode === "combined" ? 1 : 2);
    expect(f.extraction).toHaveBeenCalledTimes(policies.length);
    if (mode === "combined") {
      const buffer = await f.t.run(async (ctx) =>
        (await ctx.storage.get(policies[0].fileId!))!.arrayBuffer(),
      );
      expect((await PDFDocument.load(buffer)).getPageCount()).toBe(2);
    }
    for (const file of source)
      expect(
        await f.t.run(async (ctx) =>
          Boolean(await ctx.storage.get(file.fileId)),
        ),
      ).toBe(true);
    expect(
      await operator.query(api.policies.listForOperator, {
        clientOrgId: f.orgId,
      }),
    ).toHaveLength(policies.length);
  },
);
