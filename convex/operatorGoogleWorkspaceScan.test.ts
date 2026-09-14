/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { GoogleWorkspaceProviderError } from "./lib/googleWorkspaceProvider";
import { googleWorkspaceScanBodyFingerprint } from "./lib/googleWorkspaceScan";
import { api, internal } from "./_generated/api";
import {
  assertGoogleWorkspaceScanSourceLease,
  retryGoogleWorkspaceScanSource,
} from "./lib/googleWorkspaceScanState";
import type {
  GoogleWorkspaceScanSettingsInput,
  GoogleWorkspaceScanStatus,
} from "./lib/googleWorkspaceScan";

const providerMock = vi.hoisted(() => ({
  listDirectoryUsers: vi.fn(),
  getDirectoryUser: vi.fn(),
  getHistoryCheckpoint: vi.fn(),
  listMessages: vi.fn(),
  listHistory: vi.fn(),
  getMessageFull: vi.fn(),
  getAttachment: vi.fn(),
}));
vi.mock("./lib/googleWorkspaceProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./lib/googleWorkspaceProvider")>();
  return { ...original, createGoogleWorkspaceProvider: () => providerMock };
});
const modules = import.meta.glob("./**/*.ts");
const settings = makeFunctionReference<
  "mutation",
  GoogleWorkspaceScanSettingsInput,
  null
>("operatorGoogleWorkspaceScan:updateSettings");
const status = makeFunctionReference<
  "query",
  Record<string, never>,
  GoogleWorkspaceScanStatus
>("operatorGoogleWorkspaceScan:getStatus");
const dispatch = makeFunctionReference<"mutation", Record<string, never>, null>(
  "operatorGoogleWorkspaceScan:dispatchInternal",
);
async function fixture() {
  vi.stubEnv(
    "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      type: "service_account",
      client_email: "reader@example.iam.gserviceaccount.com",
      client_id: "123",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
    }),
  );
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "operator@example.com",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: id,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return id;
  });
  const operator = t.withIdentity({ subject: `${userId}|session` });
  await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
    enabled: true,
    mailboxMode: "directory",
    mailboxes: [],
    directoryAdminEmail: "admin@example.com",
  });
  return { t, operator, userId };
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  Object.values(providerMock).forEach((mock) => mock.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Workspace scan standing authorization", () => {
  it("defaults off, requires Directory, and leaves live-search revisions untouched on cadence edits", async () => {
    const { operator } = await fixture();
    expect((await operator.query(status, {})).config.enabled).toBe(false);
    const connector = await operator.query(
      api.operatorGoogleWorkspace.getStatus,
      {},
    );
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const first = await operator.query(status, {});
    await operator.mutation(settings, { enabled: true, intervalMinutes: 15 });
    const second = await operator.query(status, {});
    expect(second.config.authorizationRevision).toBe(
      first.config.authorizationRevision,
    );
    expect(second.latestRun?.id).toBe(first.latestRun?.id);
    expect(
      (await operator.query(api.operatorGoogleWorkspace.getStatus, {})).config
        ?.updatedAt,
    ).toBe(connector.config?.updatedAt);
    await operator.mutation(settings, { enabled: false, intervalMinutes: 15 });
    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["mail@example.com"],
    });
    await expect(
      operator.mutation(settings, { enabled: true, intervalMinutes: 60 }),
    ).rejects.toThrow("Directory");
  });
  it("preserves the initial window across pause and re-enable and rejects tenant settings access", async () => {
    const { operator, t } = await fixture();
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const first = await operator.query(status, {});
    await operator.mutation(settings, { enabled: false, intervalMinutes: 60 });
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const next = await operator.query(status, {});
    expect(next.latestRun?.coverage.windowStartAt).toBe(
      first.latestRun?.coverage.windowStartAt,
    );
    expect(next.config.authorizationRevision).toBeGreaterThan(
      first.config.authorizationRevision,
    );
    const tenantId = await t.run((ctx) =>
      ctx.db.insert("users", {
        accountKind: "customer",
        email: "tenant@example.com",
      }),
    );
    await expect(
      t.withIdentity({ subject: `${tenantId}|session` }).query(status, {}),
    ).rejects.toThrow("Spot operators");
  });
  it("atomically fences paused, changed-credential, and disabled-sponsor source writes", async () => {
    const { operator, t, userId } = await fixture();
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const sourceId = await t.run(async (ctx) => {
      const config = (await ctx.db
        .query("operatorGoogleWorkspaceScanConfig")
        .first())!;
      const mailboxId = await ctx.db.insert(
        "operatorGoogleWorkspaceScanMailboxes",
        {
          mailbox: "mail@example.com",
          runId: config.currentRunId!,
          authorizationRevision: config.authorizationRevision,
          phase: "history",
          status: "completed",
          windowStartAt: config.windowStartAt!,
          collectedMessages: 1,
          nextAttemptAt: 0,
          attempts: 0,
        },
      );
      return ctx.db.insert("operatorGoogleWorkspaceScanSources", {
        mailbox: "mail@example.com",
        messageId: "m1",
        threadId: "t1",
        mailboxId,
        runId: config.currentRunId!,
        authorizationRevision: config.authorizationRevision,
        status: "running",
        leaseToken: "lease",
        leaseUntil: dayjs().add(1, "minute").valueOf(),
        nextAttemptAt: 0,
        attempts: 0,
      });
    });
    const guardedWrite = () =>
      t.run(async (ctx) => {
        await assertGoogleWorkspaceScanSourceLease(ctx, {
          sourceId,
          leaseToken: "lease",
        });
        await ctx.db.patch(sourceId, { error: "guard passed" });
      });
    await guardedWrite();
    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", "");
    await expect(guardedWrite()).rejects.toThrow("credentials changed");
    await t.mutation(dispatch, {});
    expect((await operator.query(status, {})).config.enabled).toBe(false);
    await expect(guardedWrite()).rejects.toThrow("paused");
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("operatorProfiles")
        .withIndex("user", (q) => q.eq("userId", userId))
        .unique();
      await ctx.db.patch(profile!._id, { status: "disabled" });
    });
    await expect(operator.query(status, {})).rejects.toThrow("Spot operators");
  });
});

async function workFixture(sourceCount = 1) {
  const f = await fixture();
  await f.operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
  const rows = await f.t.run(async (ctx) => {
    const config = (await ctx.db
      .query("operatorGoogleWorkspaceScanConfig")
      .first())!;
    const runId = config.currentRunId!;
    await ctx.db.patch(runId, {
      directoryComplete: true,
      phase: "reconciliation",
      discoveredMailboxes: 1,
      completedMailboxes: 1,
      pendingSources: sourceCount,
      collectedMessages: sourceCount,
    });
    const mailboxId = await ctx.db.insert(
      "operatorGoogleWorkspaceScanMailboxes",
      {
        mailbox: "mail@example.com",
        runId,
        authorizationRevision: config.authorizationRevision,
        phase: "completed",
        status: "completed",
        windowStartAt: config.windowStartAt!,
        collectedMessages: sourceCount,
        nextAttemptAt: 0,
        attempts: 0,
      },
    );
    const sourceIds = [];
    for (let i = 0; i < sourceCount; i++)
      sourceIds.push(
        await ctx.db.insert("operatorGoogleWorkspaceScanSources", {
          mailbox: "mail@example.com",
          mailboxId,
          runId,
          authorizationRevision: config.authorizationRevision,
          messageId: `m${i}`,
          threadId: `t${i}`,
          status: "ready",
          nextAttemptAt: 0,
          attempts: 0,
          evidence: emptyEvidence(`m${i}`, `t${i}`),
        }),
      );
    return { config, runId, mailboxId, sourceIds };
  });
  return { ...f, ...rows };
}
function emptyEvidence(messageId = "m0", threadId = "t0") {
  return {
    mailbox: "mail@example.com",
    messageId,
    threadId,
    internetMessageId: null,
    internalDate: 1,
    sentAt: null,
    from: null,
    to: [],
    cc: [],
    subject: null,
    inReplyTo: null,
    references: null,
    contentFingerprint: "fixture",
    bodyFingerprint:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    attachments: [],
    bodyPartCount: 0,
    bodyComplete: true,
  };
}

describe("Workspace collection recovery and concurrency", () => {
  it("does not capture the lookback until first enable and rejects a stale enabled settings save after pause", async () => {
    const { t, operator } = await fixture();
    await operator.mutation(settings, {
      enabled: false,
      intervalMinutes: 60,
      expectedAuthorizationRevision: 0,
    });
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("operatorGoogleWorkspaceScanConfig").first())
            ?.windowStartAt,
      ),
    ).toBeNull();
    vi.setSystemTime(dayjs().add(10, "day").valueOf());
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const initial = await operator.query(status, {});
    expect(initial.latestRun?.coverage.windowStartAt).toBe(
      dayjs().subtract(90, "day").valueOf(),
    );
    await operator.mutation(settings, {
      enabled: false,
      intervalMinutes: 60,
      expectedAuthorizationRevision: initial.config.authorizationRevision,
    });
    await expect(
      operator.mutation(settings, {
        enabled: true,
        intervalMinutes: 15,
        expectedAuthorizationRevision: initial.config.authorizationRevision,
      }),
    ).rejects.toThrow("authorization changed");
    expect((await operator.query(status, {})).config.enabled).toBe(false);
  });
  it("fences a disabled sponsor while credentials and scan config remain live", async () => {
    const { t, userId, sourceIds } = await workFixture();
    const claim = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId: sourceIds[0] },
    );
    expect(claim).not.toBeNull();
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("operatorProfiles")
        .withIndex("user", (q) => q.eq("userId", userId))
        .unique();
      await ctx.db.patch(profile!._id, { status: "disabled" });
    });
    await expect(
      t.run((ctx) =>
        assertGoogleWorkspaceScanSourceLease(ctx, {
          sourceId: sourceIds[0],
          leaseToken: claim!.leaseToken,
        }),
      ),
    ).rejects.toThrow("Spot operators");
    expect(
      await t.run(async (ctx) => (await ctx.db.get(sourceIds[0]))?.status),
    ).toBe("running");
  });
  it("reclaims expired leases and rejects the old writer after recovery", async () => {
    const { t, sourceIds } = await workFixture();
    const first = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId: sourceIds[0] },
    );
    vi.setSystemTime(dayjs().add(6, "minute").valueOf());
    await expect(
      t.run((ctx) =>
        assertGoogleWorkspaceScanSourceLease(ctx, {
          sourceId: sourceIds[0],
          leaseToken: first!.leaseToken,
        }),
      ),
    ).rejects.toThrow("lease");
    await t.mutation(dispatch, {});
    const second = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId: sourceIds[0] },
    );
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    await expect(
      t.run((ctx) =>
        assertGoogleWorkspaceScanSourceLease(ctx, {
          sourceId: sourceIds[0],
          leaseToken: first!.leaseToken,
        }),
      ),
    ).rejects.toThrow("lease");
    await expect(
      t.run((ctx) =>
        assertGoogleWorkspaceScanSourceLease(ctx, {
          sourceId: sourceIds[0],
          leaseToken: second!.leaseToken,
        }),
      ),
    ).resolves.toMatchObject({ source: { _id: sourceIds[0] } });
  });
  it("selects current work beyond stale batches and bounds combined reserved/running source capacity", async () => {
    const { t, sourceIds, config, mailboxId, runId } = await workFixture(12);
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++)
        await ctx.db.insert("operatorGoogleWorkspaceScanSources", {
          mailbox: "mail@example.com",
          mailboxId,
          runId,
          authorizationRevision: config.authorizationRevision - 1,
          messageId: `stale${i}`,
          threadId: `stale${i}`,
          status: "ready",
          nextAttemptAt: -1,
          attempts: 0,
        });
    });
    for (let i = 0; i < 5; i++) await t.mutation(dispatch, {});
    const reservations = await t.run((ctx) =>
      ctx.db
        .query("operatorGoogleWorkspaceScanSources")
        .withIndex("active", (q) =>
          q
            .eq("authorizationRevision", config.authorizationRevision)
            .eq("active", true),
        )
        .collect(),
    );
    expect(reservations).toHaveLength(8);
    const claims = await Promise.all(
      sourceIds.map((sourceId) =>
        t.mutation(internal.operatorGoogleWorkspaceScan.claimSourceInternal, {
          sourceId,
        }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(8);
    expect(reservations.every((row) => sourceIds.includes(row._id))).toBe(true);
  });
  it("does not report failed reconciliation as success and restores run counters on retry", async () => {
    const { t, operator, sourceIds, runId } = await workFixture();
    const sourceId = sourceIds[0];
    const claim = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId },
    );
    await t.mutation(
      internal.operatorGoogleWorkspaceScan.finishSourceInternal,
      {
        sourceId,
        leaseToken: claim!.leaseToken,
        status: "failed",
        error: "Synthetic model failure",
      },
    );
    await t.mutation(dispatch, {});
    expect(await operator.query(status, {})).toMatchObject({
      lastSuccessAt: null,
      latestRun: {
        phase: "partial",
        coverage: { pendingSources: 0, reconciledSources: 0 },
      },
    });
    await t.run((ctx) => retryGoogleWorkspaceScanSource(ctx, { sourceId }));
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      failedSources: 0,
      pendingSources: 1,
      reconciledSources: 0,
    });
    const recollect = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimCollectionInternal,
      { sourceId },
    );
    expect(recollect).not.toBeNull();
    await t.mutation(
      internal.operatorGoogleWorkspaceScan.finishCollectionInternal,
      {
        sourceId,
        leaseToken: recollect!.leaseToken,
        evidence: emptyEvidence(),
        excluded: false,
      },
    );
    const retry = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId },
    );
    await t.mutation(
      internal.operatorGoogleWorkspaceScan.finishSourceInternal,
      { sourceId, leaseToken: retry!.leaseToken, status: "completed" },
    );
    await t.mutation(dispatch, {});
    expect(await operator.query(status, {})).toMatchObject({
      latestRun: {
        phase: "completed",
        coverage: { pendingSources: 0, reconciledSources: 1 },
      },
    });
    expect((await operator.query(status, {})).lastSuccessAt).not.toBeNull();
  });
  it("recollects retried sources after body pruning and rejects out-of-order or missing stored body pages", async () => {
    const { t, sourceIds } = await workFixture();
    const sourceId = sourceIds[0];
    await t.run(async (ctx) => {
      await ctx.db.patch(sourceId, {
        status: "completed",
        evidence: { ...emptyEvidence(), bodyPartCount: 2 },
        stagedPartCount: 2,
      });
    });
    await t.run((ctx) => retryGoogleWorkspaceScanSource(ctx, { sourceId }));
    expect(
      await t.mutation(
        internal.operatorGoogleWorkspaceScan.claimSourceInternal,
        { sourceId },
      ),
    ).toBeNull();
    const claim = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimCollectionInternal,
      { sourceId },
    );
    await expect(
      t.mutation(
        internal.operatorGoogleWorkspaceScan.storeSourcePartsInternal,
        {
          sourceId,
          leaseToken: claim!.leaseToken,
          parts: [{ ordinal: 3, text: "missing earlier body" }],
        },
      ),
    ).rejects.toThrow("in order");
  });
});

function directoryUser(primaryEmail: string) {
  return {
    primaryEmail,
    displayName: null,
    aliases: [],
    suspended: false,
    archived: false,
    mailboxSetup: true,
  };
}
async function collectionFixture() {
  const f = await fixture();
  await f.operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
  const runId = (await f.t.run(
    async (ctx) =>
      (await ctx.db.query("operatorGoogleWorkspaceScanConfig").first())!
        .currentRunId,
  ))!;
  providerMock.listDirectoryUsers.mockResolvedValue({
    users: [directoryUser("mail@example.com")],
    nextPageToken: null,
  });
  providerMock.getDirectoryUser.mockResolvedValue(
    directoryUser("mail@example.com"),
  );
  await f.t.action(internal.actions.operatorGoogleWorkspaceScan.discover, {
    runId,
  });
  const mailbox = (await f.t.run((ctx) =>
    ctx.db.query("operatorGoogleWorkspaceScanMailboxes").first(),
  ))!;
  return { ...f, runId, mailboxId: mailbox._id };
}
describe("Gmail baseline and history collection", () => {
  it("exhausts a Directory roster beyond live-tool limits with durable paginated discovery", async () => {
    const { t, operator } = await fixture();
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const runId = (await t.run(
      async (ctx) =>
        (await ctx.db.query("operatorGoogleWorkspaceScanConfig").first())!
          .currentRunId,
    ))!;
    providerMock.listDirectoryUsers
      .mockResolvedValueOnce({
        users: Array.from({ length: 100 }, (_, i) =>
          directoryUser(`mail${i}@example.com`),
        ),
        nextPageToken: "page2",
      })
      .mockResolvedValueOnce({
        users: [
          directoryUser("last@example.com"),
          { ...directoryUser("suspended@example.com"), suspended: true },
        ],
        nextPageToken: null,
      });
    await t.action(internal.actions.operatorGoogleWorkspaceScan.discover, {
      runId,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      directoryComplete: false,
      discoveredMailboxes: 100,
      directoryPageToken: "page2",
    });
    await t.action(internal.actions.operatorGoogleWorkspaceScan.discover, {
      runId,
    });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      directoryComplete: true,
      discoveredMailboxes: 101,
    });
    expect(providerMock.listDirectoryUsers.mock.calls[1][0].pageToken).toBe(
      "page2",
    );
  });
  it("captures a checkpoint before baseline, durably dedups page replay, and drains arrivals before advancing history", async () => {
    const { t, mailboxId } = await collectionFixture();
    providerMock.getHistoryCheckpoint.mockResolvedValue("100");
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(providerMock.listMessages).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "baseline",
      historyCheckpoint: "100",
    });
    providerMock.listMessages
      .mockResolvedValueOnce({
        messages: [{ id: "old", threadId: "thread-old" }],
        nextPageToken: "next",
      })
      .mockResolvedValueOnce({
        messages: [
          { id: "old", threadId: "thread-old" },
          { id: "other", threadId: "thread-other" },
        ],
        nextPageToken: null,
      });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "baseline",
      pageToken: "next",
      historyCheckpoint: "100",
    });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "history",
      collectedMessages: 2,
      historyCheckpoint: "100",
    });
    providerMock.listHistory.mockResolvedValue({
      messages: [
        { id: "arrival", threadId: "thread-new" },
        { id: "old", threadId: "thread-old" },
      ],
      nextPageToken: null,
      historyId: "150",
    });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(providerMock.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({ startHistoryId: "100" }),
    );
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "completed",
      historyCheckpoint: "150",
      collectedMessages: 3,
    });
    const sources = await t.run((ctx) =>
      ctx.db.query("operatorGoogleWorkspaceScanSources").collect(),
    );
    expect(sources.map((source) => source.messageId).sort()).toEqual([
      "arrival",
      "old",
      "other",
    ]);
    expect(sources.every((source) => source.status === "collecting")).toBe(
      true,
    );
  });
  it("resyncs expired history from the original anchor and resumes a failed baseline page without losing work", async () => {
    const { t, operator, mailboxId } = await collectionFixture();
    const window = (await operator.query(status, {})).latestRun!.coverage
      .windowStartAt!;
    await t.run((ctx) =>
      ctx.db.patch(mailboxId, {
        phase: "history",
        historyCheckpoint: "expired",
      }),
    );
    providerMock.listHistory.mockRejectedValueOnce(
      new GoogleWorkspaceProviderError("History expired", 404),
    );
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "checkpoint",
      windowStartAt: window,
    });
    providerMock.getHistoryCheckpoint.mockResolvedValue("fresh");
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    providerMock.listMessages
      .mockResolvedValueOnce({
        messages: [{ id: "a", threadId: "a" }],
        nextPageToken: "second",
      })
      .mockRejectedValueOnce(
        new GoogleWorkspaceProviderError("Rate limited", 429),
      )
      .mockResolvedValueOnce({
        messages: [{ id: "b", threadId: "b" }],
        nextPageToken: null,
      });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      status: "failed",
      pageToken: "second",
      collectedMessages: 1,
    });
    vi.setSystemTime(dayjs().add(1, "minute").valueOf());
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    expect(providerMock.listMessages.mock.calls[2][0]).toMatchObject({
      pageToken: "second",
      query: `after:${Math.floor(window / 1000)} -in:drafts -in:spam -in:trash`,
    });
    expect(await t.run((ctx) => ctx.db.get(mailboxId))).toMatchObject({
      phase: "history",
      collectedMessages: 2,
    });
  });
  it("preserves full multi-page body and provenance while excluding drafts, spam and trash", async () => {
    const { t, mailboxId } = await collectionFixture();
    providerMock.getHistoryCheckpoint.mockResolvedValue("100");
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    providerMock.listMessages.mockResolvedValue({
      messages: [
        { id: "full", threadId: "full" },
        { id: "draft", threadId: "draft" },
        { id: "spam", threadId: "spam" },
        { id: "trash", threadId: "trash" },
      ],
      nextPageToken: null,
    });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    const body = "Evidence 🧭 ".repeat(12_000);
    providerMock.getMessageFull.mockImplementation(
      async ({ messageId }: { messageId: string }) => ({
        id: messageId,
        threadId: messageId,
        internalDate: "1000",
        snippet: null,
        labelIds: messageId === "full" ? ["SENT"] : [messageId.toUpperCase()],
        payload: {
          partId: "0",
          mimeType: "text/plain",
          filename: "",
          headers: [
            { name: "From", value: "client@example.com" },
            { name: "Message-ID", value: "<original@example.com>" },
          ],
          body: {
            attachmentId: null,
            size: body.length,
            data: btoa(unescape(encodeURIComponent(body))),
          },
          parts: [],
        },
      }),
    );
    const sources = await t.run((ctx) =>
      ctx.db.query("operatorGoogleWorkspaceScanSources").collect(),
    );
    for (const source of sources)
      await t.action(
        internal.actions.operatorGoogleWorkspaceScan.collectSource,
        { sourceId: source._id },
      );
    const complete = (await t.run((ctx) =>
      ctx.db.get(sources.find((source) => source.messageId === "full")!._id),
    ))!;
    expect(complete).toMatchObject({
      status: "ready",
      evidence: {
        bodyComplete: true,
        mailbox: "mail@example.com",
        internetMessageId: "<original@example.com>",
      },
    });
    const parts = await t.run((ctx) =>
      ctx.db
        .query("operatorGoogleWorkspaceScanSourceParts")
        .withIndex("source_ordinal", (q) => q.eq("sourceId", complete._id))
        .collect(),
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.text).join("")).toBe(body.trim());
    expect(complete.evidence?.bodyFingerprint).toBe(
      await googleWorkspaceScanBodyFingerprint(body.trim()),
    );
    for (const source of sources.filter(
      (source) => source.messageId !== "full",
    ))
      expect(await t.run((ctx) => ctx.db.get(source._id))).toMatchObject({
        status: "excluded",
      });
  });
  it("adopts old unreconciled sources on re-enable without duplicating their bodies or losing provenance", async () => {
    const { t, operator, sourceIds, mailboxId } = await workFixture();
    const sourceId = sourceIds[0];
    await t.run((ctx) =>
      ctx.db.insert("operatorGoogleWorkspaceScanSourceParts", {
        sourceId,
        ordinal: 0,
        text: "preserved evidence",
      }),
    );
    await operator.mutation(settings, { enabled: false, intervalMinutes: 60 });
    await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
    const config = (await t.run((ctx) =>
      ctx.db.query("operatorGoogleWorkspaceScanConfig").first(),
    ))!;
    providerMock.listDirectoryUsers.mockResolvedValue({
      users: [directoryUser("mail@example.com")],
      nextPageToken: null,
    });
    providerMock.getDirectoryUser.mockResolvedValue(
      directoryUser("mail@example.com"),
    );
    await t.action(internal.actions.operatorGoogleWorkspaceScan.discover, {
      runId: config.currentRunId!,
    });
    providerMock.getHistoryCheckpoint.mockResolvedValue("100");
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    providerMock.listMessages.mockResolvedValue({
      messages: [{ id: "m0", threadId: "t0" }],
      nextPageToken: null,
    });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    const rows = await t.run((ctx) =>
      ctx.db.query("operatorGoogleWorkspaceScanSources").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: sourceId,
      status: "collecting",
      authorizationRevision: config.authorizationRevision,
      runId: config.currentRunId,
    });
    expect(
      await t.run((ctx) =>
        ctx.db.query("operatorGoogleWorkspaceScanSourceParts").collect(),
      ),
    ).toHaveLength(1);
  });
});

describe("Workspace settings access-context races", () => {
  it.each(["connector", "credentials"] as const)(
    "requires review when %s changes before dispatcher suspension, while still allowing pause",
    async (change) => {
      const { operator } = await fixture();
      await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
      const current = await operator.query(status, {});
      if (change === "connector")
        await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
          enabled: true,
          mailboxMode: "directory",
          mailboxes: [],
          directoryAdminEmail: "replacement@example.com",
        });
      else
        vi.stubEnv(
          "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
          JSON.stringify({
            type: "service_account",
            client_email: "reader@example.iam.gserviceaccount.com",
            client_id: "123",
            private_key:
              "-----BEGIN PRIVATE KEY-----\nrotated\n-----END PRIVATE KEY-----",
          }),
        );
      await expect(
        operator.mutation(settings, {
          enabled: true,
          intervalMinutes: 15,
          expectedAuthorizationRevision: current.config.authorizationRevision,
        }),
      ).rejects.toThrow("Workspace access changed");
      await operator.mutation(settings, {
        enabled: false,
        intervalMinutes: 60,
        expectedAuthorizationRevision: current.config.authorizationRevision,
      });
      expect((await operator.query(status, {})).config.enabled).toBe(false);
    },
  );
});

it("rejects a second operator's stale cadence save without invalidating live task authorization", async () => {
  const { operator, t } = await fixture();
  await operator.mutation(settings, { enabled: true, intervalMinutes: 60 });
  const secondUserId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "second@example.com",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "second@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  const second = t.withIdentity({ subject: `${secondUserId}|session` });
  const loaded = await second.query(status, {});
  await operator.mutation(settings, {
    enabled: true,
    intervalMinutes: 30,
    expectedAuthorizationRevision: loaded.config.authorizationRevision,
    expectedSettingsUpdatedAt: loaded.config.settingsUpdatedAt,
  });
  await expect(
    second.mutation(settings, {
      enabled: true,
      intervalMinutes: 15,
      expectedAuthorizationRevision: loaded.config.authorizationRevision,
      expectedSettingsUpdatedAt: loaded.config.settingsUpdatedAt,
    }),
  ).rejects.toThrow("settings changed");
  const saved = await operator.query(status, {});
  expect(saved.config.intervalMinutes).toBe(30);
  expect(saved.config.authorizationRevision).toBe(
    loaded.config.authorizationRevision,
  );
  expect(saved.config.settingsUpdatedAt).toBeGreaterThan(
    loaded.config.settingsUpdatedAt,
  );
});

it("does not replace an active collector lease when body paging has extended its deadline", async () => {
  const { t, sourceIds } = await workFixture(2);
  const sourceId = sourceIds[0];
  await t.run((ctx) => ctx.db.patch(sourceId, { status: "collecting" }));
  const claim = await t.mutation(
    internal.operatorGoogleWorkspaceScan.claimCollectionInternal,
    { sourceId },
  );
  await t.run((ctx) =>
    ctx.db.patch(sourceId, {
      nextAttemptAt: 0,
      leaseUntil: dayjs().add(10, "minute").valueOf(),
    }),
  );
  await t.mutation(dispatch, {});
  expect(await t.run((ctx) => ctx.db.get(sourceId))).toMatchObject({
    leaseToken: claim!.leaseToken,
    status: "collecting",
  });
});

it("does not let expired mailbox rows hide the four live mailbox leases", async () => {
  const { t, runId, config } = await workFixture(0);
  const candidate = await t.run(async (ctx) => {
    for (let i = 0; i < 8; i++)
      await ctx.db.insert("operatorGoogleWorkspaceScanMailboxes", {
        mailbox: `lease${i}@example.com`,
        runId,
        authorizationRevision: config.authorizationRevision,
        phase: "baseline",
        status: "running",
        windowStartAt: config.windowStartAt!,
        collectedMessages: 0,
        leaseToken: `lease${i}`,
        leaseUntil: i < 4 ? 1 : dayjs().add(1, "minute").valueOf(),
        nextAttemptAt: 0,
        attempts: 0,
      });
    return ctx.db.insert("operatorGoogleWorkspaceScanMailboxes", {
      mailbox: "candidate@example.com",
      runId,
      authorizationRevision: config.authorizationRevision,
      phase: "baseline",
      status: "pending",
      windowStartAt: config.windowStartAt!,
      collectedMessages: 0,
      nextAttemptAt: 0,
      attempts: 0,
    });
  });
  expect(
    await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimMailboxInternal,
      { mailboxId: candidate },
    ),
  ).toBeNull();
});

it.each(["changed", "removed"] as const)(
  "preserves original evidence when a retried source is %s",
  async (mode) => {
    const { t, mailboxId } = await collectionFixture();
    providerMock.getHistoryCheckpoint.mockResolvedValue("100");
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    providerMock.listMessages.mockResolvedValue({
      messages: [{ id: "original", threadId: "thread-original" }],
      nextPageToken: null,
    });
    await t.action(
      internal.actions.operatorGoogleWorkspaceScan.collectMailbox,
      { mailboxId },
    );
    const payload = (body: string) => ({
      id: "original",
      threadId: "thread-original",
      internalDate: "1000",
      snippet: null,
      labelIds: ["INBOX"],
      payload: {
        partId: "0",
        mimeType: "text/plain",
        filename: "",
        headers: [],
        body: { attachmentId: null, size: body.length, data: btoa(body) },
        parts: [],
      },
    });
    providerMock.getMessageFull.mockResolvedValue(payload("original evidence"));
    const source = (await t.run((ctx) =>
      ctx.db.query("operatorGoogleWorkspaceScanSources").first(),
    ))!;
    await t.action(internal.actions.operatorGoogleWorkspaceScan.collectSource, {
      sourceId: source._id,
    });
    const original = await t.run((ctx) => ctx.db.get(source._id));
    const claim = await t.mutation(
      internal.operatorGoogleWorkspaceScan.claimSourceInternal,
      { sourceId: source._id },
    );
    await t.mutation(
      internal.operatorGoogleWorkspaceScan.finishSourceInternal,
      {
        sourceId: source._id,
        leaseToken: claim!.leaseToken,
        status: "failed",
        error: "Synthetic reconciliation failure",
      },
    );
    await t.run((ctx) =>
      retryGoogleWorkspaceScanSource(ctx, { sourceId: source._id }),
    );
    if (mode === "changed")
      providerMock.getMessageFull.mockResolvedValue(
        payload("replacement text"),
      );
    else
      providerMock.getMessageFull.mockRejectedValue(
        new GoogleWorkspaceProviderError("Message removed", 404),
      );
    await t.action(internal.actions.operatorGoogleWorkspaceScan.collectSource, {
      sourceId: source._id,
    });
    const after = await t.run((ctx) => ctx.db.get(source._id));
    expect(after?.evidence).toEqual(original?.evidence);
    expect(after?.status).toBe(mode === "changed" ? "collecting" : "excluded");
    const parts = await t.run((ctx) =>
      ctx.db
        .query("operatorGoogleWorkspaceScanSourceParts")
        .withIndex("source_ordinal", (q) => q.eq("sourceId", source._id))
        .collect(),
    );
    expect(parts.map((part) => part.text).join("")).toBe("original evidence");
  },
);

it("does not clear another failure when retrying a source that was excluded", async () => {
  const { t, runId, sourceIds } = await workFixture(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(sourceIds[0], {
      status: "excluded",
      evidence: undefined,
    });
    await ctx.db.patch(sourceIds[1], { status: "failed" });
    await ctx.db.patch(runId, { pendingSources: 0, failedSources: 1 });
  });
  await t.run((ctx) =>
    retryGoogleWorkspaceScanSource(ctx, { sourceId: sourceIds[0] }),
  );
  expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
    pendingSources: 1,
    failedSources: 1,
    reconciledSources: 0,
  });
});
