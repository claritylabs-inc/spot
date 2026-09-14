/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { PaginationResult } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

test("review candidates paginate beyond 100 with exact organization ownership and operator access", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "operator@example.test",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.test",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
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
      status: "needs_attention",
      nextAttemptAt: 0,
      attempts: 0,
    });
    const organizations = [];
    for (let i = 0; i < 121; i++)
      organizations.push(
        await ctx.db.insert("organizations", {
          name: "Same legal name",
          type: "client",
          primaryContactEmail: `contact${i}@example.test`,
        }),
      );
    const orgId = organizations.at(-1)!;
    const requestIds = [];
    for (let i = 0; i < 121; i++)
      requestIds.push(
        await ctx.db.insert("procurementRequests", {
          clientOrgId: orgId,
          title: `Auto ${i}`,
          narrative: "Synthetic request",
          status: "submitted",
          clientVisible: true,
          inboxToken: `fixture-${i}`,
          createdByUserId: userId,
          updatedByUserId: userId,
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    const brokerId = await ctx.db.insert("organizations", {
      name: "Wrong type",
      type: "broker",
    });
    const tenantId = await ctx.db.insert("users", {
      accountKind: "customer",
      email: "tenant@example.test",
    });
    const operation = {
      kind: "create_request",
      identity: {
        kind: "client",
        name: "Same legal name",
        contactEmail: "contact120@example.test",
        address: null,
      },
      request: { title: "Auto", coverage: "Auto" },
      narrative: "Synthetic request",
      targetEffectiveDate: null,
      effectiveDate: "2026-09-14",
      excerpt: "Synthetic source",
      explanation: "Choose exact client",
    };
    const activityId = await ctx.db.insert("operatorWorkspaceScanFindings", {
      sourceId,
      operationKey: "fixture",
      status: "needs_attention",
      title: "Choose client",
      explanation: "Ambiguous identity",
      excerpt: "Synthetic source",
      operationJson: JSON.stringify(operation),
      recordLinks: [],
      createdAt: 1,
      authorizingOperatorId: userId,
    });
    return {
      userId,
      tenantId,
      activityId,
      organizations,
      orgId,
      requestIds,
      brokerId,
    };
  });
  const operator = t.withIdentity({ subject: `${ids.userId}|session` });
  for (const kind of ["organization", "request"] as const) {
    const found: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: PaginationResult<{ id: string; label: string }> =
        await operator.query(
          api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
          {
            activityId: ids.activityId,
            kind,
            selectedOrgId: ids.orgId,
            paginationOpts: { numItems: 50, cursor },
          },
        );
      expect(page.page.length).toBeLessThanOrEqual(50);
      found.push(...page.page.map((row) => row.id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(found).toEqual(
      kind === "organization" ? ids.organizations : ids.requestIds,
    );
  }
  const args = {
    activityId: ids.activityId,
    kind: "request" as const,
    paginationOpts: { numItems: 50, cursor: null },
  };
  expect(
    (
      await operator.query(
        api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
        args,
      )
    ).page,
  ).toEqual([]);
  await expect(
    operator.query(
      api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
      { ...args, selectedOrgId: ids.brokerId },
    ),
  ).rejects.toThrow("correct type");
  await expect(
    t
      .withIdentity({ subject: `${ids.tenantId}|session` })
      .query(
        api.operatorGoogleWorkspaceScanActivity.listActivityCandidates,
        args,
      ),
  ).rejects.toThrow();
});
