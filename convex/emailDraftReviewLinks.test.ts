/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";
import { createInternal as createConfirmationInternal } from "./threadActionConfirmations";
import {
  bindConfirmationInternal,
  claimSendInternal,
  createInternal,
  getByToken,
  sweepExpired,
} from "./emailDraftReviewLinks";

const modules = import.meta.glob("./**/*.ts");
const createConfirmation = createConfirmationInternal as any;
const createReviewLink = createInternal as any;
const bindConfirmation = bindConfirmationInternal as any;
const claimSend = claimSendInternal as any;
const getReviewLink = getByToken as any;
const sweepReviewLinks = sweepExpired as any;

async function fixture() {
  const t = convexTest(schema, modules);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      title: "Email draft",
      createdBy: userId,
      lastMessageAt: 1,
    });
    await ctx.db.insert("threadContextStates", {
      threadId,
      orgId,
      continuityMode: "thread_long",
      taskEpoch: 1,
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
      subject: "Certificate of insurance",
      emailBody: "Attached is the certificate.",
      renderedHtml: "<p>Attached is the certificate.</p>",
    });
    const promptMessageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "slack",
      role: "agent",
      messageKind: "workflow_status",
      content: "Confirm this exact draft.",
    });
    const draft = await ctx.db.get(draftId);
    return {
      userId,
      orgId,
      threadId,
      draftId,
      promptMessageId,
      fingerprint: await pendingEmailDraftFingerprint(draft!),
    };
  });
  return { t, ...data };
}

async function addConfirmation(data: Awaited<ReturnType<typeof fixture>>) {
  return await data.t.mutation(createConfirmation, {
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
}

describe("email draft review links", () => {
  it("reveals only the exact current draft and revokes a replaced channel link", async () => {
    const data = await fixture();
    await addConfirmation(data);
    const first = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "slack",
    });
    expect(
      await data.t.query(getReviewLink, { token: first.token }),
    ).toMatchObject({
      state: "draft",
      orgName: "Acme",
      recipientEmail: "recipient@example.com",
      subject: "Certificate of insurance",
      canSend: true,
    });

    const replacement = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "slack",
    });
    expect(
      await data.t.query(getReviewLink, { token: first.token }),
    ).toBeNull();
    expect(
      await data.t.query(getReviewLink, { token: replacement.token }),
    ).toMatchObject({ state: "draft", canSend: true });
  });

  it("fails closed after the draft fingerprint changes", async () => {
    const data = await fixture();
    await addConfirmation(data);
    const link = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "imessage",
    });
    await data.t.run(async (ctx) => {
      await ctx.db.patch(data.draftId, { subject: "Updated subject" });
    });

    expect(await data.t.query(getReviewLink, { token: link.token })).toEqual({
      state: "stale",
      orgName: "Acme",
    });
    await expect(
      data.t.mutation(claimSend, { token: link.token }),
    ).rejects.toThrow("draft changed");
  });

  it("atomically claims a send so a second click cannot duplicate delivery", async () => {
    const data = await fixture();
    await addConfirmation(data);
    const link = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "email",
    });
    const channelMirror = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "slack",
    });

    await expect(
      data.t.mutation(claimSend, { token: link.token }),
    ).resolves.toMatchObject({ pendingEmailId: data.draftId });
    await expect(
      data.t.mutation(claimSend, { token: link.token }),
    ).rejects.toThrow("already being sent");
    await expect(
      data.t.mutation(claimSend, { token: channelMirror.token }),
    ).rejects.toThrow("already being sent");
  });

  it("binds a pre-delivery email link to the same actor and exact confirmation", async () => {
    const data = await fixture();
    const link = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "email",
      actor: { kind: "user", userId: data.userId },
    });
    expect(
      await data.t.query(getReviewLink, { token: link.token }),
    ).toMatchObject({
      state: "draft",
      canSend: false,
    });

    const confirmationId = await addConfirmation(data);
    await data.t.mutation(bindConfirmation, {
      id: link.id,
      confirmationId,
    });
    expect(
      await data.t.query(getReviewLink, { token: link.token }),
    ).toMatchObject({
      state: "draft",
      canSend: true,
    });
  });

  it("keeps unchanged review links usable beyond legacy expiry and still rejects a reset task", async () => {
    const data = await fixture();
    const confirmationId = await addConfirmation(data);
    const link = await data.t.mutation(createReviewLink, {
      pendingEmailId: data.draftId,
      channel: "other",
    });
    await data.t.run(async (ctx) => {
      await ctx.db.patch(link.id, { expiresAt: 1 });
      await ctx.db.patch(confirmationId, { expiresAt: 1 });
    });

    await expect(
      data.t.mutation(sweepReviewLinks, { batchSize: 10 }),
    ).resolves.toEqual({ deleted: 0 });
    expect(
      await data.t.query(getReviewLink, { token: link.token }),
    ).toMatchObject({ canSend: true });
    await data.t.mutation(internal.threadActionConfirmations.consumeInternal, {
      id: confirmationId,
      actor: { kind: "user", userId: data.userId },
      requireAdjacentPrompt: false,
    });
    await data.t.mutation(claimSend, { token: link.token });
    await data.t.mutation(internal.emailDraftReviewLinks.releaseSendInternal, {
      id: link.id,
      error: "Retry",
    });
    await data.t.mutation(internal.agentHistory.resetTask, {
      threadId: data.threadId,
      currentMessageId: data.promptMessageId,
    });
    expect(
      await data.t.query(getReviewLink, { token: link.token }),
    ).toMatchObject({ canSend: false });
    await expect(
      data.t.mutation(claimSend, { token: link.token }),
    ).rejects.toThrow("no longer current");
    expect(
      await data.t.query(internal.threadActionConfirmations.getInternal, {
        id: confirmationId,
      }),
    ).toBeNull();
  });
});
