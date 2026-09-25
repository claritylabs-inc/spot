import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "../lib/clRouterClient";
import { runAgentTurn } from "../lib/channelAgentRunner";
import { run } from "./mcpChat";

vi.mock("../lib/clRouterClient", () => ({ clRouterDecide: vi.fn() }));
vi.mock("../lib/channelAgentRunner", () => ({
  AGENT_MAX_OUTPUT_TOKENS: 8192,
  runAgentTurn: vi.fn(),
}));
vi.mock("../lib/security", () => ({
  classifyPromptInjection: async () => ({ safe: true }),
  enforceInputLimits: (text: string) => text,
  collectAllowedRecipients: () => ["requester@example.com"],
}));
vi.mock("../lib/agentHistoryLoader", () => ({
  loadBoundedAgentHistory: async () => ({
    messages: [
      { _id: "old-message", role: "user", content: "Send an old draft." },
    ],
  }),
  scheduleThreadHistoryCompaction: vi.fn(),
}));

const orgId = "org" as Id<"organizations">;
const userId = "user" as Id<"users">;
const threadId = "thread" as Id<"threads">;
const messageId = "current-message" as Id<"threadMessages">;
const decision = vi.mocked(clRouterDecide);
const turn = vi.mocked(runAgentTurn);
const handler = (
  run as typeof run & {
    _handler: (
      ctx: ActionCtx,
      args: {
        orgId: Id<"organizations">;
        userId: Id<"users">;
        threadId: Id<"threads">;
        message: string;
        canWrite: boolean;
      },
    ) => Promise<unknown>;
  }
)._handler;

function context(
  thread = { orgId, createdBy: userId, visibility: "client_internal" },
) {
  const runMutation = vi.fn(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === "threads:insertUserMessageInternal") return messageId;
    if (name === "emailSendAuthorizations:recordDecision") return null;
    throw new Error(`Unexpected mutation ${name}: ${JSON.stringify(args)}`);
  });
  const runQuery = vi.fn(async (ref) => {
    switch (getFunctionName(ref)) {
      case "orgs:getInternal":
        return { _id: orgId, name: "Cove Coffee" };
      case "users:getInternal":
        return { _id: userId, email: "requester@example.com" };
      case "threads:getInternal":
        return thread;
      case "users:listByOrgInternal":
        return [{ _id: userId, email: "requester@example.com" }];
      case "pendingEmails:listDraftsInternal":
        return [];
      case "lib/agentScope:resolveForAction":
        return {
          mode: "client",
          surface: "mcp",
          primaryOrgId: orgId,
          readOrgIds: [orgId],
          writableOrgIds: [orgId],
          orgs: [],
          brokerInternal: false,
        };
      default:
        throw new Error(`Unexpected query ${getFunctionName(ref)}`);
    }
  });
  return {
    ctx: { runMutation, runQuery } as unknown as ActionCtx,
    runMutation,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  turn.mockRejectedValue(new Error("stop after tool registration"));
  decision.mockImplementation(async (request) => ({
    contractVersion: 1,
    requestId: "selection",
    model: "jev",
    answers: Object.fromEntries(
      Object.keys(request.questions).map((key) => [
        key,
        {
          type: "noul",
          noul: key === "negated" ? 0.01 : 0.99,
        },
      ]),
    ),
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  }));
});

const request = {
  orgId,
  userId,
  threadId,
  message: "Send a policy email to me.",
  canWrite: true,
};

describe("ask_spot email authorization", () => {
  it("stores send authorization on the current inserted user message and registers discrete tools", async () => {
    const { ctx, runMutation } = context();
    await expect(handler(ctx, request)).rejects.toThrow(
      "stop after tool registration",
    );
    const auth = runMutation.mock.calls.find(
      ([ref]) =>
        getFunctionName(ref) === "emailSendAuthorizations:recordDecision",
    );
    expect(auth?.[1]).toMatchObject({
      messageId,
      decision: { sendProbability: 0.99 },
    });
    expect(
      decision.mock.calls.find(
        ([input]) => input.task === "email_send_authorization",
      )?.[0].state,
    ).toMatchObject({ messageText: request.message });
    const tools = turn.mock.calls[0][1].options.tools;
    expect(tools).toHaveProperty("draft_email");
    expect(tools).toHaveProperty("send_email_draft");
    expect(tools).toHaveProperty("expand_tools");
  });

  it("read-only MCP registers draft listing but no email writes or send-authorization decision", async () => {
    const { ctx, runMutation } = context();
    await expect(handler(ctx, { ...request, canWrite: false })).rejects.toThrow(
      "stop after tool registration",
    );
    expect(
      decision.mock.calls.some(
        ([input]) => input.task === "email_send_authorization",
      ),
    ).toBe(false);
    expect(
      runMutation.mock.calls.some(
        ([ref]) =>
          getFunctionName(ref) === "emailSendAuthorizations:recordDecision",
      ),
    ).toBe(false);
    const options = turn.mock.calls[0][1].options;
    expect(options.tools).toHaveProperty("list_email_drafts");
    for (const name of [
      "draft_email",
      "update_email_draft",
      "send_email_draft",
      "cancel_email_draft",
      "attach_file_to_draft",
      "attach_policy_pdf_to_draft",
      "attach_coi_to_draft",
    ]) {
      expect(options.tools).not.toHaveProperty(name);
    }
    expect(options.system).not.toContain("EMAIL DRAFTS AND DELIVERY:");
  });

  it.each([
    {
      orgId: "other-org" as Id<"organizations">,
      createdBy: userId,
      visibility: "client_internal",
    },
    {
      orgId,
      createdBy: "other-user" as Id<"users">,
      visibility: "user_private",
    },
  ])(
    "rejects inaccessible thread before inserting or authorizing a message",
    async (thread) => {
      const { ctx, runMutation } = context(thread);
      await expect(handler(ctx, request)).rejects.toThrow("Thread not found");
      expect(runMutation).not.toHaveBeenCalled();
      expect(decision).not.toHaveBeenCalled();
      expect(turn).not.toHaveBeenCalled();
    },
  );
});
