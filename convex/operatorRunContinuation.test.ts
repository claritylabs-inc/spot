/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { OPERATOR_INLINE_CONTINUATION_BYTES } from "./lib/operatorAgentContinuation";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

// Crash resume: a run only ever points at a continuation committed in the
// same transaction (inline) or stored before it (blob). A fresh action must
// read back the exact text for the checkpointed iteration; stale checkpoints
// never install theirs, and replacing or ending a continuation removes the
// previous one in either form.
test("inline continuations commit with their checkpoint and resume exactly", async () => {
  const t = convexTest(schema, modules);
  const runId = await t.run(async (ctx) => {
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
    return ctx.db.insert("operatorAgentRuns", {
      operatorUserId: ownerUserId,
      threadId,
      userMessageId: messageId,
      agentMessageId: messageId,
      objective: "Task",
      status: "running",
      runnerAttempt: 1,
      checkpoint: { iteration: 0, executionCount: 0 },
      createdAt: 0,
      updatedAt: 0,
    });
  });
  const getRun = () => t.run((ctx) => ctx.db.get(runId));
  const documents = () =>
    t.run((ctx) => ctx.db.query("operatorRunContinuations").take(10));
  const blobs = () => t.run((ctx) => ctx.db.system.query("_storage").take(10));
  const step = (
    iteration: number,
    continuation:
      | { modelContinuation: string }
      | { modelContinuationStorageId: Id<"_storage"> },
  ) =>
    t.mutation(internal.operatorAgent.continueRunInternal, {
      runId,
      expectedRunnerAttempt: 1,
      expectedCheckpointIteration: iteration,
      inline: true,
      summary: "",
      usedTools: [],
      toolCalls: [],
      ...continuation,
    });
  const first = JSON.stringify({ messages: [{ role: "user", content: "A" }] });

  const continued = await step(0, { modelContinuation: first });
  expect(continued?.status).toBe("continued");
  const run = (await getRun())!;
  expect(run.checkpoint?.iteration).toBe(1);
  expect(run.modelContinuationStorageId).toBeUndefined();
  expect(run.modelContinuationId).toBe(
    continued && "modelContinuationId" in continued
      ? continued.modelContinuationId
      : undefined,
  );
  expect(
    await t.query(internal.operatorAgent.getRunContinuationInternal, {
      id: run.modelContinuationId!,
    }),
  ).toBe(first);

  // A stale checkpoint never installs its continuation.
  expect((await step(0, { modelContinuation: "stale" }))?.status).toBe(
    "not_continued",
  );
  expect(await documents()).toHaveLength(1);
  // An oversized inline continuation is rejected with nothing committed.
  await expect(
    step(1, {
      modelContinuation: "x".repeat(OPERATOR_INLINE_CONTINUATION_BYTES + 1),
    }),
  ).rejects.toThrow("too large");
  expect((await getRun())?.checkpoint?.iteration).toBe(1);

  // A blob replaces the inline document, and inline replaces the blob.
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["{\"messages\":[]}"])),
  );
  await step(1, { modelContinuationStorageId: storageId });
  expect((await getRun())?.modelContinuationId).toBeUndefined();
  expect(await documents()).toHaveLength(0);
  await step(2, { modelContinuation: first });
  expect((await getRun())?.modelContinuationStorageId).toBeUndefined();
  expect(await blobs()).toHaveLength(0);
  expect(await documents()).toHaveLength(1);

  await t.mutation(internal.operatorAgent.failRunInternal, {
    runId,
    expectedRunnerAttempt: 1,
    error: "failed",
  });
  const failed = (await getRun())!;
  expect(failed.modelContinuationId).toBeUndefined();
  expect(await documents()).toHaveLength(0);
});
