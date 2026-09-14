/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { inventoryThreads } from "./imessagePrivacy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const inventoryThreadsFn = inventoryThreads as any;

afterEach(() => {
  vi.useRealTimers();
});

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function seedPrivacyFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "privacy@example.com",
    });
    const otherUserId = await ctx.db.insert("users", {
      email: "other@example.com",
    });
    const orgA = await ctx.db.insert("organizations", {
      name: "Org A",
      type: "client",
    });
    const orgB = await ctx.db.insert("organizations", {
      name: "Org B",
      type: "client",
    });
    const directA = await ctx.db.insert("threads", {
      orgId: orgA,
      title: "Direct A",
      createdBy: userId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "imessage",
      visibility: "user_private",
      imessageHistoryGeneration: 0,
    });
    const directB = await ctx.db.insert("threads", {
      orgId: orgB,
      title: "Direct B",
      createdBy: userId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "imessage",
      visibility: "user_private",
    });
    const group = await ctx.db.insert("threads", {
      orgId: orgA,
      title: "Group",
      createdBy: userId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "imessage",
      imessageIsGroup: true,
    });
    const otherDirect = await ctx.db.insert("threads", {
      orgId: orgA,
      title: "Other direct",
      createdBy: otherUserId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "imessage",
      visibility: "user_private",
    });
    await ctx.db.insert("imessagePrivacyStates", {
      userId,
      historyGeneration: 0,
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    return { userId, orgA, directA, directB, group, otherDirect };
  });
  return { t, ...ids };
}

describe("personal iMessage privacy inventory", () => {
  test("targets direct private threads across memberships and excludes groups and other users", async () => {
    const { t, userId, directA, directB, group, otherDirect } =
      await seedPrivacyFixture();
    const jobId = await t.run(
      async (ctx) =>
        await ctx.db.insert("imessageHistoryDeletionJobs", {
          userId,
          kind: "preview",
          status: "preparing",
          generationCutoff: 0,
          threadCount: 0,
          messageCount: 0,
          fileCount: 0,
          processedThreadCount: 0,
          deletedMessageCount: 0,
          deletedFileCount: 0,
          preservedFileCount: 0,
          requestedAt: dayjs().valueOf(),
          updatedAt: dayjs().valueOf(),
        }),
    );
    await t.mutation(inventoryThreadsFn, {
      jobId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const targetIds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("imessageHistoryDeletionTargets")
          .withIndex("job_status", (q) => q.eq("jobId", jobId))
          .collect()
      ).map((target) => target.threadId),
    );
    expect(new Set(targetIds)).toEqual(new Set([directA, directB]));
    expect(targetIds).not.toContain(group);
    expect(targetIds).not.toContain(otherDirect);
  });

  test("blocks confirmation during an active turn and advances generation atomically afterward", async () => {
    const { t, userId } = await seedPrivacyFixture();
    const previewJobId = await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const privacyState = await ctx.db
        .query("imessagePrivacyStates")
        .withIndex("user", (q) => q.eq("userId", userId))
        .unique();
      if (!privacyState) throw new Error("Expected privacy state");
      await ctx.db.patch(privacyState._id, { historyGeneration: 1 });
      const id = await ctx.db.insert("imessageHistoryDeletionJobs", {
        userId,
        kind: "preview",
        status: "ready",
        generationCutoff: 1,
        threadCount: 2,
        messageCount: 0,
        fileCount: 0,
        processedThreadCount: 0,
        deletedMessageCount: 0,
        deletedFileCount: 0,
        preservedFileCount: 0,
        requestedAt: now,
        readyAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("imessageAgentRunLeases", {
        userId,
        generation: 0,
        leaseKey: "active-turn",
        expiresAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });
    const session = t.withIdentity(sessionFor(userId));
    await expect(
      session.mutation(
        api.imessagePrivacy.requestPersonalImessageDeletion as any,
        { previewJobId },
      ),
    ).rejects.toThrow("active iMessage response");

    await t.run(async (ctx) => {
      const lease = await ctx.db
        .query("imessageAgentRunLeases")
        .withIndex("lease", (q) => q.eq("leaseKey", "active-turn"))
        .unique();
      if (lease) await ctx.db.delete(lease._id);
    });
    const result = await session.mutation(
      api.imessagePrivacy.requestPersonalImessageDeletion as any,
      { previewJobId },
    );
    const deletionJobId =
      result.deletionJobId as Id<"imessageHistoryDeletionJobs">;
    const state = await t.run(
      async (ctx) =>
        await ctx.db
          .query("imessagePrivacyStates")
          .withIndex("user", (q) => q.eq("userId", userId))
          .unique(),
    );
    expect(state?.historyGeneration).toBe(2);
    expect(state?.activeDeletionJobId).toBe(deletionJobId);
    const job = await t.run(async (ctx) => await ctx.db.get(deletionJobId));
    expect(job?.generationCutoff).toBe(1);

    const freshThreadId = await t.run(async (ctx) => {
      const oldThread = await ctx.db
        .query("threads")
        .withIndex(
          "private_history",
          (q) =>
            q
              .eq("createdBy", userId)
              .eq("originChannel", "imessage")
              .eq("visibility", "user_private"),
        )
        .first();
      if (!oldThread) throw new Error("Expected old thread");
      return ctx.db.insert("threads", {
        orgId: oldThread.orgId,
        title: "Fresh generation",
        createdBy: userId,
        lastMessageAt: dayjs().valueOf(),
        originChannel: "imessage",
        visibility: "user_private",
        imessageHistoryGeneration: 2,
      });
    });
    await t.mutation(inventoryThreadsFn, {
      jobId: deletionJobId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const targetedFreshThread = await t.run(
      async (ctx) =>
        await ctx.db
          .query("imessageHistoryDeletionTargets")
          .withIndex("job_thread", (q) =>
            q.eq("jobId", deletionJobId).eq("threadId", freshThreadId),
          )
          .unique(),
    );
    expect(targetedFreshThread).toBeNull();
  });

  test("resumes bounded deletion, redacts audit content, and preserves business files", async () => {
    vi.useFakeTimers();
    const { t, userId, orgA, directA } = await seedPrivacyFixture();
    const fixture = await t.run(async (ctx) => {
      const chatOnlyFileId = await ctx.storage.store(
        new Blob(["chat only"], { type: "text/plain" }),
      );
      const businessFileId = await ctx.storage.store(
        new Blob(["business"], { type: "application/pdf" }),
      );
      const messageId = await ctx.db.insert("threadMessages", {
        threadId: directA,
        orgId: orgA,
        channel: "imessage",
        role: "user",
        content: "Please review these files",
        attachments: [
          {
            filename: "chat.txt",
            contentType: "text/plain",
            size: 9,
            fileId: chatOnlyFileId,
          },
          {
            filename: "requirements.pdf",
            contentType: "application/pdf",
            size: 8,
            fileId: businessFileId,
          },
        ],
      });
      const auditId = await ctx.db.insert("agentActionAuditEvents", {
        orgId: orgA,
        threadId: directA,
        threadMessageId: messageId,
        actorKind: "user",
        userId,
        authorizationKind: "user_membership",
        action: "lookup_policy",
        input: "private request",
        output: "private result",
        status: "succeeded",
        createdAt: dayjs().valueOf(),
      });
      const pendingEmailId = await ctx.db.insert("pendingEmails", {
        orgId: orgA,
        threadId: directA,
        status: "draft",
        scheduledSendTime: 0,
        recipientEmail: "recipient@example.com",
        subject: "Draft",
        emailBody: "Private draft",
      });
      const reviewLinkId = await ctx.db.insert("emailDraftReviewLinks", {
        orgId: orgA,
        pendingEmailId,
        tokenHash: "private-review-token-hash",
        channel: "imessage",
        draftFingerprint: "draft-fingerprint",
        actor: { kind: "user", userId },
        sourceThreadId: directA,
        expiresAt: dayjs().add(1, "hour").valueOf(),
        sendAttempts: 0,
        createdAt: dayjs().valueOf(),
        updatedAt: dayjs().valueOf(),
      });
      await ctx.db.insert("requirementSourceDocuments", {
        orgId: orgA,
        fileId: businessFileId,
        fileName: "requirements.pdf",
        contentType: "application/pdf",
        sourceType: "client_contract",
        title: "Requirements",
        status: "complete",
        createdByUserId: userId,
        createdAt: dayjs().valueOf(),
        updatedAt: dayjs().valueOf(),
      });
      const now = dayjs().valueOf();
      const previewJobId = await ctx.db.insert("imessageHistoryDeletionJobs", {
        userId,
        kind: "preview",
        status: "ready",
        generationCutoff: 0,
        threadCount: 2,
        messageCount: 1,
        fileCount: 2,
        processedThreadCount: 0,
        deletedMessageCount: 0,
        deletedFileCount: 0,
        preservedFileCount: 0,
        requestedAt: now,
        readyAt: now,
        updatedAt: now,
      });
      return {
        previewJobId,
        auditId,
        reviewLinkId,
        chatOnlyFileId,
        businessFileId,
      };
    });
    const result = await t
      .withIdentity(sessionFor(userId))
      .mutation(api.imessagePrivacy.requestPersonalImessageDeletion as any, {
        previewJobId: fixture.previewJobId,
      });
    const deletionJobId =
      result.deletionJobId as Id<"imessageHistoryDeletionJobs">;
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const outcome = await t.run(async (ctx) => ({
      job: await ctx.db.get(deletionJobId),
      thread: await ctx.db.get(directA),
      audit: await ctx.db.get(fixture.auditId),
      reviewLink: await ctx.db.get(fixture.reviewLinkId),
      chatOnlyFile: await ctx.db.system.get("_storage", fixture.chatOnlyFileId),
      businessFile: await ctx.db.system.get("_storage", fixture.businessFileId),
    }));
    expect(outcome.job?.status).toBe("completed");
    expect(outcome.thread).toBeNull();
    expect(outcome.audit).toMatchObject({
      action: "lookup_policy",
      status: "succeeded",
    });
    expect(outcome.audit?.threadId).toBeUndefined();
    expect(outcome.audit?.input).toBeUndefined();
    expect(outcome.audit?.output).toBeUndefined();
    expect(outcome.reviewLink).toBeNull();
    expect(outcome.chatOnlyFile).toBeNull();
    expect(outcome.businessFile).not.toBeNull();
    expect(outcome.job?.deletedFileCount).toBe(1);
    expect(outcome.job?.preservedFileCount).toBe(1);
  });
});
