/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { signSlackRequest } from "./lib/slackSecurity";

const modules = import.meta.glob("./**/*.ts");
const SIGNING_SECRET = "slack-http-test-secret";

beforeEach(() => {
  process.env.SLACK_ENABLED = "true";
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete process.env.SLACK_ENABLED;
  delete process.env.SLACK_SIGNING_SECRET;
});

test.each([
  { decision: "approve", status: "expired" },
  { decision: "reject", status: "expired" },
  { decision: "reject", status: "pending" },
  { decision: "approve", status: "pending" },
] as const)(
  "operator $decision click on a $status confirmation updates Slack without executing the write",
  async ({ decision, status }) => {
    vi.useFakeTimers();
    vi.stubEnv("OPERATOR_SLACK_ENABLED", "true");
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-SPOT");
    vi.stubEnv("SLACK_WORKER_URL", "https://slack-worker.example.com");
    vi.stubEnv("SLACK_WORKER_SECRET", "worker-test-secret");
    const workerFetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", workerFetch);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const operatorUserId = await ctx.db.insert("users", {
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: operatorUserId,
        email: "operator@example.com",
        role: "operator",
        status: "active",
        slackTeamId: "T-SPOT",
        slackUserId: "U-OPERATOR",
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await ctx.db.insert("operatorAgentThreads", {
        ownerUserId: operatorUserId,
        visibility: "shared",
        channel: "slack",
        conversationKey: "T-SPOT:C-OPERATOR:1800000000.100",
        title: "Create client",
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const messageId = await ctx.db.insert("operatorAgentMessages", {
        threadId,
        ownerUserId: operatorUserId,
        channel: "slack",
        role: "agent",
        content: "Create client",
        createdAt: now,
        updatedAt: now,
      });
      const runId = await ctx.db.insert("operatorAgentRuns", {
        threadId,
        operatorUserId,
        userMessageId: messageId,
        agentMessageId: messageId,
        objective: "Create client",
        status: status === "pending" ? "waiting_confirmation" : "completed",
        createdAt: now,
        updatedAt: now,
      });
      const confirmationId = await ctx.db.insert("operatorAgentConfirmations", {
        threadId,
        operatorUserId,
        promptMessageId: messageId,
        status,
        expiresAt: dayjs().subtract(30, "day").valueOf(),
        createdAt: now,
        updatedAt: now,
        payload: {
          kind: "operator_tool_action",
          runId,
          toolName: "create_client_organization",
          toolVersion: 1,
          input: '{"name":"Test client"}',
          inputHash: "test-hash",
          idempotencyKey: "test-create-client",
          capability: "operator.organizations.write",
          effect: "reversible_write",
          requiredRole: "operator",
          summary: "Create test client",
        },
      });
      if (status === "pending") {
        await ctx.db.patch(runId, {
          checkpoint: {
            iteration: 1,
            executionCount: 1,
            pendingConfirmationId: confirmationId,
          },
        });
      }
      return { confirmationId, runId };
    });
    const payload = {
      type: "block_actions",
      team: { id: "T-SPOT" },
      user: { id: "U-OPERATOR", team_id: "T-SPOT" },
      channel: { id: "C-OPERATOR" },
      message: { ts: "1800000000.200", thread_ts: "1800000000.100" },
      actions: [
        {
          action_id: `spot_operator_confirmation_${decision}`,
          value: ids.confirmationId,
        },
      ],
    };

    // An unrelated actor or channel must not learn or update the confirmation.
    for (const unauthorized of [
      { ...payload, user: { id: "U-UNKNOWN", team_id: "T-SPOT" } },
      { ...payload, channel: { id: "C-OTHER" } },
    ]) {
      expect((await signedInteraction(t, unauthorized)).status).toBe(200);
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(workerFetch).not.toHaveBeenCalled();

    expect((await signedInteraction(t, payload)).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(workerFetch).toHaveBeenCalledTimes(
      status === "pending" && decision === "reject" ? 2 : 1,
    );
    const [url, options] = workerFetch.mock.calls[0];
    expect(url).toBe("https://slack-worker.example.com/message/update");
    const update = JSON.parse(String(options?.body));
    expect(update).toMatchObject({
      channelId: "C-OPERATOR",
      messageTs: "1800000000.200",
    });
    expect(
      update.blocks.some((block: { type: string }) => block.type === "actions"),
    ).toBe(false);
    expect(JSON.stringify(update.blocks)).toContain(
      status === "pending"
        ? decision === "reject"
          ? "Cancelled"
          : "Could not confirm"
        : "expired",
    );
    if (status === "expired")
      expect(JSON.stringify(update.blocks)).toContain("fresh confirmation");
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.confirmationId))?.status).toBe(
        status === "pending"
          ? decision === "reject"
            ? "stale"
            : "pending"
          : "expired",
      );
      expect((await ctx.db.get(ids.runId))?.status).toBe(
        status === "pending" && decision === "approve"
          ? "waiting_confirmation"
          : "completed",
      );
      expect(await ctx.db.query("organizations").collect()).toEqual([]);
    });
  },
);

async function seedConnection(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Slack HTTP Client",
      type: "client",
    });
    const serviceUserId = await ctx.db.insert("users", {
      name: "Spot Slack",
      accountKind: "customer",
      serviceAccountKind: "slack",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: serviceUserId,
      role: "admin",
    });
    const connectionId = await ctx.db.insert("slackWorkspaceConnections", {
      clientOrgId,
      teamId: "T-CUSTOMER",
      teamName: "Customer",
      botUserId: "U-SPOT",
      grantedScopes: ["app_mentions:read", "chat:write"],
      status: "active",
      serviceUserId,
      thirdPartyVisibilityAcknowledged: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("agentChannelSettings", {
      clientOrgId,
      emailEnabled: true,
      imessageEnabled: true,
      slackEnabled: true,
      slackSafeAlertsEnabled: true,
      slackVendorAlertsEnabled: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("slackChannelBindings", {
      connectionId,
      clientOrgId,
      kind: "primary",
      hostTeamId: "T-SPOT",
      hostChannelId: "C-HOST",
      customerChannelId: "C-PRIMARY",
      channelName: "spot-customer",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { clientOrgId, connectionId };
  });
}

function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T-CUSTOMER",
    api_app_id: "A-SPOT",
    event_id: "Ev-1800000000.100",
    event_time: dayjs().unix(),
    event: {
      type: "app_mention",
      ts: "1800000000.100",
      thread_ts: "1800000000.100",
      event_ts: "1800000000.100",
      channel: "C-PRIMARY",
      channel_type: "channel",
      user: "U-CUSTOMER",
      text: "<@U-SPOT> show my policy",
      ...overrides,
    },
  };
}

async function signedRequest(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
  options: { timestamp?: string; signature?: string } = {},
) {
  const rawBody = JSON.stringify(payload);
  const timestamp = options.timestamp ?? String(dayjs().unix());
  const signature =
    options.signature ??
    (await signSlackRequest(SIGNING_SECRET, timestamp, rawBody));
  return await t.fetch("/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body: rawBody,
  });
}

async function signedInteraction(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
) {
  const rawBody = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  const timestamp = String(dayjs().unix());
  const signature = await signSlackRequest(SIGNING_SECRET, timestamp, rawBody);
  return await t.fetch("/slack/interactivity", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body: rawBody,
  });
}

describe("Slack Events API webhook", () => {
  test("answers signed URL verification while event processing is disabled", async () => {
    const t = convexTest(schema, modules);
    process.env.SLACK_ENABLED = "false";
    const response = await signedRequest(t, {
      type: "url_verification",
      challenge: "native-slack-challenge",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "native-slack-challenge",
    });
  });

  test("verifies, durably deduplicates, and acknowledges inbound messages", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const payload = messagePayload();

    await expect(signedRequest(t, payload)).resolves.toMatchObject({
      status: 200,
    });
    await expect(signedRequest(t, payload)).resolves.toMatchObject({
      status: 200,
    });

    const events = await t.run((ctx) =>
      ctx.db.query("slackInboundEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "T-CUSTOMER:C-PRIMARY:1800000000.100:message",
      status: "queued",
      mentionsSpot: true,
      isPrimaryChannel: true,
    });
    expect(events[0].senderTeamId).toBeUndefined();
  });

  test("rejects stale or tampered deliveries before claiming them", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const payload = messagePayload();
    const staleTimestamp = String(dayjs().subtract(6, "minute").unix());

    expect(
      (await signedRequest(t, payload, { timestamp: staleTimestamp })).status,
    ).toBe(401);
    expect(
      (await signedRequest(t, payload, { signature: "v0=invalid" })).status,
    ).toBe(401);
    await expect(
      t.run((ctx) => ctx.db.query("slackInboundEvents").collect()),
    ).resolves.toHaveLength(0);
  });

  test("claims DMs and still ignores bot echoes at the HTTP boundary", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const dm = messagePayload({
      type: "message",
      channel: "D-DIRECT",
      channel_type: "im",
      thread_ts: undefined,
      text: "show my policy",
    });
    const echo = messagePayload({
      ts: "1800000000.200",
      event_ts: "1800000000.200",
      bot_id: "B-SPOT",
    });

    expect(await (await signedRequest(t, dm)).json()).toMatchObject({
      ok: true,
    });
    expect(await (await signedRequest(t, echo)).json()).toMatchObject({
      ok: true,
      ignored: true,
    });
    const events = await t.run((ctx) =>
      ctx.db.query("slackInboundEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channelId: "D-DIRECT",
      threadTs: "D-DIRECT",
      isDirectMessage: true,
      status: "queued",
    });
  });

  test("preserves a DM thread root separately from its conversation key", async () => {
    const t = convexTest(schema, modules);
    await seedConnection(t);
    const dmReply = messagePayload({
      type: "message",
      channel: "D-DIRECT",
      channel_type: "im",
      ts: "1800000000.300",
      thread_ts: "1800000000.100",
      text: "continue in this thread",
    });

    expect(await (await signedRequest(t, dmReply)).json()).toMatchObject({
      ok: true,
    });
    const event = await t.run((ctx) =>
      ctx.db.query("slackInboundEvents").first(),
    );
    expect(event).toMatchObject({
      channelId: "D-DIRECT",
      threadTs: "D-DIRECT",
      replyThreadTs: "1800000000.100",
      messageTs: "1800000000.300",
    });
  });

  test("records a signed installation revocation and preserves preferences", async () => {
    const t = convexTest(schema, modules);
    const { connectionId } = await seedConnection(t);

    const response = await signedRequest(t, {
      type: "event_callback",
      event_id: "Ev-uninstall-1",
      event_time: dayjs().unix(),
      event: { type: "app_uninstalled" },
      team_id: "T-CUSTOMER",
    });
    expect(response.status).toBe(200);
    const lifecycleEvent = await t.run((ctx) =>
      ctx.db.query("slackLifecycleEvents").first(),
    );
    expect(lifecycleEvent).not.toBeNull();
    await t.mutation((internal as any).slackLifecycle.process, {
      eventId: lifecycleEvent!._id,
    });
    const state = await t.run(async (ctx) => ({
      connection: await ctx.db.get(connectionId),
      settings: await ctx.db.query("agentChannelSettings").first(),
    }));
    expect(state.connection?.status).toBe("revoked");
    expect(state.settings?.slackEnabled).toBe(true);
  });

  test("verifies, authorizes, deduplicates, and acknowledges Block Kit actions", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedConnection(t);
    const fixture = await t.run(async (ctx) => {
      const actorId = await ctx.db.insert("slackActors", {
        connectionId,
        clientOrgId,
        teamId: "T-CUSTOMER",
        slackUserId: "U-CUSTOMER",
        classification: "customer_member",
        displayName: "Customer",
        createdAt: 1,
        updatedAt: 1,
      });
      const threadId = await ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "Slack support",
        createdBy: (await ctx.db.get(connectionId))!.serviceUserId,
        lastMessageAt: 1,
        originChannel: "slack",
        slackConnectionId: connectionId,
        slackChannelId: "C-PRIMARY",
        slackThreadTs: "1800.0",
        slackConversationKind: "channel",
        slackState: "active",
      });
      const messageId = await ctx.db.insert("threadMessages", {
        threadId,
        orgId: clientOrgId,
        channel: "slack",
        role: "agent",
        content: "Answer",
      });
      return { actorId, threadId, messageId };
    });
    const created = await t.mutation(
      (internal as any).slackPresentation.create,
      {
        orgId: clientOrgId,
        threadId: fixture.threadId,
        threadMessageId: fixture.messageId,
        connectionId,
        teamId: "T-CUSTOMER",
        channelId: "C-PRIMARY",
        threadTs: "1800.0",
        mode: "message",
      },
    );
    await t.mutation((internal as any).slackPresentation.markActive, {
      id: created.presentation._id,
      providerMessageId: "1800.1",
    });
    await t.mutation((internal as any).slackPresentation.markFinal, {
      id: created.presentation._id,
      providerMessageId: "1800.1",
    });
    const payload = {
      type: "block_actions",
      team: { id: "T-CUSTOMER" },
      user: { id: "U-CUSTOMER", team_id: "T-CUSTOMER" },
      channel: { id: "C-PRIMARY" },
      message: { ts: "1800.1" },
      actions: [
        {
          action_id: "spot_response_feedback",
          action_ts: "1800.2",
          value: `positive:${created.actionToken}`,
        },
      ],
    };
    expect((await signedInteraction(t, payload)).status).toBe(200);
    expect((await signedInteraction(t, payload)).status).toBe(200);
    const interactions = await t.run((ctx) =>
      ctx.db.query("slackInteractionEvents").collect(),
    );
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({
      actionId: "spot_response_feedback",
      actorId: fixture.actorId,
    });

    const missingMessage = structuredClone(payload);
    delete (missingMessage as { message?: unknown }).message;
    expect((await signedInteraction(t, missingMessage)).status).toBe(200);
    const interactionsAfterMissingMessage = await t.run((ctx) =>
      ctx.db.query("slackInteractionEvents").collect(),
    );
    expect(interactionsAfterMissingMessage).toHaveLength(1);
  });

  test("records a signed negative-feedback modal submission for the same actor", async () => {
    const t = convexTest(schema, modules);
    const { clientOrgId, connectionId } = await seedConnection(t);
    const fixture = await t.run(async (ctx) => {
      const actorId = await ctx.db.insert("slackActors", {
        connectionId,
        clientOrgId,
        teamId: "T-CUSTOMER",
        slackUserId: "U-CUSTOMER",
        classification: "customer_member",
        createdAt: 1,
        updatedAt: 1,
      });
      const connection = await ctx.db.get(connectionId);
      const threadId = await ctx.db.insert("threads", {
        orgId: clientOrgId,
        title: "Slack feedback",
        createdBy: connection!.serviceUserId,
        lastMessageAt: 1,
        originChannel: "slack",
        slackConnectionId: connectionId,
        slackChannelId: "C-PRIMARY",
        slackThreadTs: "1800.0",
        slackConversationKind: "channel",
        slackState: "active",
      });
      const messageId = await ctx.db.insert("threadMessages", {
        threadId,
        orgId: clientOrgId,
        channel: "slack",
        role: "agent",
        content: "Answer",
      });
      return { actorId, threadId, messageId };
    });
    const created = await t.mutation(internal.slackPresentation.create, {
      orgId: clientOrgId,
      threadId: fixture.threadId,
      threadMessageId: fixture.messageId,
      connectionId,
      teamId: "T-CUSTOMER",
      channelId: "C-PRIMARY",
      threadTs: "1800.0",
      mode: "message",
    });
    if (!created.presentation || !created.actionToken) {
      throw new Error("Expected a new Slack presentation");
    }
    await t.mutation(internal.slackPresentation.markActive, {
      id: created.presentation._id,
      providerMessageId: "1800.1",
    });
    await t.mutation(internal.slackPresentation.markFinal, {
      id: created.presentation._id,
      providerMessageId: "1800.1",
    });
    const claimed = await t.mutation(
      internal.slackPresentation.claimInteraction,
      {
        interactionKey: "negative-feedback-click",
        actionToken: created.actionToken,
        teamId: "T-CUSTOMER",
        actorTeamId: "T-CUSTOMER",
        slackUserId: "U-CUSTOMER",
        channelId: "C-PRIMARY",
        messageTs: "1800.1",
        actionId: "spot_response_feedback",
        value: "negative",
      },
    );
    const submission = {
      type: "view_submission",
      team: { id: "T-CUSTOMER" },
      user: { id: "U-CUSTOMER", team_id: "T-CUSTOMER" },
      view: {
        callback_id: "spot_negative_feedback",
        private_metadata: claimed.interaction._id,
        state: {
          values: {
            spot_feedback_comment_block: {
              spot_feedback_comment: {
                action_id: "spot_feedback_comment",
                value: "The coverage limit was wrong.",
              },
            },
          },
        },
      },
    };
    expect((await signedInteraction(t, submission)).status).toBe(200);
    const feedback = await t.run((ctx) =>
      ctx.db.query("agentResponseFeedback").collect(),
    );
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({
      threadMessageId: fixture.messageId,
      slackActorId: fixture.actorId,
      rating: "negative",
      comment: "The coverage limit was wrong.",
    });
  });
});
