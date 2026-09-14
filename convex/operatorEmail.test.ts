/// <reference types="vite/client" />
import dayjs from "dayjs";
import { Webhook } from "svix";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("operatorEmailIdentityBackfill", {
      key: "legacy",
      completedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email: "terry@claritylabs.inc",
      accountKind: "operator",
      emailVerificationTime: 1,
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email: "terry@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, profileId };
  });
  return { t, ...ids };
}
const message = {
  providerId: "provider-1",
  messageId: "<message-1@example.com>",
  sender: "terry@spot.insure",
  subject: "Review this",
  content: "Please review this email",
  attachments: [],
};

test("atomically creates a private operator thread and suppresses provider and signed-message replays across aliases", async () => {
  const { t, userId } = await fixture();
  const first = await t.mutation(internal.operatorEmail.accept, message);
  expect(first.duplicate).toBe(false);
  expect(
    (await t.mutation(internal.operatorEmail.accept, message)).duplicate,
  ).toBe(true);
  expect(
    (
      await t.mutation(internal.operatorEmail.accept, {
        ...message,
        providerId: "provider-2",
        sender: "terry@toolsforenlightenment.org",
      })
    ).duplicate,
  ).toBe(true);
  await t.run(async (ctx) => {
    const receipts = await ctx.db.query("operatorEmailReceipts").collect();
    const threads = await ctx.db.query("operatorAgentThreads").collect();
    expect(receipts).toHaveLength(1);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      channel: "email",
      visibility: "private",
      ownerUserId: userId,
    });
    expect(await ctx.db.query("threads").collect()).toHaveLength(0);
  });
});

test("continues an owned thread from another domain but rejects a different operator or disabled sender", async () => {
  const { t, profileId } = await fixture();
  const first = await t.mutation(internal.operatorEmail.accept, message);
  const context = await t.query(internal.operatorEmail.getDeliveryContext, {
    receiptId: first.receiptId,
  });
  const threadToken = context!.receipt.threadId;
  await t.mutation(internal.operatorEmail.accept, {
    ...message,
    providerId: "provider-2",
    messageId: "<reply@example.com>",
    sender: "terry@toolsforenlightenment.org",
    threadToken,
  });
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "other@spot.insure",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "other@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  await expect(
    t.mutation(internal.operatorEmail.accept, {
      ...message,
      providerId: "provider-3",
      messageId: "<other@example.com>",
      sender: "other@spot.insure",
      threadToken,
    }),
  ).rejects.toThrow("thread is not available");
  await t.run((ctx) => ctx.db.patch(profileId, { status: "disabled" }));
  await expect(
    t.mutation(internal.operatorEmail.accept, {
      ...message,
      providerId: "provider-4",
    }),
  ).rejects.toThrow("not authorized");
  expect(
    await t.query(internal.operatorEmail.getDeliveryContext, {
      receiptId: first.receiptId,
    }),
  ).toBeNull();
});

test("delivers a terminal response only once to its authenticated sender and rechecks disabled access", async () => {
  const { t, profileId } = await fixture();
  vi.stubEnv("EMAIL_DELIVERY_MODE", "live");
  vi.stubEnv("AUTH_RESEND_KEY", "test");
  const fetchMock = vi.fn(async () => Response.json({ id: "sent-email" }));
  vi.stubGlobal("fetch", fetchMock);
  const accepted = await t.mutation(internal.operatorEmail.accept, message);
  await t.run(async (ctx) => {
    const receipt = await ctx.db.get(accepted.receiptId);
    const run = await ctx.db.get(receipt!.runId);
    await ctx.db.patch(run!._id, { status: "completed" });
    await ctx.db.patch(run!.agentMessageId, { content: "Here is the result." });
  });
  await t.action(internal.actions.handleInboundOperatorEmail.deliver, {
    receiptId: accepted.receiptId,
  });
  await t.action(internal.actions.handleInboundOperatorEmail.deliver, {
    receiptId: accepted.receiptId,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as string,
  );
  expect(payload).toMatchObject({
    to: "terry@spot.insure",
    from: "Spot Operator <operator@agent.spot.insure>",
  });
  expect(payload.reply_to).toMatch(
    /^operator\+[a-z0-9]+@agent\.spot\.insure$/i,
  );
  expect(payload.cc).toBeUndefined();
  expect(payload.bcc).toBeUndefined();
  await t.run((ctx) => ctx.db.patch(profileId, { status: "disabled" }));
  await t.action(internal.actions.handleInboundOperatorEmail.deliver, {
    receiptId: accepted.receiptId,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("recovers abandoned and failed delivery attempts with the same message and payload, then stops after three claims", async () => {
  const { t } = await fixture();
  const { receiptId } = await t.mutation(
    internal.operatorEmail.accept,
    message,
  );
  const first = await t.mutation(internal.operatorEmail.claimDelivery, {
    receiptId,
    phase: "terminal:completed",
    text: "Original response",
  });
  expect(first).toMatchObject({ attempts: 1 });
  expect(
    await t.mutation(internal.operatorEmail.claimDelivery, {
      receiptId,
      phase: "terminal:completed",
      text: "New response",
    }),
  ).toBeNull();
  vi.setSystemTime(dayjs().add(121, "second").valueOf());
  const recovered = await t.mutation(internal.operatorEmail.claimDelivery, {
    receiptId,
    phase: "terminal:completed",
    text: "New response",
  });
  expect(recovered).toEqual({ ...first, attempts: 2 });
  await t.mutation(internal.operatorEmail.finishDelivery, {
    deliveryId: recovered!.id,
    attempts: 1,
    sent: true,
  });
  expect(await t.run((ctx) => ctx.db.get(recovered!.id))).toMatchObject({
    status: "sending",
    attempts: 2,
  });
  await t.mutation(internal.operatorEmail.finishDelivery, {
    deliveryId: recovered!.id,
    attempts: 2,
    sent: false,
  });
  const last = await t.mutation(internal.operatorEmail.claimDelivery, {
    receiptId,
    phase: "terminal:completed",
    text: "New response",
  });
  expect(last).toEqual({ ...first, attempts: 3 });
  await t.mutation(internal.operatorEmail.finishDelivery, {
    deliveryId: last!.id,
    attempts: 3,
    sent: false,
  });
  expect(
    await t.mutation(internal.operatorEmail.claimDelivery, {
      receiptId,
      phase: "terminal:completed",
      text: "Again",
    }),
  ).toBeNull();
});

test.each(["operator", "agent", "cove"])(
  "shared dev and unsigned webhooks cannot execute %s email on the production subdomain",
  async (handle) => {
    const { t } = await fixture();
    const payload = JSON.stringify({
      type: "email.received",
      data: {
        email_id: "received-1",
        from: "terry@spot.insure",
        to: [`${handle}@agent.spot.insure`],
        subject: "Hello",
      },
    });
    const secret = `whsec_${btoa("operator-email-test-secret")}`;
    const svixId = "event-1";
    const svixTimestamp = String(dayjs().unix());
    const svixSignature = new Webhook(secret).sign(
      svixId,
      dayjs().toDate(),
      payload,
    );
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    vi.stubEnv("SPOT_ENV", "dev");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.actions.handleInboundEmail.processInbound, {
      payload,
      svixId,
      svixTimestamp,
      svixSignature,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("operatorEmailReceipts").collect()),
    ).toHaveLength(0);
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    await expect(
      t.action(internal.actions.handleInboundEmail.processInbound, {
        payload,
        svixId,
        svixTimestamp,
        svixSignature,
      }),
    ).rejects.toThrow("requires a verified webhook");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
