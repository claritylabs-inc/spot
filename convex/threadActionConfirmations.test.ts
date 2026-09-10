/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import dayjs from "dayjs";
import { consumeInternal, createInternal } from "./threadActionConfirmations";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";

const modules = import.meta.glob("./**/*.ts");
const createConfirmation = createInternal as any;
const consumeConfirmation = consumeInternal as any;

async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
    });
    const otherUserId = await ctx.db.insert("users", {
      email: "other@example.com",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Confirmation",
      createdBy: userId,
      lastMessageAt: 1,
    });
    await ctx.db.insert("threadContextStates", {
      threadId,
      orgId,
      continuityMode: "task_scoped",
      taskEpoch: 4,
      taskStartedAt: 1,
      summaryVersion: 1,
      status: "idle",
      attemptCount: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const draftId = await ctx.db.insert("pendingEmails", {
      orgId,
      threadId,
      status: "draft",
      emailPayload: "{}",
      scheduledSendTime: 0,
      recipientEmail: "recipient@example.com",
      subject: "Policy",
      emailBody: "Attached is the policy.",
    });
    const promptMessageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      messageKind: "workflow_status",
      content: "Confirm this exact draft.",
    });
    const draft = await ctx.db.get(draftId);
    const fingerprint = await pendingEmailDraftFingerprint(draft!);
    return {
      userId,
      otherUserId,
      orgId,
      threadId,
      draftId,
      promptMessageId,
      fingerprint,
    };
  });
  return { t, ...data };
}

describe("thread action confirmations", () => {
  it("is actor-bound, adjacent, exact, and single-use", async () => {
    const data = await fixture();
    const confirmationId = await data.t.mutation(createConfirmation, {
      orgId: data.orgId,
      threadId: data.threadId,
      actor: { kind: "user", userId: data.userId },
      promptMessageId: data.promptMessageId,
      payload: {
        kind: "email_send",
        pendingEmailIds: [data.draftId],
        draftFingerprints: [data.fingerprint],
      },
    });
    const userMessageId = await data.t.run(
      async (ctx) =>
        await ctx.db.insert("threadMessages", {
          threadId: data.threadId,
          orgId: data.orgId,
          channel: "chat",
          role: "user",
          userId: data.userId,
          content: "yes",
        }),
    );

    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "user", userId: data.otherUserId },
        currentMessageId: userMessageId,
        requireAdjacentPrompt: true,
      }),
    ).toBe("needs_refresh");
    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "user", userId: data.userId },
        currentMessageId: userMessageId,
        requireAdjacentPrompt: true,
      }),
    ).toBe("completed");
    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "user", userId: data.userId },
        currentMessageId: userMessageId,
        requireAdjacentPrompt: true,
      }),
    ).toBe("needs_refresh");
  });

  it("becomes stale when the draft fingerprint changes", async () => {
    const data = await fixture();
    const confirmationId = await data.t.mutation(createConfirmation, {
      orgId: data.orgId,
      threadId: data.threadId,
      actor: { kind: "user", userId: data.userId },
      promptMessageId: data.promptMessageId,
      payload: {
        kind: "email_send",
        pendingEmailIds: [data.draftId],
        draftFingerprints: [data.fingerprint],
      },
    });
    await data.t.run(async (ctx) => {
      await ctx.db.patch(data.draftId, { emailBody: "Changed body" });
    });
    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "user", userId: data.userId },
        requireAdjacentPrompt: false,
      }),
    ).toBe("stale");
  });

  it("binds an email confirmation to the exact COI files and sender", async () => {
    const data = await fixture();
    const coi = await data.t.run(async (ctx) => {
      const firstFileId = await ctx.storage.store(new Blob(["first"]));
      const secondFileId = await ctx.storage.store(new Blob(["second"]));
      await ctx.db.patch(data.draftId, {
        attachments: [
          {
            fileId: firstFileId,
            filename: "first-coi.pdf",
            contentType: "application/pdf",
            size: 5,
            kind: "coi",
          },
          {
            fileId: secondFileId,
            filename: "second-coi.pdf",
            contentType: "application/pdf",
            size: 6,
            kind: "coi",
          },
        ],
      });
      const draft = await ctx.db.get(data.draftId);
      return {
        fileIds: [firstFileId, secondFileId],
        fingerprint: await pendingEmailDraftFingerprint(draft!),
      };
    });
    const confirmationId = await data.t.mutation(createConfirmation, {
      orgId: data.orgId,
      threadId: data.threadId,
      actor: { kind: "email", address: "owner@example.com" },
      promptMessageId: data.promptMessageId,
      payload: {
        kind: "coi_batch_delivery",
        pendingEmailId: data.draftId,
        recipientEmail: "recipient@example.com",
        fileIds: coi.fileIds,
        draftFingerprint: coi.fingerprint,
      },
    });
    const replyMessageId = await data.t.run(
      async (ctx) =>
        await ctx.db.insert("threadMessages", {
          threadId: data.threadId,
          orgId: data.orgId,
          channel: "email",
          role: "user",
          fromEmail: "owner@example.com",
          content: "yes",
        }),
    );

    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "email", address: "attacker@example.com" },
        currentMessageId: replyMessageId,
        requireAdjacentPrompt: true,
      }),
    ).toBe("needs_refresh");
    expect(
      await data.t.mutation(consumeConfirmation, {
        id: confirmationId,
        actor: { kind: "email", address: "owner@example.com" },
        currentMessageId: replyMessageId,
        requireAdjacentPrompt: true,
      }),
    ).toBe("completed");
    const draft = await data.t.run(
      async (ctx) => await ctx.db.get(data.draftId),
    );
    expect(draft?.coiBatchAuthorization).toMatchObject({
      recipientEmail: "recipient@example.com",
      fileIds: coi.fileIds,
      draftFingerprint: coi.fingerprint,
      confirmedBy: { kind: "email", address: "owner@example.com" },
      confirmationId,
    });
  });

  it("ignores legacy expiry but is invalidated by a task epoch transition", async () => {
    const expired = await fixture();
    const expiredId = await expired.t.mutation(createConfirmation, {
      orgId: expired.orgId,
      threadId: expired.threadId,
      actor: { kind: "user", userId: expired.userId },
      promptMessageId: expired.promptMessageId,
      payload: {
        kind: "email_cancel",
        pendingEmailIds: [expired.draftId],
        draftFingerprints: [expired.fingerprint],
      },
    });
    await expired.t.run(async (ctx) => {
      await ctx.db.patch(expiredId, { expiresAt: 0 });
    });
    expect(
      await expired.t.mutation(consumeConfirmation, {
        id: expiredId,
        actor: { kind: "user", userId: expired.userId },
        requireAdjacentPrompt: false,
      }),
    ).toBe("completed");

    const reset = await fixture();
    const resetId = await reset.t.mutation(createConfirmation, {
      orgId: reset.orgId,
      threadId: reset.threadId,
      actor: { kind: "user", userId: reset.userId },
      promptMessageId: reset.promptMessageId,
      payload: {
        kind: "email_cancel",
        pendingEmailIds: [reset.draftId],
        draftFingerprints: [reset.fingerprint],
      },
    });
    await reset.t.run(async (ctx) => {
      const state = await ctx.db
        .query("threadContextStates")
        .withIndex("thread", (query) => query.eq("threadId", reset.threadId))
        .unique();
      await ctx.db.patch(state!._id, { taskEpoch: 5 });
    });
    expect(
      await reset.t.mutation(consumeConfirmation, {
        id: resetId,
        actor: { kind: "user", userId: reset.userId },
        requireAdjacentPrompt: false,
      }),
    ).toBe("stale");
  });
  it("preserves an iMessage task and its pending approval across a long absence", async () => {
    const data = await fixture();
    const id = await data.t.mutation(createConfirmation, {
      orgId: data.orgId,
      threadId: data.threadId,
      actor: { kind: "user", userId: data.userId },
      promptMessageId: data.promptMessageId,
      payload: {
        kind: "email_send",
        pendingEmailIds: [data.draftId],
        draftFingerprints: [data.fingerprint],
      },
    });
    const messageId = await data.t.run(async (ctx) => {
      const state = await ctx.db
        .query("threadContextStates")
        .withIndex("thread", (q) => q.eq("threadId", data.threadId))
        .unique();
      await ctx.db.patch(state!._id, {
        lastUserMessageAt: dayjs().subtract(90, "day").valueOf(),
        summary: "The client is reviewing the unchanged draft.",
      });
      return ctx.db.insert("threadMessages", {
        threadId: data.threadId,
        orgId: data.orgId,
        channel: "imessage",
        role: "user",
        content: "Please continue.",
      });
    });
    const state = await data.t.mutation(internal.agentHistory.prepareForTurn, {
      threadId: data.threadId,
      currentMessageId: messageId,
      surface: "imessage",
    });
    expect(state).toMatchObject({
      taskEpoch: 4,
      summary: "The client is reviewing the unchanged draft.",
    });
    expect(await data.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: "pending",
    });
    await data.t.mutation(internal.agentHistory.resetTask, {
      threadId: data.threadId,
      currentMessageId: messageId,
    });
    expect(await data.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: "stale",
    });
  });
});
