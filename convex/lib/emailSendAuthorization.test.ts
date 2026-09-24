import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import {
  decideEmailSendAuthorization,
  emailSendDecisionAuthorizesSend,
  ensureEmailSendAuthorizationDecision,
  isActorBoundExplicitEmailSendSource,
  type EmailSendAuthorizationDecision,
} from "./emailSendAuthorization";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const orgId = "org" as Id<"organizations">;
const threadId = "thread" as Id<"threads">;
const messageId = "message" as Id<"threadMessages">;
const userId = "user" as Id<"users">;

function respond(send: number, negated: number) {
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.13.0",
    answers: {
      send: { type: "noul", noul: send },
      negated: { type: "noul", noul: negated },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

function decision(
  send: number,
  negated: number,
): EmailSendAuthorizationDecision {
  return {
    sendProbability: send,
    negatedProbability: negated,
    model: "jev-1.13.0",
    decidedAt: 1,
  };
}

function message(content: string) {
  return { _id: messageId, orgId, threadId, content };
}

describe("emailSendDecisionAuthorizesSend", () => {
  it("requires Jev to be sure about the send and not sure about negation", () => {
    expect(emailSendDecisionAuthorizesSend(decision(0.95, 0.05))).toBe(true);
    expect(emailSendDecisionAuthorizesSend(decision(0.7, 0.69))).toBe(true);
    expect(emailSendDecisionAuthorizesSend(decision(0.69, 0))).toBe(false);
    expect(emailSendDecisionAuthorizesSend(decision(0.95, 0.7))).toBe(false);
    expect(emailSendDecisionAuthorizesSend(undefined)).toBe(false);
    expect(emailSendDecisionAuthorizesSend(null)).toBe(false);
  });
});

describe("decideEmailSendAuthorization", () => {
  const ctx = { runMutation: vi.fn(async () => null) };
  beforeEach(() => {
    vi.mocked(clRouterDecide).mockReset();
    ctx.runMutation.mockClear();
  });

  it("stores an authorizing decision on the user message for an explicit send", async () => {
    respond(0.96, 0.02);
    const result = await decideEmailSendAuthorization(ctx, {
      message: message("Looks good, send it to the broker now."),
      pendingDrafts: [{ recipientEmail: "broker@example.com", subject: "COI" }],
    });
    expect(result).toMatchObject({
      sendProbability: 0.96,
      negatedProbability: 0.02,
      model: "jev-1.13.0",
    });
    expect(emailSendDecisionAuthorizesSend(result)).toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [ref, args] = ctx.runMutation.mock.calls[0] as unknown as [
      Parameters<typeof getFunctionName>[0],
      { messageId: string; decision: EmailSendAuthorizationDecision },
    ];
    expect(getFunctionName(ref)).toBe("emailSendAuthorizations:recordDecision");
    expect(args.messageId).toBe(messageId);
    expect(args.decision.sendProbability).toBe(0.96);
    expect(vi.mocked(clRouterDecide).mock.calls[0][0]).toMatchObject({
      task: "email_send_authorization",
      state: {
        messageText: "Looks good, send it to the broker now.",
        pendingDrafts: [{ to: "broker@example.com", subject: "COI" }],
      },
    });
  });

  it.each([
    ["negated", "Draft it but don't send yet.", 0.8, 0.95],
    ["conditional", "Send it if they reply by Friday.", 0.75, 0.9],
    ["question", "Should I send this?", 0.3, 0.8],
    ["unrelated", "What is my GL limit?", 0.01, 0.05],
  ])("does not authorize a %s message", async (_label, text, send, negated) => {
    respond(send, negated);
    const result = await decideEmailSendAuthorization(ctx, {
      message: message(text),
      pendingDrafts: [],
    });
    expect(result).not.toBeNull();
    expect(emailSendDecisionAuthorizesSend(result)).toBe(false);
  });

  it("fails closed when the router fails", async () => {
    vi.mocked(clRouterDecide).mockRejectedValueOnce(new Error("router down"));
    const result = await decideEmailSendAuthorization(ctx, {
      message: message("send it"),
      pendingDrafts: [],
    });
    expect(result).toBeNull();
    expect(emailSendDecisionAuthorizesSend(result)).toBe(false);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("skips empty messages without calling the router", async () => {
    expect(
      await decideEmailSendAuthorization(ctx, {
        message: message("   "),
        pendingDrafts: [],
      }),
    ).toBeNull();
    expect(clRouterDecide).not.toHaveBeenCalled();
  });

  it("reuses a stored decision instead of deciding again", async () => {
    const stored = decision(0.9, 0.1);
    expect(
      await ensureEmailSendAuthorizationDecision(ctx, {
        message: { ...message("send it"), emailSendAuthorization: stored },
        pendingDrafts: [],
      }),
    ).toBe(stored);
    expect(clRouterDecide).not.toHaveBeenCalled();
  });
});

describe("isActorBoundExplicitEmailSendSource", () => {
  const authorized = decision(0.95, 0.02);
  const base = {
    role: "user",
    orgId,
    threadId,
    userId,
    emailSendAuthorization: authorized,
  };

  it("authorizes the acting user's own decided message in the same thread", () => {
    expect(
      isActorBoundExplicitEmailSendSource({
        message: base,
        orgId,
        threadId,
        actorUserId: userId,
      }),
    ).toBe(true);
  });

  it("rejects a message without a stored decision even if an older message had one", () => {
    expect(
      isActorBoundExplicitEmailSendSource({
        message: { ...base, emailSendAuthorization: undefined },
        orgId,
        threadId,
        actorUserId: userId,
      }),
    ).toBe(false);
  });

  it("rejects a decided message from another thread, actor, or role", () => {
    expect(
      isActorBoundExplicitEmailSendSource({
        message: { ...base, threadId: "other-thread" },
        orgId,
        threadId,
        actorUserId: userId,
      }),
    ).toBe(false);
    expect(
      isActorBoundExplicitEmailSendSource({
        message: base,
        orgId,
        threadId,
        actorUserId: "someone-else",
      }),
    ).toBe(false);
    expect(
      isActorBoundExplicitEmailSendSource({
        message: { ...base, role: "agent" },
        orgId,
        threadId,
        actorUserId: userId,
      }),
    ).toBe(false);
  });

  it("binds email-channel messages by sender address", () => {
    const emailMessage = {
      ...base,
      userId: undefined,
      fromEmail: "Owner@Example.com",
    };
    expect(
      isActorBoundExplicitEmailSendSource({
        message: emailMessage,
        orgId,
        threadId,
        actorUserId: userId,
        actorEmail: "owner@example.com",
      }),
    ).toBe(true);
    expect(
      isActorBoundExplicitEmailSendSource({
        message: emailMessage,
        orgId,
        threadId,
        actorUserId: userId,
        actorEmail: "other@example.com",
      }),
    ).toBe(false);
  });
});
