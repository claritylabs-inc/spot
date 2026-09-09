/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test, vi } from "vitest";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("company email reads share operator authorization, auditing and private attachment delivery across channels", async () => {
  const providerCall = vi.fn();
  const t = convexTest(schema, {
    ...modules,
    "./actions/operatorGoogleWorkspace.ts": async () => ({
      runToolInternal: internalAction({
        args: {
          operatorUserId: v.id("users"),
          threadId: v.id("operatorAgentThreads"),
          toolName: v.string(),
          input: v.any(),
          channel: v.string(),
        },
        handler: async (ctx, args) => {
          providerCall(args);
          if (args.toolName !== "get_company_email_attachment") {
            return { result: { status: "ok", source: "company_email" } };
          }
          const fileId = await ctx.storage.store(
            new Blob(["Insurance evidence"]),
          );
          return {
            result: { status: "ok", filename: "evidence.txt" },
            attachments: [
              {
                fileId,
                filename: "evidence.txt",
                contentType: "text/plain",
                size: 18,
              },
            ],
          };
        },
      }),
    }),
  });
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, profileId };
  });

  const cases = [
    { toolName: "list_company_mailboxes", channel: "chat", input: {} },
    {
      toolName: "search_company_email",
      channel: "slack",
      input: { query: "warehouse" },
    },
    {
      toolName: "read_company_email_thread",
      channel: "imessage",
      input: { mailbox: "staff@example.com", threadId: "thread-1" },
    },
    {
      toolName: "get_company_email_attachment",
      channel: "mcp",
      input: {
        mailbox: "staff@example.com",
        messageId: "message-1",
        attachmentId: "attachment-1",
      },
    },
  ] as const;
  for (const entry of cases) {
    const args = {
      ...entry,
      operatorUserId: ids.operatorUserId,
      idempotencyKey: entry.toolName,
    };
    const first = await t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      args,
    );
    expect(first.outcome).toMatchObject({
      status: "succeeded",
      idempotent: false,
    });
    const replay = await t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      args,
    );
    expect(replay.outcome).toMatchObject({
      status: "succeeded",
      idempotent: true,
    });
    if (entry.toolName === "get_company_email_attachment") {
      const persisted = await t.run(async (ctx) => ({
        thread: await ctx.db.get(first.threadId),
        message: await ctx.db.get(first.agentMessageId),
        clientFiles: await ctx.db.query("clientFiles").collect(),
      }));
      expect(persisted.thread).toMatchObject({
        ownerUserId: ids.operatorUserId,
        visibility: "private",
      });
      expect(persisted.message?.attachments).toEqual([
        expect.objectContaining({
          filename: "evidence.txt",
          contentType: "text/plain",
        }),
      ]);
      expect(persisted.clientFiles).toEqual([]);
    }
  }
  expect(providerCall).toHaveBeenCalledTimes(4);
  const audits = await t.run((ctx) =>
    ctx.db.query("agentActionAuditEvents").collect(),
  );
  expect(audits).toHaveLength(4);
  expect(audits.every((event) => event.status === "succeeded")).toBe(true);

  await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
  await expect(
    t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      operatorUserId: ids.operatorUserId,
      channel: "mcp",
      toolName: "search_company_email",
      input: { query: "warehouse" },
      idempotencyKey: "after-revocation",
    }),
  ).rejects.toThrow();
  expect(providerCall).toHaveBeenCalledTimes(4);
});

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
  expect(first).toMatchObject({
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
