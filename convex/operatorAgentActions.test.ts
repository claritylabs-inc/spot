/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("operator rich reads execute and replay through the audited action boundary", async () => {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: operatorUserId,
      channel: "chat",
      visibility: "private",
      title: "Renewal review",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const message = {
      threadId,
      ownerUserId: operatorUserId,
      channel: "chat" as const,
      createdAt: now,
      updatedAt: now,
    };
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      ...message,
      role: "user",
      content: "Find our renewal discussion",
    });
    const threadMessageId = await ctx.db.insert("operatorAgentMessages", {
      ...message,
      role: "agent",
      content: "",
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId,
      userMessageId,
      agentMessageId: threadMessageId,
      objective: "Find our renewal discussion",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, threadId, threadMessageId, runId, userMessageId };
  });
  const input = { query: "renewal" };
  const inputHash = await actionConfirmationFingerprint({
    toolName: "search_thread_history",
    toolVersion: 1,
    input,
  });
  const args = {
    operatorUserId: ids.operatorUserId,
    threadId: ids.threadId,
    threadMessageId: ids.threadMessageId,
    runId: ids.runId,
    toolName: "search_thread_history",
    channel: "chat" as const,
    input,
    inputHash,
    idempotencyKey: "renewal-history-read",
  };
  const first = await t.action(
    internal.operatorAgent.executeUnconfirmedActionToolInternal,
    args,
  );
  expect(first, JSON.stringify(first)).toMatchObject({
    status: "succeeded",
    idempotent: false,
    result: [expect.objectContaining({ messageId: ids.userMessageId })],
  });
  const replay = await t.action(
    internal.operatorAgent.executeUnconfirmedActionToolInternal,
    args,
  );
  expect(replay).toEqual({ ...first, idempotent: true });
  const audits = await t.run((ctx) =>
    ctx.db.query("agentActionAuditEvents").collect(),
  );
  expect(audits).toEqual([
    expect.objectContaining({
      action: "search_thread_history",
      status: "succeeded",
    }),
  ]);
});
