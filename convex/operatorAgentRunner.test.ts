/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/models")>()),
  generateAgentTextForOperatorTask: generate,
}));
const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  generate.mockReset();
});

test("pauses a batch at its first approval, preserves research, and resumes without accepting stale completion", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const operatorUserId = await ctx.db.insert("users", {
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
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Miller Brokerage",
      type: "broker",
      website: "https://miller.example",
    });
    await ctx.db.insert("brokerProfiles", {
      brokerOrgId,
      networkStatus: "prospect",
      writingStates: ["NY"],
      lineOfBusinessCodes: ["CGL"],
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, brokerOrgId };
  });
  const threadId = await t.mutation(
    internal.operatorAgent.createOrGetChannelThreadInternal,
    {
      operatorUserId: ids.operatorUserId,
      channel: "slack",
      conversationKey: "research-brokers",
    },
  );
  const evidence =
    "https://miller.example/about lists New York and California offices";
  let firstSegmentFinished = false;
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const readInput = { brokerOrgId: ids.brokerOrgId };
    const read =
      await options.tools.get_broker_network_profile.execute(readInput);
    const firstInput = {
      ...readInput,
      writingStates: ["NY", "CA"],
      website: null,
      evidence,
    };
    const secondInput = { ...readInput, networkStatus: "active" };
    const [first, second] = await Promise.all([
      options.tools.update_broker_network_profile.execute(firstInput),
      options.tools.update_broker_network_profile.execute(secondInput),
    ]);
    expect(first.status).toBe("confirmation_required");
    expect(second.status).toBe("blocked_by_confirmation");
    const paused = await t.query(
      internal.operatorAgent.getPendingConfirmationInternal,
      { operatorUserId: ids.operatorUserId, threadId },
    );
    if (!paused) throw new Error("Missing approval");
    const pausedRun = await t.run((ctx) => ctx.db.get(queued.runId));
    expect(pausedRun?.checkpoint?.summary).toContain("miller.example");
    expect(await options.stopWhen[1]({ steps: [] })).toBe(true);
    firstSegmentFinished = true;
    return {
      text: "The operator run expired.",
      steps: [
        {
          toolCalls: [
            { toolName: "get_broker_network_profile", input: readInput },
            { toolName: "update_broker_network_profile", input: firstInput },
            { toolName: "update_broker_network_profile", input: secondInput },
          ],
          toolResults: [
            { toolName: "get_broker_network_profile", output: read },
            { toolName: "update_broker_network_profile", output: first },
            { toolName: "update_broker_network_profile", output: second },
          ],
        },
      ],
    };
  });
  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      channel: "slack",
      content: "Research and update all broker profiles",
      dedupeKey: "research",
    },
  );
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(firstSegmentFinished).toBe(true);
  const waiting = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    { operatorUserId: ids.operatorUserId, runId: queued.runId },
  );
  expect(waiting.run.status).toBe("waiting_confirmation");
  expect(waiting.response?.content).not.toContain("expired");
  expect(waiting.run.checkpoint?.summary).toContain("miller.example");
  const confirmation = await t.query(
    internal.operatorAgent.getPendingConfirmationInternal,
    { operatorUserId: ids.operatorUserId, threadId },
  );
  expect(confirmation?.summary).toContain("NY → NY, CA");
  expect(confirmation?.summary).toContain("https://miller.example → Not set");
  expect(confirmation?.summary).toContain(evidence);
  expect(confirmation?.summary).not.toContain(ids.brokerOrgId);
  expect(await t.run((ctx) => ctx.db.get(ids.brokerOrgId))).toHaveProperty(
    "website",
    "https://miller.example",
  );
  if (!confirmation) throw new Error("Missing approval");

  await t.mutation(internal.operatorAgent.failRunInternal, {
    runId: queued.runId,
    expectedCheckpointIteration: 0,
    error: "late provider failure",
  });
  expect(await t.run((ctx) => ctx.db.get(confirmation._id))).toHaveProperty(
    "status",
    "pending",
  );
  await t.mutation(internal.operatorAgent.confirmActionInternal, {
    operatorUserId: ids.operatorUserId,
    threadId,
    confirmationId: confirmation._id,
    decision: "approve",
    channel: "slack",
  });
  expect(
    await t.mutation(internal.operatorAgent.completeRunInternal, {
      runId: queued.runId,
      expectedCheckpointIteration: 0,
      content: "stale completion",
      usedTools: [],
      toolCalls: [],
    }),
  ).toEqual({ status: "not_completed" });
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    expect(options.system).toContain("miller.example");
    expect(options.system).toContain("networkStatus");
    return {
      text: "The approved broker update is complete. Remaining research found no supported changes.",
      steps: [],
    };
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(ids.brokerOrgId))).not.toHaveProperty(
    "website",
  );
  const profile = await t.run((ctx) =>
    ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
      .unique(),
  );
  expect(profile).toMatchObject({
    writingStates: ["CA", "NY"],
    networkStatus: "prospect",
  });
  const finished = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    { operatorUserId: ids.operatorUserId, runId: queued.runId },
  );
  expect(finished.run.status).toBe("completed");
  expect(generate).toHaveBeenCalledTimes(2);
});
