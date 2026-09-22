/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modelCallContext, modelCallResult } from "./lib/modelCallTelemetry";
const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "logs@claritylabs.inc",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "logs@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return userId;
  });
  return { t, viewer: t.withIdentity({ subject: `${userId}|session` }) };
}
const context = {
  task: "chat",
  taskKind: "operator_agent",
  channel: "web",
  sessionKey: "test-session",
};
test("one invocation has one usage record despite repeated starts and terminal callbacks", async () => {
  const { t, viewer } = await fixture();
  const id = await t.mutation(internal.modelRoutingEvents.startCall, {
    callKey: "unique",
    operation: "generate",
    context,
  });
  expect(
    await t.mutation(internal.modelRoutingEvents.startCall, {
      callKey: "unique",
      operation: "generate",
      context,
    }),
  ).toBe(id);
  await t.mutation(internal.modelRoutingEvents.finishCall, {
    callKey: "unique",
    status: "complete",
    result: {
      model: "example",
      inputTokens: 123,
      outputTokens: 45,
      costUsd: 0.02,
    },
  });
  await t.mutation(internal.modelRoutingEvents.finishCall, {
    callKey: "unique",
    status: "error",
    error: "late duplicate",
  });
  await t.mutation(internal.modelRoutingEvents.recordRunInternal, {
    run: {
      ...context,
      runId: "test-session",
      label: "summary",
      phase: "complete",
    },
    status: "complete",
    inputTokens: 123,
    outputTokens: 45,
    toolCallCount: 0,
    completedToolCount: 0,
    toolNames: [],
    workflowOutcomeCount: 0,
    workflowFailureCount: 0,
  });
  const call = await viewer.query(api.modelRoutingEvents.getCall, { id });
  expect(call).toMatchObject({
    status: "complete",
    inputTokens: 123,
    costUsd: 0.02,
  });
  const rows = await t.run((ctx) =>
    ctx.db
      .query("modelRoutingEvents")
      .withIndex("kind_time", (q) => q.eq("kind", "call"))
      .take(100),
  );
  expect(rows).toHaveLength(1);
  await expect(
    t.query(api.modelRoutingEvents.getCall, { id }),
  ).rejects.toThrow();
  const customerId = await t.run((ctx) =>
    ctx.db.insert("users", { accountKind: "customer" }),
  );
  await expect(
    t
      .withIdentity({ subject: `${customerId}|session` })
      .query(api.modelRoutingEvents.getCall, { id }),
  ).rejects.toThrow();
});
test("metadata logging never stores request bodies, asset URLs, or response content and keeps unknown cost unknown", () => {
  const ctx = modelCallContext({
    task: "extraction",
    prompt: "private",
    trace: { channel: "worker" },
    routing: { pin: { provider: "google", model: "example" } },
    audio: { url: "secret" },
  });
  expect(ctx).toMatchObject({
    channel: "worker",
    model: "example",
    routeSource: "override",
  });
  expect(JSON.stringify(ctx)).not.toMatch(/private|secret/);
  expect(
    modelCallContext({
      primitive: "multimodal",
      trace: {
        traceId: "trace-1",
        tags: {
          task: "extraction",
          taskKind: "extraction_focused",
          channel: "worker",
        },
      },
    }),
  ).toMatchObject({
    task: "extraction",
    taskKind: "extraction_focused",
    channel: "worker",
    runId: "trace-1",
  });
  const result = modelCallResult({
    output: "private",
    costUsd: null,
    model: { model: "example" },
    usage: { inputTokens: 10, outputTokens: 0 },
  });
  expect(result.costUsd).toBeNull();
  expect(result.inputTokens).toBe(10);
  expect(result).not.toHaveProperty("output");
});

test("search follows cursors past nonmatching calls and rejects non-operator listing", async () => {
  const { t, viewer } = await fixture();
  for (let index = 0; index < 4; index++) {
    await t.mutation(internal.modelRoutingEvents.startCall, {
      callKey: `search-${index}`,
      operation: "generate",
      context: { ...context, task: index === 0 ? "older_match" : "chat" },
    });
  }
  const from = 0,
    to = 30 * 86400_000;
  await t.run(async (ctx) => {
    const rows = await ctx.db.query("modelRoutingEvents").take(10);
    for (const [index, row] of rows.entries())
      await ctx.db.patch(row._id, { timestamp: 1000 + index });
  });
  const args = {
    from,
    to,
    search: "older_match",
    paginationOpts: { cursor: null, numItems: 2 },
  };
  await expect(
    t.query(api.modelRoutingEvents.listCalls, args),
  ).rejects.toThrow();
  const first = await viewer.query(api.modelRoutingEvents.listCalls, args);
  expect(first.page).toHaveLength(0);
  expect(first.isDone).toBe(false);
  const second = await viewer.query(api.modelRoutingEvents.listCalls, {
    ...args,
    paginationOpts: { ...args.paginationOpts, cursor: first.continueCursor },
  });
  expect(second.page.map((call) => call.task)).toEqual(["older_match"]);
  expect(second.isDone).toBe(true);
});

test("prices decision nano-dollars and uses inclusive router totals without adding selector cost twice", () => {
  expect(
    modelCallResult({
      model: "jev-1",
      cost: { status: "priced", costNanoUsd: 42 },
      usage: { inputTokens: 1, outputTokens: 0 },
    }),
  ).toMatchObject({ model: "jev-1", costUsd: 0.000000042 });
  expect(
    modelCallResult({
      costUsd: 0.1,
      routing: {
        selection: { costNanoUsd: 1000000, totalCostNanoUsd: 101000000 },
      },
    }).costUsd,
  ).toBe(0.101);
  expect(
    modelCallResult({
      costUsd: 0.1,
      routing: { selection: { costNanoUsd: null, totalCostNanoUsd: null } },
    }).costUsd,
  ).toBeNull();
});

test("payload previews omit assets and credentials and remain bounded", async () => {
  const { modelCallPayloadPreview } = await import("./lib/modelCallTelemetry");
  const preview = modelCallPayloadPreview({
    messages: [
      {
        content: [
          {
            type: "image",
            source: {
              url: "https://private.example/router-jobs/asset?token=secret",
            },
          },
          { type: "text", text: "Review the policy" },
        ],
      },
    ],
    audio: { base64: "private-binary" },
    secret: "private-key",
    response: "x".repeat(20000),
  });
  expect(preview).not.toMatch(/private\.example|private-binary|private-key/);
  expect(preview).toContain("Review the policy");
  expect(preview).toContain("[truncated]");
  expect(preview.length).toBeLessThan(128100);
  const { t } = await fixture();
  const id = await t.mutation(internal.modelRoutingEvents.startCall, {
    callKey: "private",
    operation: "generate",
    context,
  });
  await expect(
    t.action(api.actions.modelCallLogs.payload, { id }),
  ).rejects.toThrow();
});

test("completed empty responses remain visible as incomplete calls", async () => {
  const { t, viewer } = await fixture();
  const id = await t.mutation(internal.modelRoutingEvents.startCall, {
    callKey: "empty",
    operation: "generate",
    context,
  });
  await t.mutation(internal.modelRoutingEvents.finishCall, {
    callKey: "empty",
    status: "complete",
    result: modelCallResult({
      output: { text: "", toolCalls: [] },
      finishReason: "stop",
      costUsd: 0.01,
    }),
  });
  expect(
    await viewer.query(api.modelRoutingEvents.getCall, { id }),
  ).toMatchObject({
    status: "incomplete",
    completionIssue: "empty_response",
    costUsd: 0.01,
  });
});
