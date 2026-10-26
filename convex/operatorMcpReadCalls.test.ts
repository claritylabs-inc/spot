/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Failure modes: concurrent reads must not mutate the shared thread; exact
// retries bind full input; read-only recording cannot admit a write or outsider.
test("MCP read runs preserve shared thread state and enforce invocation identity", async () => {
  const t = convexTest(schema, modules);
  const { operatorUserId, outsider } = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      email: "w5@spot.insure",
      accountKind: "operator",
    });
    const outsider = await ctx.db.insert("users", {
      email: "outsider@example.com",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "w5@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { operatorUserId, outsider };
  });
  const input = {
    operatorUserId,
    conversationKey: "mcp:test",
    toolName: "list_operators",
    input: {},
    idempotencyKey: "first",
  };
  const first = await t.mutation(internal.operatorMcpReadCalls.prepare, input);
  const before = await t.run((ctx) => ctx.db.get(first.threadId));
  const second = await t.mutation(internal.operatorMcpReadCalls.prepare, {
    ...input,
    idempotencyKey: "second",
  });
  expect(second.threadId).toBe(first.threadId);
  expect(second.runId).not.toBe(first.runId);
  expect(
    await t.mutation(internal.operatorMcpReadCalls.prepare, input),
  ).toMatchObject({ runId: first.runId, duplicate: true });
  await expect(
    t.mutation(internal.operatorMcpReadCalls.prepare, {
      ...input,
      toolName: "search_organizations",
      input: { query: "other" },
    }),
  ).rejects.toThrow(/idempotency/i);
  await expect(
    t.mutation(internal.operatorMcpReadCalls.prepare, {
      ...input,
      operatorUserId: outsider,
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(internal.operatorMcpReadCalls.prepare, {
      ...input,
      toolName: "set_client_assignee",
      input: { orgId: "invalid", operatorUserId },
    }),
  ).rejects.toThrow();
  await t.mutation(internal.operatorMcpReadCalls.finish, {
    operatorUserId,
    runId: first.runId,
    content: "Completed",
    toolName: "list_operators",
    input: {},
    outcome: { status: "succeeded", result: [] },
  });
  expect(await t.run((ctx) => ctx.db.get(first.threadId))).toEqual(before);
});
