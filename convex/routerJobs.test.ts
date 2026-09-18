/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { routerJobTokenHash } from "./routerJobs";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = convexTest(schema, modules);
  const requestStorageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(['{"prompt":"test"}'], { type: "application/json" }),
    ),
  );
  const args = {
    invocationKey: "test:run:step:0",
    operation: "generate" as const,
    callContext: { task: "chat", taskKind: "test", channel: "web", sessionKey: "test" },
    fingerprint: "a".repeat(64),
    requestToken: "b".repeat(64),
    requestTokenHash: await routerJobTokenHash("b".repeat(64)),
    resultToken: "c".repeat(64),
    resultTokenHash: await routerJobTokenHash("c".repeat(64)),
    requestStorageId,
  };
  const row = await t.mutation(internal.routerJobs.prepare, args);
  return { t, args, row };
}

test("prepares one invocation and rejects conflicting identities", async () => {
  const { t, args, row } = await fixture();
  expect((await t.mutation(internal.routerJobs.prepare, args))._id).toBe(
    row._id,
  );
  await expect(
    t.mutation(internal.routerJobs.prepare, {
      ...args,
      fingerprint: "d".repeat(64),
    }),
  ).rejects.toThrow("identity conflict");
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestToken,
      purpose: "request",
    }),
  ).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.authorize, {
        tokenHash: args.requestTokenHash,
        purpose: "request",
      })
    )?._id,
  ).toBe(row._id);
});

test("accepts callback before submission ACK, binds identity, and removes duplicate result uploads", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const resultId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"done"}'])),
  );
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    status: "succeeded" as const,
    storageId: resultId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(true);
  const calls = await t.run(ctx => ctx.db.query("modelRoutingEvents").withIndex("call", q => q.eq("callKey", args.invocationKey)).take(2));
  expect(calls).toHaveLength(1);
  expect(calls[0].status).toBe("complete");
  await t.mutation(internal.routerJobs.bind, {
    id: row._id,
    jobId: "router-1",
  });
  await expect(
    t.mutation(internal.routerJobs.bind, {
      id: row._id,
      jobId: "router-other",
    }),
  ).rejects.toThrow("identity conflict");
  const duplicateId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"other"}'])),
  );
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      storageId: duplicateId,
    }),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(duplicateId))).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.get, {
        invocationKey: args.invocationKey,
      })
    )?.resultStorageId,
  ).toBe(resultId);
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestTokenHash,
      purpose: "request",
    }),
  ).toBeNull();
});

test("rejects wrong callback identity and cancellation races without retaining uploaded results", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const makeResult = () => t.run((ctx) => ctx.storage.store(new Blob(["{}"])));
  const storageId = await makeResult();
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: "e".repeat(64),
    status: "succeeded" as const,
    storageId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  const cancelledResultId = await makeResult();
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      fingerprint: args.fingerprint,
      storageId: cancelledResultId,
    }),
  ).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(cancelledResultId))).toBeNull();
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.resultTokenHash,
      purpose: "result",
    }),
  ).toBeNull();
});

test("cleanup never expires active work and retains a terminal idempotency tombstone", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
  await t.mutation(internal.routerJobs.cleanup, { id: row._id });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const terminal = await t.query(internal.routerJobs.get, {
    invocationKey: args.invocationKey,
  });
  expect(terminal?.status).toBe("cancelled");
  expect(terminal?.requestStorageId).toBeUndefined();
  expect(terminal?.requestToken).toBe("");
  expect(
    await t.run((ctx) => ctx.storage.get(args.requestStorageId)),
  ).toBeNull();
});

test("upload cleanup preserves adopted blobs after a lost mutation acknowledgement", async () => {
  const { t, args } = await fixture();
  const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["orphan"])));
  await t.mutation(internal.routerJobs.cleanupUploads, {
    invocationKey: args.invocationKey,
    storageIds: [args.requestStorageId, orphan],
  });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
});

test("streams ordered snapshots only to the active message and rejects stale or foreign callbacks", async () => {
  const { t, args, row } = await fixture();
  const target = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Client" });
    const userId = await ctx.db.insert("users", { name: "Viewer" });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Chat",
      lastMessageAt: 0,
    });
    const id = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
    await ctx.db.patch(row._id, { streamTarget: id });
    return id;
  });
  const progress = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    sequence: 2,
    text: "The renewal costs",
  };
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      tokenHash: "wrong",
    }),
  ).toBe(false);
  expect(await t.mutation(internal.routerJobs.progress, progress)).toBe(true);
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 1,
      text: "The",
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      jobId: "another",
      sequence: 3,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe(
    "The renewal costs",
  );
  await t.run((ctx) =>
    ctx.db.patch(target, {
      status: "cancelled",
      content: "Response cancelled.",
    }),
  );
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 3,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe(
    "Response cancelled.",
  );
});

test("terminal jobs never replace the final reply with delayed progress", async () => {
  vi.useFakeTimers();
  const { t, row, args } = await fixture();
  const target = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Client" });
    const userId = await ctx.db.insert("users", { name: "Viewer" });
    const threadId = await ctx.db.insert("threads", {
      orgId,
      createdBy: userId,
      title: "Chat",
      lastMessageAt: 0,
    });
    const id = await ctx.db.insert("threadMessages", {
      threadId,
      orgId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
    });
    await ctx.db.patch(row._id, { streamTarget: id });
    return id;
  });
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  expect(
    await t.mutation(internal.routerJobs.progress, {
      id: row._id,
      tokenHash: args.resultTokenHash,
      jobId: "router-1",
      invocationKey: args.invocationKey,
      fingerprint: args.fingerprint,
      sequence: 1,
      text: "late",
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(target)))?.content).toBe("");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test("operator streaming survives durable polling yields but fences approval waits and old checkpoints", async () => {
  const { t, args, row } = await fixture();
  const { runId, messageId, invocationKey } = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { name: "Operator" });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId,
      visibility: "private",
      channel: "chat",
      title: "Task",
      lastMessageAt: 0,
      createdAt: 0,
      updatedAt: 0,
    });
    const messageId = await ctx.db.insert("operatorAgentMessages", {
      ownerUserId,
      threadId,
      channel: "chat",
      role: "agent",
      content: "",
      status: "processing",
      createdAt: 0,
      updatedAt: 0,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      operatorUserId: ownerUserId,
      threadId,
      userMessageId: messageId,
      agentMessageId: messageId,
      objective: "Task",
      status: "queued",
      checkpoint: { iteration: 0, executionCount: 0 },
      createdAt: 0,
      updatedAt: 0,
    });
    const invocationKey = `operator:${runId}:0:0`;
    await ctx.db.patch(row._id, { streamTarget: messageId, invocationKey });
    return { runId, messageId, invocationKey };
  });
  const progress = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey,
    fingerprint: args.fingerprint,
    sequence: 1,
    text: "Live reply",
  };
  expect(await t.mutation(internal.routerJobs.progress, progress)).toBe(true);
  await t.run((ctx) => ctx.db.patch(runId, { status: "waiting_confirmation" }));
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 2,
    }),
  ).toBe(false);
  await t.run((ctx) =>
    ctx.db.patch(runId, {
      status: "running",
      checkpoint: { iteration: 1, executionCount: 0 },
    }),
  );
  expect(
    await t.mutation(internal.routerJobs.progress, {
      ...progress,
      sequence: 2,
    }),
  ).toBe(false);
  expect((await t.run((ctx) => ctx.db.get(messageId)))?.content).toBe(
    "Live reply",
  );
});
