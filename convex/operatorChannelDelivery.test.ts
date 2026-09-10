/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import dayjs from "dayjs";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { waitForOperatorAgentRun } from "./lib/operatorAgentChannel";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      accountKind: "operator",
      phone: "+14155550123",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: operatorUserId,
      visibility: "private",
      channel: "slack",
      title: "Long task",
      lastMessageAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const messageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: operatorUserId,
      channel: "slack",
      role: "agent",
      content: "Finished the work.",
      createdAt: 1,
      updatedAt: 1,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId,
      userMessageId: messageId,
      agentMessageId: messageId,
      objective: "Long task",
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    });
    return { operatorUserId, profileId, threadId, messageId, runId };
  });
  const delivery = {
    channel: "slack" as const,
    teamId: "T-SPOT",
    channelId: "C-SPOT",
    clientMessageId: `run:${ids.runId}`,
  };
  return { t, ...ids, delivery };
}

test("hands off an unfinished run at the request boundary and delivers when it finishes", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SLACK_WORKER_URL", "https://slack.example.com");
  vi.stubEnv("SLACK_WORKER_SECRET", "slack-secret");
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const f = await fixture();
  const args = {
    operatorUserId: f.operatorUserId,
    runId: f.runId,
    delivery: f.delivery,
  };
  const handoff = vi.fn();
  const pending = await f.t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    {
      operatorUserId: f.operatorUserId,
      runId: f.runId,
    },
  );
  const ctx = {
    runQuery: async () => {
      vi.setSystemTime(dayjs().add(5, "minute").valueOf());
      return pending;
    },
    scheduler: { runAfter: handoff },
  } as unknown as ActionCtx;
  const waiting = waitForOperatorAgentRun(
    ctx,
    f.operatorUserId,
    f.runId,
    f.delivery,
  );
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(waiting).resolves.toBeNull();
  expect(handoff).toHaveBeenCalledWith(
    0,
    internal.actions.operatorChannelDelivery.deliver,
    args,
  );
  await f.t.action(internal.actions.operatorChannelDelivery.deliver, args);
  expect(fetchMock).not.toHaveBeenCalled();
  await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "completed" }));
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    clientMessageId: f.delivery.clientMessageId,
    mrkdwnText: "Finished the work.",
  });
});

test("retries a deferred transport failure with the same delivery key", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SLACK_WORKER_URL", "https://slack.example.com");
  vi.stubEnv("SLACK_WORKER_SECRET", "slack-secret");
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("Connection reset"))
    .mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "completed" }));
  await f.t.action(internal.actions.operatorChannelDelivery.deliver, {
    operatorUserId: f.operatorUserId,
    runId: f.runId,
    delivery: f.delivery,
  });
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, request] of fetchMock.mock.calls) {
    expect(JSON.parse(String(request?.body)).clientMessageId).toBe(
      f.delivery.clientMessageId,
    );
  }
});

test("reports cancellation instead of delivering stale task output", async () => {
  vi.stubEnv("SLACK_WORKER_URL", "https://slack.example.com");
  vi.stubEnv("SLACK_WORKER_SECRET", "slack-secret");
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "cancelled" }));
  await f.t.action(internal.actions.operatorChannelDelivery.deliver, {
    operatorUserId: f.operatorUserId,
    runId: f.runId,
    delivery: f.delivery,
  });
  expect(
    JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).mrkdwnText,
  ).toContain("cancelled");
  expect(
    JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).mrkdwnText,
  ).not.toContain("Finished the work");
});

test("does not deliver after operator access is revoked", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const f = await fixture();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.runId, { status: "completed" });
    await ctx.db.patch(f.profileId, { status: "disabled" });
  });
  await expect(
    f.t.action(internal.actions.operatorChannelDelivery.deliver, {
      operatorUserId: f.operatorUserId,
      runId: f.runId,
      delivery: f.delivery,
    }),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("delivers deferred iMessage replies only through the operator worker", async () => {
  vi.stubEnv("OPERATOR_IMESSAGE_ENABLED", "true");
  vi.stubEnv(
    "OPERATOR_IMESSAGE_WORKER_URL",
    "https://operator-imessage.example.com",
  );
  vi.stubEnv("OPERATOR_IMESSAGE_WORKER_SECRET", "operator-secret");
  vi.stubEnv("IMESSAGE_WORKER_URL", "https://customer-imessage.example.com");
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "completed" }));
  await f.t.action(internal.actions.operatorChannelDelivery.deliver, {
    operatorUserId: f.operatorUserId,
    runId: f.runId,
    delivery: {
      channel: "imessage",
      toPhone: "+14155550123",
      chatGuid: "operator-chat",
      clientMessageId: "operator-run-reply",
    },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://operator-imessage.example.com/send",
  );
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
    Authorization: "Bearer operator-secret",
  });
});
