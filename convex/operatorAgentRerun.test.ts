/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const owner = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const other = await ctx.db.insert("users", {
      email: "other@example.com",
      accountKind: "operator",
    });
    for (const userId of [owner, other])
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: `${userId}@example.com`,
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: owner,
      visibility: "private",
      channel: "chat",
      title: "Test",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob(["evidence"], { type: "text/plain" }),
    );
    const attachment = {
      fileId,
      filename: "evidence.txt",
      contentType: "text/plain",
      size: 8,
    };
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: owner,
      role: "user",
      channel: "chat",
      content: "Create the client",
      attachments: [attachment],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("operatorAgentAttachments", {
      ...attachment,
      threadId,
      operatorUserId: owner,
      messageId: userMessageId,
      createdAt: now,
    });
    const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: owner,
      role: "agent",
      channel: "chat",
      content: "Failed",
      status: "error",
      replyToMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId: owner,
      userMessageId,
      agentMessageId,
      executionKind: "goal",
      objective: "Create the client",
      status: "failed",
      lastError: "Router unavailable",
      checkpoint: {
        iteration: 2,
        executionCount: 1,
        summary: "Client already created",
        lastToolName: "create_client",
      },
      createdAt: now,
      updatedAt: now,
    });
    return { owner, other, threadId, runId, attachment };
  });
  return {
    t,
    ...ids,
    operator: t.withIdentity({ subject: `${ids.owner}|session` }),
  };
}

for (const includeErrorContext of [false, true])
  test(`reruns with original evidence and fresh execution state; error context=${includeErrorContext}`, async () => {
    const f = await fixture();
    const result = await f.operator.mutation(api.operatorAgent.rerunTurn, {
      runId: f.runId,
      includeErrorContext,
    });
    const state = await f.t.run(async (ctx) => ({
      source: await ctx.db.get(f.runId),
      run: await ctx.db.get(result.runId),
      message: await ctx.db.get(result.messageId),
    }));
    expect(state.source?.status).toBe("failed");
    expect(state.run).toMatchObject({
      status: "queued",
      checkpoint: { iteration: 0, executionCount: 0 },
    });
    expect(state.run?.checkpoint?.summary).toContain("Client already created");
    expect(state.run?.checkpoint?.summary?.includes("Router unavailable")).toBe(
      includeErrorContext,
    );
    expect(state.message).toMatchObject({
      content: "Create the client",
      attachments: [f.attachment],
      channel: "chat",
    });
    await expect(
      f.operator.mutation(api.operatorAgent.rerunTurn, {
        runId: f.runId,
        includeErrorContext,
      }),
    ).rejects.toThrow("Wait for the current turn");
  });

test("rejects other operators, active turns, and direct tool replay", async () => {
  const f = await fixture();
  await expect(
    f.t
      .withIdentity({ subject: `${f.other}|session` })
      .mutation(api.operatorAgent.rerunTurn, {
        runId: f.runId,
        includeErrorContext: false,
      }),
  ).rejects.toThrow("not found");
  for (const status of ["queued", "running", "waiting_confirmation"] as const) {
    await f.t.run((ctx) => ctx.db.patch(f.runId, { status }));
    await expect(
      f.operator.mutation(api.operatorAgent.rerunTurn, {
        runId: f.runId,
        includeErrorContext: false,
      }),
    ).rejects.toThrow("Only finished");
  }
  await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "completed" }));
  await expect(
    f.operator.mutation(api.operatorAgent.rerunTurn, {
      runId: f.runId,
      includeErrorContext: true,
    }),
  ).rejects.toThrow("only available for failed");
  await f.t.run((ctx) =>
    ctx.db.patch(f.runId, { executionKind: "direct_tool" }),
  );
  await expect(
    f.operator.mutation(api.operatorAgent.rerunTurn, {
      runId: f.runId,
      includeErrorContext: false,
    }),
  ).rejects.toThrow("Only finished");
});
