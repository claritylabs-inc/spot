/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

test("scheduled policy extraction stays in portal while interactive extraction retains notifications", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Synthetic client",
      type: "client",
    });
    const fileId = await ctx.storage.store(new Blob(["synthetic fixture"]));
    const fields = {
      orgId,
      fileId,
      documentType: "policy" as const,
      carrier: "Synthetic insurer",
      policyNumber: "FIXTURE",
      linesOfBusiness: ["CA"],
      policyYear: 2026,
      effectiveDate: "2026-01-01",
      expirationDate: "2027-01-01",
      isRenewal: false,
      coverages: [],
      insuredName: "Synthetic client",
    };
    const scanned = await ctx.db.insert("policies", fields);
    const interactive = await ctx.db.insert("policies", fields);
    const runId = await ctx.db.insert("operatorGoogleWorkspaceScanRuns", {
      authorizationRevision: 1,
      phase: "completed",
      startedAt: 1,
      windowStartAt: 1,
      directoryComplete: true,
      discoveredMailboxes: 1,
      completedMailboxes: 1,
      failedMailboxes: 0,
      collectedMessages: 1,
      pendingSources: 0,
      reconciledSources: 1,
      failedSources: 0,
      nextAttemptAt: 0,
      attempts: 0,
    });
    const mailboxId = await ctx.db.insert(
      "operatorGoogleWorkspaceScanMailboxes",
      {
        mailbox: "fixture@example.test",
        runId,
        authorizationRevision: 1,
        phase: "completed",
        status: "completed",
        windowStartAt: 1,
        collectedMessages: 1,
        nextAttemptAt: 0,
        attempts: 0,
      },
    );
    const sourceId = await ctx.db.insert("operatorGoogleWorkspaceScanSources", {
      mailbox: "fixture@example.test",
      messageId: "fixture",
      threadId: "fixture",
      mailboxId,
      runId,
      authorizationRevision: 1,
      status: "completed",
      nextAttemptAt: 0,
      attempts: 0,
    });
    const importId = await ctx.db.insert("operatorWorkspaceScanImports", {
      sourceId,
      attachmentId: "part:1",
      clientOrgId: orgId,
      file: {
        fileId,
        fileName: "fixture.pdf",
        fileSha256: "a".repeat(64),
        size: 17,
      },
      boundPolicy: true,
      policyId: scanned,
      createdAt: 1,
    });
    await ctx.db.insert("operatorWorkspaceScanImports", {
      sourceId,
      attachmentId: "part:2",
      clientOrgId: orgId,
      file: {
        fileId,
        fileName: "duplicate.pdf",
        fileSha256: "b".repeat(64),
        size: 17,
      },
      boundPolicy: true,
      policyId: interactive,
      createdAt: 1,
    });
    return { scanned, interactive, importId };
  });
  expect(
    await t.mutation(internal.lib.notify.notifyPolicyExtractionReviewInternal, {
      policyId: ids.scanned,
      questionCount: 2,
      workspaceScanImportId: ids.importId,
    }),
  ).toBe(false);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("notifications").collect()).toEqual([]);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toEqual(
      [],
    );
  });
  expect(
    await t.mutation(internal.lib.notify.notifyPolicyExtractionReviewInternal, {
      policyId: ids.interactive,
      questionCount: 2,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.lib.notify.notifyPolicyExtractionReviewInternal, {
      policyId: ids.scanned,
      questionCount: 1,
    }),
  ).toBe(true);
  const notifications = await t.run((ctx) =>
    ctx.db.query("notifications").collect(),
  );
  expect(notifications).toHaveLength(2);
  expect(notifications).toMatchObject([
    {
      type: "incomplete_extraction",
      actionPayload: { policyId: ids.interactive },
    },
    { type: "incomplete_extraction", actionPayload: { policyId: ids.scanned } },
  ]);
});

test("full manual re-extraction clears scheduled origin while recovery retains its invocation", async () => {
  const { policyExtractionRetrySource } =
    await import("./actions/policyExtraction");
  const sourceId = "fixture-org";
  const existingState = {
    sourceKind: "upload" as const,
    orgId: sourceId,
    userId: "operator",
    fileId: "fixture-file",
    workspaceScanImportId:
      "fixture-import" as import("./_generated/dataModel").Id<"operatorWorkspaceScanImports">,
  };
  for (const mode of ["resume", "restart"] as const) {
    expect(
      policyExtractionRetrySource({ mode, policy: {}, existingState })
        .workspaceScanImportId,
    ).toBe(existingState.workspaceScanImportId);
  }
  expect(
    policyExtractionRetrySource({
      mode: "full",
      policy: { orgId: sourceId },
      existingState,
    }).workspaceScanImportId,
  ).toBeUndefined();
});
