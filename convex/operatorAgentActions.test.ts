/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import { collectToolAudit } from "./lib/agentToolAudit";
import { buildOperatorRunCheckpointSummary } from "./lib/operatorAgentContinuation";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("operator web research falls back to Exa, preserves source evidence on replay, and rejects revoked operators", async () => {
  vi.stubEnv("PARALLEL_API_KEY", "test-parallel");
  vi.stubEnv("EXA_API_KEY", "test-exa");
  const t = convexTest(schema, modules);
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
    await ctx.db.insert("globalModelSettings", {
      key: "default",
      routes: {},
      webRetrieval: { primary: "parallel" },
      updatedBy: operatorUserId,
      updatedAt: now,
    });
    return { operatorUserId, profileId };
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://api.parallel.ai/v1/search")
      return new Response("unavailable", { status: 503 });
    if (url === "https://api.exa.ai/search")
      return Response.json({
        results: [
          {
            title: "Miller Brokerage",
            url: "https://miller.example/about",
            text: "Public broker background. ".repeat(400),
          },
        ],
      });
    throw new Error(`Unexpected provider URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const args = {
    operatorUserId: ids.operatorUserId,
    channel: "slack" as const,
    toolName: "web_search",
    input: { query: "Miller Brokerage", maxResults: 1 },
    idempotencyKey: "broker-web-research",
  };
  const first = await t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    args,
  );
  expect(first.outcome).toMatchObject({
    status: "succeeded",
    result: {
      provider: "exa",
      sources: [{ url: "https://miller.example/about" }],
      attempts: [
        { provider: "parallel", ok: false },
        { provider: "exa", ok: true },
      ],
    },
  });
  const replay = await t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    args,
  );
  if (
    first.outcome.status !== "succeeded" ||
    replay.outcome.status !== "succeeded"
  )
    throw new Error("Expected web research results");
  expect(JSON.stringify(first.outcome.result).length).toBeGreaterThan(8_000);
  expect(replay.outcome.result).toEqual(first.outcome.result);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
  await expect(
    t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      ...args,
      idempotencyKey: "revoked",
    }),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("company email reads share operator authorization, auditing and private attachment delivery across channels", async () => {
  const providerCall = vi.fn();
  const largeSearchResult = {
    messages: Array.from({ length: 40 }, (_, index) => ({
      mailbox: "staff@example.com",
      messageId: `message-${index}`,
      threadId: `thread-${index}`,
      subject: `Warehouse renewal ${index}`,
      snippet: `Source-backed renewal correspondence ${"detail ".repeat(40)}`,
    })),
    nextCursor: "opaque-resume-cursor",
    errors: [
      {
        mailbox: "claims@example.com",
        error: "Mailbox delegation is unavailable.",
      },
    ],
    completeness: "partial",
  };
  expect(JSON.stringify(largeSearchResult).length).toBeGreaterThan(8_000);
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
          if (args.toolName === "search_company_email") {
            if (args.input.cursor) {
              expect(args.input.cursor).toBe(largeSearchResult.nextCursor);
              return {
                result: {
                  ...largeSearchResult,
                  nextCursor: "second-page-raw-continuation",
                },
              };
            }
            return { result: largeSearchResult };
          }
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
    {
      toolName: "list_company_mailboxes",
      channel: "chat",
      input: { cursor: null, limit: 1 },
    },
    {
      toolName: "search_company_email",
      channel: "slack",
      input: { query: "warehouse", cursor: null, mailboxes: null, limit: 10 },
    },
    {
      toolName: "read_company_email_thread",
      channel: "imessage",
      input: {
        mailbox: "staff@example.com",
        threadId: "thread-1",
        cursor: null,
        limit: null,
      },
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
  let continuation:
    | { threadId: Id<"operatorAgentThreads">; cursor: string }
    | undefined;
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
    const forwardedInput = providerCall.mock.lastCall?.[0].input;
    expect(forwardedInput).not.toHaveProperty("cursor");
    expect(forwardedInput).not.toHaveProperty("mailboxes");
    expect(Object.values(forwardedInput)).not.toContain(null);
    const replay = await t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      args,
    );
    expect(replay.outcome).toMatchObject({
      status: "succeeded",
      idempotent: true,
    });
    if (entry.toolName === "search_company_email") {
      const audit = await t.run((ctx) =>
        ctx.db
          .query("agentActionAuditEvents")
          .filter((q) => q.eq(q.field("action"), entry.toolName))
          .unique(),
      );
      if (!audit) throw new Error("Missing search audit");
      expect(JSON.parse(audit.output!)).toEqual(largeSearchResult);
      const callerResult = {
        ...largeSearchResult,
        nextCursor: `gws:${audit._id}`,
      };
      continuation = {
        threadId: first.threadId,
        cursor: callerResult.nextCursor,
      };
      expect(callerResult.nextCursor.length).toBeLessThan(50);
      expect(first.outcome).toEqual({
        status: "succeeded",
        result: callerResult,
        idempotent: false,
      });
      expect(replay.outcome).toEqual({
        status: "succeeded",
        result: callerResult,
        idempotent: true,
      });
      const checkpoint = buildOperatorRunCheckpointSummary({
        audit: collectToolAudit({
          toolCalls: [{ toolName: entry.toolName, input: entry.input }],
          toolResults: [{ toolName: entry.toolName, output: first.outcome }],
        }),
      });
      expect(checkpoint).toContain(callerResult.nextCursor);
      expect(checkpoint).toContain('"completeness":"partial"');
    }
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
  if (!continuation) throw new Error("Missing continuation");
  const nextArgs = {
    operatorUserId: ids.operatorUserId,
    threadId: continuation.threadId,
    channel: "mcp" as const,
    toolName: "search_company_email",
    input: { query: "warehouse", limit: 10, cursor: continuation.cursor },
    idempotencyKey: "next-page",
  };
  for (const invalid of [
    { ...nextArgs, threadId: undefined, idempotencyKey: "wrong-thread" },
    {
      ...nextArgs,
      toolName: "list_company_mailboxes",
      input: { cursor: continuation.cursor },
      idempotencyKey: "wrong-tool",
    },
    {
      ...nextArgs,
      input: { ...nextArgs.input, cursor: "gws:invalid" },
      idempotencyKey: "invalid-reference",
    },
  ]) {
    await expect(
      t.action(internal.operatorAgent.invokeRegisteredToolInternal, invalid),
    ).resolves.toMatchObject({
      outcome: {
        status: "failed",
        error: expect.stringContaining("continuation reference is invalid"),
      },
    });
  }
  expect(providerCall).toHaveBeenCalledTimes(4);
  const otherOperatorUserId = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const userId = await ctx.db.insert("users", {
      email: "other@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "other@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(nextArgs.threadId, { visibility: "shared" });
    return userId;
  });
  await expect(
    t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      ...nextArgs,
      operatorUserId: otherOperatorUserId,
      idempotencyKey: "other-operator",
    }),
  ).resolves.toMatchObject({
    outcome: {
      status: "failed",
      error: expect.stringContaining("continuation reference is invalid"),
    },
  });
  await t.run((ctx) =>
    ctx.db.patch(nextArgs.threadId, { visibility: "private" }),
  );
  const next = await t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    nextArgs,
  );
  expect(next.outcome).toMatchObject({
    status: "succeeded",
    result: {
      nextCursor: expect.stringMatching(/^gws:/),
      completeness: "partial",
    },
  });
  expect(next.outcome).not.toMatchObject({
    result: { nextCursor: continuation.cursor },
  });
  const nextReplay = await t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    nextArgs,
  );
  expect(nextReplay.outcome).toEqual({ ...next.outcome, idempotent: true });
  expect(providerCall.mock.lastCall?.[0].input.cursor).toBe(
    largeSearchResult.nextCursor,
  );
  expect(providerCall).toHaveBeenCalledTimes(5);
  const audits = await t.run((ctx) =>
    ctx.db.query("agentActionAuditEvents").collect(),
  );
  expect(audits).toHaveLength(5);
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
  expect(providerCall).toHaveBeenCalledTimes(5);
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
