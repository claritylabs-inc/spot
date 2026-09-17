/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { RouterJobPending } from "./lib/routerJobClient";
import { seedRequestIntake } from "./lib/procurementNarrative";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("./lib/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/models")>()),
  generateAgentTextForOperatorTask: generate,
}));
const modules = import.meta.glob("./**/*.ts");

async function finishOperatorSchedules(t: ReturnType<typeof convexTest>) {
  // An action must finish before fake time reaches its abandoned-action watchdog.
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    await t.finishInProgressScheduledFunctions();
    if (vi.getTimerCount() === 0) return;
    vi.advanceTimersToNextTimer();
  }
  throw new Error("Operator schedules did not settle");
}

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
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Exact confirmation step" }],
      },
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
  await finishOperatorSchedules(t);
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
  expect(confirmation?.summary).toContain("from NY to NY, CA");
  expect(confirmation?.summary).toContain(
    "Clear website (currently https://miller.example)",
  );
  expect(confirmation?.summary).not.toContain(ids.brokerOrgId);
  expect(await t.run((ctx) => ctx.db.get(ids.brokerOrgId))).toHaveProperty(
    "website",
    "https://miller.example",
  );
  if (!confirmation) throw new Error("Missing approval");
  const savedConfirmation = await t.run((ctx) => ctx.db.get(confirmation._id));
  expect(JSON.parse(savedConfirmation!.payload.input)).toHaveProperty(
    "evidence",
    evidence,
  );

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
    expect(options.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Exact confirmation step",
    });
    return {
      text: "The approved broker update is complete. Remaining research found no supported changes.",
      steps: [],
    };
  });
  await finishOperatorSchedules(t);
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

test("recovers from a confirmed no-write validation failure with a fresh approval and one write", async () => {
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
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Recovery Fixture Client",
      type: "client",
    });
    const procurementRequestId = await ctx.db.insert("procurementRequests", {
      clientOrgId,
      title: "Controlled recovery",
      status: "draft",
      clientVisible: false,
      packetRevision: 0,
      inboxToken: "controlled-recovery",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    await seedRequestIntake(ctx, {
      requestId: procurementRequestId,
      clientOrgId: clientOrgId,
      userId: operatorUserId,
      narrative: "Test the operator runner's safe correction path.",
      source: "operator_agent",
    });
    const fileId = await ctx.storage.store(new Blob(["application"]));
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: clientOrgId,
      fileId,
      name: "Application.pdf",
      originalName: "Application.pdf",
      contentType: "application/pdf",
      size: 11,
      clientVisible: false,
      uploadedByUserId: operatorUserId,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const replacementClientFileId = await ctx.db.insert("clientFiles", {
      orgId: clientOrgId,
      fileId,
      name: "Replacement application.pdf",
      originalName: "Replacement application.pdf",
      contentType: "application/pdf",
      size: 11,
      clientVisible: false,
      uploadedByUserId: operatorUserId,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });
    return {
      operatorUserId,
      procurementRequestId,
      clientFileId,
      replacementClientFileId,
    };
  });
  const threadId = await t.mutation(
    internal.operatorAgent.createOrGetChannelThreadInternal,
    {
      operatorUserId: ids.operatorUserId,
      channel: "slack",
      conversationKey: "confirmed-safe-recovery",
    },
  );
  const invalidInput = {
    procurementRequestId: ids.procurementRequestId,
    clientFileId: ids.clientFileId,
    label: "Signed application",
    clientVisible: true,
  };
  const correctedInput = {
    procurementRequestId: ids.procurementRequestId,
    clientFileId: ids.replacementClientFileId,
    label: "Signed application",
    clientVisible: true,
  };

  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const result =
      await options.tools.create_procurement_file_item.execute(invalidInput);
    expect(result.status).toBe("confirmation_required");
    return {
      text: "Waiting for confirmation.",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Exact confirmation step" }],
      },
      steps: [
        {
          toolCalls: [
            {
              toolName: "create_procurement_file_item",
              input: invalidInput,
            },
          ],
          toolResults: [
            { toolName: "create_procurement_file_item", output: result },
          ],
        },
      ],
    };
  });
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    expect(options.system).toContain(
      "Client file is unavailable or belongs to another client",
    );
    expect(options.system).toContain('"writeState":"not_started"');
    const result =
      await options.tools.create_procurement_file_item.execute(correctedInput);
    expect(result.status).toBe("confirmation_required");
    return {
      text: "Waiting for corrected confirmation.",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Exact confirmation step" }],
      },
      steps: [
        {
          toolCalls: [
            {
              toolName: "create_procurement_file_item",
              input: correctedInput,
            },
          ],
          toolResults: [
            { toolName: "create_procurement_file_item", output: result },
          ],
        },
      ],
    };
  });
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    expect(options.system).toContain("Signed application");
    return {
      text: "The corrected file item was added once.",
      steps: [],
    };
  });

  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      channel: "slack",
      content: "Track the signed application",
      dedupeKey: "safe-recovery",
    },
  );
  await finishOperatorSchedules(t);
  const firstConfirmation = await t.query(
    internal.operatorAgent.getPendingConfirmationInternal,
    { operatorUserId: ids.operatorUserId, threadId },
  );
  if (!firstConfirmation) throw new Error("Missing first confirmation");

  await t.run((ctx) =>
    ctx.db.patch(ids.clientFileId, { archivedAt: dayjs().valueOf() }),
  );
  const firstResolution = await t.mutation(
    internal.operatorAgent.confirmActionInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      confirmationId: firstConfirmation._id,
      decision: "approve",
      channel: "slack",
    },
  );
  expect(firstResolution).toMatchObject({
    status: "queued",
    result: {
      status: "failed",
      error: "Client file is unavailable or belongs to another client",
      failure: {
        code: "invalid_client_file",
        phase: "execution",
        recoverable: true,
        writeState: "not_started",
      },
    },
  });
  expect(
    await t.run((ctx) => ctx.db.query("procurementFileItems").collect()),
  ).toHaveLength(0);

  await finishOperatorSchedules(t);
  const secondConfirmation = await t.query(
    internal.operatorAgent.getPendingConfirmationInternal,
    { operatorUserId: ids.operatorUserId, threadId },
  );
  if (!secondConfirmation) throw new Error("Missing corrected confirmation");
  expect(secondConfirmation._id).not.toBe(firstConfirmation._id);
  const confirmationRows = await t.run(async (ctx) => ({
    first: await ctx.db.get(firstConfirmation._id),
    second: await ctx.db.get(secondConfirmation._id),
  }));
  expect(confirmationRows.first?.status).toBe("completed");
  expect(confirmationRows.first?.payload.inputHash).not.toBe(
    confirmationRows.second?.payload.inputHash,
  );
  expect(
    await t.run((ctx) => ctx.db.query("procurementFileItems").collect()),
  ).toHaveLength(0);

  const secondResolution = await t.mutation(
    internal.operatorAgent.confirmActionInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      confirmationId: secondConfirmation._id,
      decision: "approve",
      channel: "slack",
    },
  );
  expect(secondResolution).toMatchObject({
    status: "queued",
    result: { status: "succeeded", idempotent: false },
  });
  expect(
    await t.mutation(internal.operatorAgent.confirmActionInternal, {
      operatorUserId: ids.operatorUserId,
      threadId,
      confirmationId: secondConfirmation._id,
      decision: "approve",
      channel: "slack",
    }),
  ).toEqual({ status: "needs_refresh", runId: queued.runId });

  await finishOperatorSchedules(t);
  const items = await t.run((ctx) =>
    ctx.db.query("procurementFileItems").collect(),
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    requestId: ids.procurementRequestId,
    label: "Signed application",
    clientVisible: true,
  });
  const audits = await t.run((ctx) =>
    ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (q) => q.eq("runId", queued.runId))
      .collect(),
  );
  expect(audits).toHaveLength(2);
  expect(audits.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
  expect(audits[0]).toMatchObject({
    operatorConfirmationId: firstConfirmation._id,
    error: "Client file is unavailable or belongs to another client",
  });
  expect(audits[1]?.operatorConfirmationId).toBe(secondConfirmation._id);
  const finished = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    { operatorUserId: ids.operatorUserId, runId: queued.runId },
  );
  expect(finished.run.status).toBe("completed");
  expect(generate).toHaveBeenCalledTimes(3);
});

test("corrects an invented ACORD code before approval and preserves an omitted website", async () => {
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
      name: "BLIS Fixture",
      type: "broker",
      website: "https://www.blisins.com/",
    });
    await ctx.db.insert("brokerProfiles", {
      brokerOrgId,
      networkStatus: "prospect",
      writingStates: ["CA"],
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
      conversationKey: "blis-acord-correction",
    },
  );
  const evidence = "Broker approval email received 2026-09-14";
  const correctedInput = {
    brokerOrgId: ids.brokerOrgId,
    lineOfBusinessCodes: ["CGL", "PROP", "AUTOB"],
    evidence,
  };
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const invalidCode =
      await options.tools.update_broker_network_profile.execute({
        ...correctedInput,
        lineOfBusinessCodes: ["CGL", "PROP", "CAUT"],
      });
    expect(invalidCode).toMatchObject({
      status: "failed",
      failure: {
        phase: "preflight",
        recoverable: true,
        writeState: "not_started",
      },
    });
    const staleTarget =
      await options.tools.update_broker_network_profile.execute({
        ...correctedInput,
        brokerOrgId: "missing-broker-id",
      });
    expect(staleTarget).toMatchObject({
      status: "failed",
      failure: {
        phase: "preflight",
        recoverable: true,
        writeState: "not_started",
      },
    });
    const result =
      await options.tools.update_broker_network_profile.execute(correctedInput);
    expect(result.status).toBe("confirmation_required");
    return {
      text: "Waiting for the corrected approval.",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Exact confirmation step" }],
      },
      steps: [
        {
          toolCalls: [
            {
              toolName: "update_broker_network_profile",
              input: {
                ...correctedInput,
                lineOfBusinessCodes: ["CGL", "PROP", "CAUT"],
              },
            },
            {
              toolName: "update_broker_network_profile",
              input: { ...correctedInput, brokerOrgId: "missing-broker-id" },
            },
            {
              toolName: "update_broker_network_profile",
              input: correctedInput,
            },
          ],
          toolResults: [
            {
              toolName: "update_broker_network_profile",
              output: invalidCode,
            },
            {
              toolName: "update_broker_network_profile",
              output: staleTarget,
            },
            {
              toolName: "update_broker_network_profile",
              output: result,
            },
          ],
        },
      ],
    };
  });
  generate.mockImplementationOnce(async () => ({
    text: "BLIS was updated with the corrected ACORD code.",
    steps: [],
  }));

  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      channel: "slack",
      content: "Update BLIS from the latest approval email",
      dedupeKey: "blis-acord",
    },
  );
  await finishOperatorSchedules(t);
  const confirmation = await t.query(
    internal.operatorAgent.getPendingConfirmationInternal,
    { operatorUserId: ids.operatorUserId, threadId },
  );
  if (!confirmation) throw new Error("Missing corrected approval");
  expect(confirmation.summary).toContain("Automobile - Business");
  expect(confirmation.summary).not.toContain("CAUT");
  expect(confirmation.summary).not.toContain("Website");
  expect(
    await t.run((ctx) => ctx.db.query("agentActionAuditEvents").collect()),
  ).toHaveLength(1);

  await t.mutation(internal.operatorAgent.confirmActionInternal, {
    operatorUserId: ids.operatorUserId,
    threadId,
    confirmationId: confirmation._id,
    decision: "approve",
    channel: "slack",
  });
  await finishOperatorSchedules(t);

  const broker = await t.run(async (ctx) => ({
    organization: await ctx.db.get(ids.brokerOrgId),
    profile: await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
      .unique(),
  }));
  expect(broker.organization?.website).toBe("https://www.blisins.com/");
  expect(broker.profile?.lineOfBusinessCodes).toEqual(["AUTOB", "CGL", "PROP"]);
  const audits = await t.run((ctx) =>
    ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (q) => q.eq("runId", queued.runId))
      .collect(),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    status: "succeeded",
    operatorConfirmationId: confirmation._id,
  });
  const finished = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    { operatorUserId: ids.operatorUserId, runId: queued.runId },
  );
  expect(finished.run.status).toBe("completed");
  expect(generate).toHaveBeenCalledTimes(2);
});

test("resumes when approval-time preflight proves the target stale without writing", async () => {
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
      name: "Stale Target Brokerage",
      type: "broker",
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
      conversationKey: "approval-preflight-recovery",
    },
  );
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const input = {
      brokerOrgId: ids.brokerOrgId,
      networkStatus: "active" as const,
      evidence: "Controlled fixture evidence",
    };
    const result =
      await options.tools.update_broker_network_profile.execute(input);
    return {
      text: "Waiting for approval.",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [{ role: "assistant", content: "Exact confirmation step" }],
      },
      steps: [
        {
          toolCalls: [{ toolName: "update_broker_network_profile", input }],
          toolResults: [
            { toolName: "update_broker_network_profile", output: result },
          ],
        },
      ],
    };
  });
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    expect(options.system).toContain('"phase":"preflight"');
    expect(options.system).toContain('"writeState":"not_started"');
    return {
      text: "The target no longer exists, so no update was made.",
      steps: [],
    };
  });

  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      channel: "slack",
      content: "Activate the brokerage if it still exists",
      dedupeKey: "approval-preflight",
    },
  );
  await finishOperatorSchedules(t);
  const confirmation = await t.query(
    internal.operatorAgent.getPendingConfirmationInternal,
    { operatorUserId: ids.operatorUserId, threadId },
  );
  if (!confirmation) throw new Error("Missing confirmation");
  await t.run((ctx) => ctx.db.delete(ids.brokerOrgId));

  const resolution = await t.mutation(
    internal.operatorAgent.confirmActionInternal,
    {
      operatorUserId: ids.operatorUserId,
      threadId,
      confirmationId: confirmation._id,
      decision: "approve",
      channel: "slack",
    },
  );
  expect(resolution).toMatchObject({
    status: "queued",
    result: {
      status: "failed",
      failure: {
        phase: "preflight",
        recoverable: true,
        writeState: "not_started",
      },
    },
  });
  await finishOperatorSchedules(t);

  const audit = await t.run((ctx) =>
    ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (q) => q.eq("runId", queued.runId))
      .unique(),
  );
  expect(audit).toMatchObject({
    status: "failed",
    operatorConfirmationId: confirmation._id,
  });
  expect(audit?.error).toContain("Broker organization not found");
  expect(await t.run((ctx) => ctx.db.get(confirmation._id))).toHaveProperty(
    "status",
    "completed",
  );
  const finished = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    { operatorUserId: ids.operatorUserId, runId: queued.runId },
  );
  expect(finished.run.status).toBe("completed");
  expect(generate).toHaveBeenCalledTimes(2);
});

test("resumes pending inference and checkpoints auto-approved writes without duplicate execution", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "terry@claritylabs.inc",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "terry@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("operatorAgentSettings", {
      key: "default",
      approveAll: true,
      updatedBy: userId,
      updatedAt: 1,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    return { userId, orgId };
  });
  const threadId = await t.mutation(
    internal.operatorAgent.createOrGetChannelThreadInternal,
    {
      operatorUserId: ids.userId,
      channel: "slack",
      conversationKey: "automatic-batch",
    },
  );
  generate.mockRejectedValueOnce(new RouterJobPending("pending-step"));
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const inputs = ["onboarding", "live"].map((status) => ({
      orgId: ids.orgId,
      status,
    }));
    const results = await Promise.all(
      inputs.map((input) =>
        options.tools.set_organization_status.execute(input),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(await options.stopWhen[1]({ steps: [] })).toBe(false);
    expect(
      await t.query(internal.operatorAgent.getPendingConfirmationInternal, {
        operatorUserId: ids.userId,
        threadId,
      }),
    ).toBeNull();
    return {
      text: "",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      response: {
        messages: [
          {
            role: "tool",
            content: inputs.map((input, index) => ({
              type: "tool-result",
              toolCallId: `call-${index}`,
              toolName: "set_organization_status",
              output: { type: "json", value: results[index] },
            })),
          },
        ],
      },
      steps: [
        {
          toolCalls: inputs.map((input) => ({
            toolName: "set_organization_status",
            input,
          })),
          toolResults: results.map((output) => ({
            toolName: "set_organization_status",
            output,
          })),
        },
      ],
    };
  });
  generate.mockImplementationOnce(async (_ctx, _task, options, run) => {
    expect(options.messages.at(-1).role).toBe("tool");
    expect(run.durable.route).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    return { text: "Cove is now live.", steps: [{ toolCalls: [] }] };
  });
  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.userId,
      threadId,
      channel: "slack",
      content: "Set up Cove and mark it live",
      dedupeKey: "batch",
    },
  );
  await finishOperatorSchedules(t);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[0][3].durable.invocationKey).toBe(
    generate.mock.calls[1][3].durable.invocationKey,
  );
  const result = await t.query(
    internal.operatorAgent.getRunResultForOperatorInternal,
    {
      operatorUserId: ids.userId,
      runId: queued.runId,
    },
  );
  expect(result.run.status).toBe("completed");
  expect(result.run.modelContinuationStorageId).toBeUndefined();
  expect(result.response?.content).toBe("Cove is now live.");
  const state = await t.run(async (ctx) => ({
    org: await ctx.db.get(ids.orgId),
    audit: await ctx.db.query("agentActionAuditEvents").collect(),
    confirmations: await ctx.db.query("operatorAgentConfirmations").collect(),
  }));
  expect(state.org?.operatorStatus).toBe("live");
  expect(state.audit).toHaveLength(2);
  expect(state.audit.every((row) => row.status === "succeeded")).toBe(true);
  expect(state.confirmations).toHaveLength(2);
  expect(
    state.confirmations.every(
      (row) => row.status === "completed" && row.approvalMode === "automatic",
    ),
  ).toBe(true);
});

async function durableOperatorFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "durable@claritylabs.inc",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "durable@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("operatorAgentSettings", {
      key: "default",
      approveAll: true,
      updatedBy: userId,
      updatedAt: 1,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Durable client",
      type: "client",
    });
    return { userId, orgId };
  });
  const threadId = await t.mutation(
    internal.operatorAgent.createOrGetChannelThreadInternal,
    {
      operatorUserId: ids.userId,
      channel: "slack",
      conversationKey: "durable-regression",
    },
  );
  const queued = await t.mutation(
    internal.operatorAgent.enqueueMessageInternal,
    {
      operatorUserId: ids.userId,
      threadId,
      channel: "slack",
      content: "Update the client",
      dedupeKey: "durable-regression",
    },
  );
  return { t, ...ids, threadId, queued };
}

test("cancelling pending inference atomically rejects its late result and prevents queued tool execution", async () => {
  vi.useFakeTimers();
  const { t, userId, orgId, threadId, queued } = await durableOperatorFixture();
  const invocationKey = `operator:${queued.runId}:0:0`;
  const requestStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"prompt":"test"}'])),
  );
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const journal = await t.mutation(internal.routerJobs.prepare, {
      invocationKey,
      operation: "generate",
      fingerprint: "a".repeat(64),
      requestToken: "b".repeat(64),
      requestTokenHash: "b".repeat(64),
      resultToken: "c".repeat(64),
      resultTokenHash: "c".repeat(64),
      requestStorageId,
    });
    await t.mutation(internal.operatorAgent.cancelRunInternal, {
      operatorUserId: userId,
      threadId,
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['{"text":"late"}'])),
    );
    expect(
      await t.mutation(internal.routerJobs.finish, {
        id: journal._id,
        tokenHash: journal.resultTokenHash,
        invocationKey,
        fingerprint: journal.fingerprint,
        jobId: "late-router-id",
        status: "succeeded",
        storageId,
      }),
    ).toBe(false);
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    await expect(
      options.tools.set_organization_status.execute({ orgId, status: "live" }),
    ).rejects.toThrow("no longer active");
    throw new RouterJobPending(invocationKey);
  });
  await finishOperatorSchedules(t);
  expect(generate).toHaveBeenCalledTimes(1);
  const state = await t.run(async (ctx) => ({
    run: await ctx.db.get(queued.runId),
    org: await ctx.db.get(orgId),
    audit: await ctx.db.query("agentActionAuditEvents").collect(),
  }));
  expect(state.run?.status).toBe("cancelled");
  expect(state.org?.operatorStatus).toBeUndefined();
  expect(state.audit).toHaveLength(0);
  expect(
    (await t.query(internal.routerJobs.get, { invocationKey }))?.status,
  ).toBe("cancelled");
});

test("stale pending callbacks cannot queue or replace a newer checkpoint", async () => {
  vi.useFakeTimers();
  const { t, queued } = await durableOperatorFixture();
  expect(
    await t.mutation(internal.operatorAgent.markRunStartedInternal, {
      runId: queued.runId,
    }),
  ).toBe(1);
  const currentStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"messages":[]}'])),
  );
  await t.run((ctx) =>
    ctx.db.patch(queued.runId, {
      checkpoint: {
        iteration: 1,
        executionCount: 2,
        summary: "current evidence",
      },
      modelContinuationStorageId: currentStorageId,
    }),
  );
  await t.mutation(internal.operatorAgent.waitForRouterInternal, {
    runId: queued.runId,
    expectedCheckpointIteration: 0,
  });
  const staleStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"messages":["stale"]}'])),
  );
  expect(
    await t.mutation(internal.operatorAgent.continueRunInternal, {
      runId: queued.runId,
      expectedCheckpointIteration: 0,
      modelContinuationStorageId: staleStorageId,
      summary: "stale evidence",
      usedTools: [],
      toolCalls: [],
    }),
  ).toEqual({ status: "not_continued" });
  await t.mutation(internal.operatorAgent.failRunInternal, {
    runId: queued.runId,
    expectedCheckpointIteration: 0,
    error: "old transport failed",
  });
  const run = await t.run((ctx) => ctx.db.get(queued.runId));
  expect(run).toMatchObject({
    status: "running",
    checkpoint: { iteration: 1, summary: "current evidence" },
    modelContinuationStorageId: currentStorageId,
  });
  expect(await t.run((ctx) => ctx.storage.get(staleStorageId))).toBeNull();
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(currentStorageId)),
    ),
  ).toBe(true);
  await t.run((ctx) => ctx.db.patch(queued.runId, { status: "cancelled" }));
  await finishOperatorSchedules(t);
  expect(generate).not.toHaveBeenCalled();
});

test("exact model messages, route pin and parent request survive continuation and its blob is removed on completion", async () => {
  vi.useFakeTimers();
  const { t, orgId, queued } = await durableOperatorFixture();
  const route = { provider: "openai", model: "gpt-5.6-terra" };
  let continuationStorageId: Id<"_storage"> | undefined;
  let expectedMessages: unknown[] = [];
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    const input = { orgId, status: "live" };
    const output = await options.tools.set_organization_status.execute(input);
    const responseMessages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "stable-call",
            toolName: "set_organization_status",
            input,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "stable-call",
            toolName: "set_organization_status",
            output: { type: "json", value: output },
          },
        ],
      },
    ];
    expectedMessages = [...options.messages, ...responseMessages];
    return {
      text: "",
      route,
      clRouter: { requestId: "router-original" },
      response: { messages: responseMessages },
      steps: [
        {
          toolCalls: [{ toolName: "set_organization_status", input }],
          toolResults: [{ toolName: "set_organization_status", output }],
        },
      ],
    };
  });
  generate.mockImplementationOnce(async (_ctx, _task, options, run) => {
    expect(options.messages).toEqual(expectedMessages);
    expect(run.durable.route).toEqual(route);
    expect(run.trace.parentRequestId).toBe("router-original");
    const checkpoint = await t.run((ctx) => ctx.db.get(queued.runId));
    continuationStorageId = checkpoint?.modelContinuationStorageId;
    expect(continuationStorageId).toBeDefined();
    return { text: "Client updated.", steps: [{ toolCalls: [] }] };
  });
  await finishOperatorSchedules(t);
  expect(generate).toHaveBeenCalledTimes(2);
  const state = await t.run(async (ctx) => ({
    run: await ctx.db.get(queued.runId),
    audit: await ctx.db.query("agentActionAuditEvents").collect(),
  }));
  expect(state.run).toMatchObject({ status: "completed" });
  expect(state.run?.modelContinuationStorageId).toBeUndefined();
  expect(state.audit).toHaveLength(1);
  if (!continuationStorageId) throw new Error("Missing continuation blob");
  const completedStorageId = continuationStorageId;
  expect(await t.run((ctx) => ctx.storage.get(completedStorageId))).toBeNull();
});

test("abandoned runner recovery replays the same step and fences every stale attempt callback without repeating writes", async () => {
  vi.useFakeTimers();
  const { t, orgId, queued } = await durableOperatorFixture();
  const input = { orgId, status: "live" };
  generate.mockImplementationOnce(async (_ctx, _task, options) => {
    expect(
      (await options.tools.set_organization_status.execute(input)).status,
    ).toBe("succeeded");
    const first = await t.run((ctx) => ctx.db.get(queued.runId));
    expect(first?.runnerAttempt).toBe(1);
    await t.mutation(internal.operatorAgent.recoverAbandonedRunInternal, {
      runId: queued.runId,
      runnerAttempt: 1,
    });
    const recovered = await t.run((ctx) => ctx.db.get(queued.runId));
    expect(recovered).toMatchObject({
      status: "queued",
      checkpoint: { iteration: 0 },
      runnerAttempt: 1,
    });
    throw new RouterJobPending("same-provider-step");
  });
  generate.mockImplementationOnce(async (_ctx, _task, options, runOptions) => {
    expect(runOptions.durable.invocationKey).toBe(
      generate.mock.calls[0][3].durable.invocationKey,
    );
    const stale = {
      runId: queued.runId,
      expectedRunnerAttempt: 1,
      expectedCheckpointIteration: 0,
    };
    await t.mutation(internal.operatorAgent.waitForRouterInternal, stale);
    await t.mutation(internal.operatorAgent.failRunInternal, {
      ...stale,
      error: "stale failure",
    });
    expect(
      await t.mutation(internal.operatorAgent.completeRunInternal, {
        ...stale,
        content: "stale completion",
        usedTools: [],
        toolCalls: [],
      }),
    ).toEqual({ status: "not_completed" });
    const orphan = await t.run((ctx) =>
      ctx.storage.store(new Blob(['{"messages":[]}'])),
    );
    expect(
      await t.mutation(internal.operatorAgent.continueRunInternal, {
        ...stale,
        summary: "stale",
        usedTools: [],
        toolCalls: [],
        modelContinuationStorageId: orphan,
      }),
    ).toEqual({ status: "not_continued" });
    expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
    await t.mutation(internal.operatorAgent.recoverAbandonedRunInternal, {
      runId: queued.runId,
      runnerAttempt: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(queued.runId))).toMatchObject({
      status: "running",
      runnerAttempt: 2,
      checkpoint: { iteration: 0 },
    });
    expect(
      (await options.tools.set_organization_status.execute(input)).status,
    ).toBe("succeeded");
    return {
      text: "The saved update is complete.",
      steps: [{ toolCalls: [] }],
    };
  });
  await finishOperatorSchedules(t);
  expect(generate).toHaveBeenCalledTimes(2);
  const state = await t.run(async (ctx) => ({
    run: await ctx.db.get(queued.runId),
    audit: await ctx.db.query("agentActionAuditEvents").collect(),
    confirmations: await ctx.db.query("operatorAgentConfirmations").collect(),
  }));
  expect(state.run).toMatchObject({ status: "completed", runnerAttempt: 2 });
  expect(state.audit).toHaveLength(1);
  expect(state.confirmations).toHaveLength(1);
});

test("the watchdog recovers a lost action after its platform lifetime without changing the model invocation", async () => {
  vi.useFakeTimers();
  const { t, queued } = await durableOperatorFixture();
  const startedAt = dayjs().valueOf();
  expect(
    await t.mutation(internal.operatorAgent.markRunStartedInternal, {
      runId: queued.runId,
    }),
  ).toBe(1);
  generate.mockImplementationOnce(async (_ctx, _task, _options, runOptions) => {
    expect(dayjs().valueOf() - startedAt).toBeGreaterThanOrEqual(
      11 * 60 * 1000,
    );
    expect(runOptions.durable.invocationKey).toBe(`operator:${queued.runId}:0`);
    expect(await t.run((ctx) => ctx.db.get(queued.runId))).toMatchObject({
      runnerAttempt: 2,
      checkpoint: { iteration: 0 },
    });
    return { text: "Recovered result.", steps: [{ toolCalls: [] }] };
  });
  await finishOperatorSchedules(t);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await t.run((ctx) => ctx.db.get(queued.runId))).toMatchObject({
    status: "completed",
    runnerAttempt: 2,
  });
});

test("cancellation before request preparation prevents a late journal from starting inference", async () => {
  vi.useFakeTimers();
  const { t, queued, userId, threadId } = await durableOperatorFixture();
  const invocationKey = `operator:${queued.runId}:0:0`;
  await t.mutation(internal.operatorAgent.cancelRunInternal, {
    operatorUserId: userId,
    threadId,
  });
  const requestStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["{}"])),
  );
  await expect(
    t.mutation(internal.routerJobs.prepare, {
      invocationKey,
      operation: "generate",
      fingerprint: "a".repeat(64),
      requestToken: "b".repeat(64),
      requestTokenHash: "b".repeat(64),
      resultToken: "c".repeat(64),
      resultTokenHash: "c".repeat(64),
      requestStorageId,
    }),
  ).rejects.toThrow("no longer active");
  expect(await t.query(internal.routerJobs.get, { invocationKey })).toBeNull();
  await finishOperatorSchedules(t);
  expect(generate).not.toHaveBeenCalled();
});
