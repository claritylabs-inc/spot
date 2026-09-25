import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  runInboundEmailDeterministicControls,
  type InboundEmailDraftControl,
} from "./inboundEmailDeterministicControls";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const orgId = "org" as Id<"organizations">;

function draft(
  id: string,
  subject = "Coverage update",
): InboundEmailDraftControl {
  return {
    _id: id as Id<"pendingEmails">,
    recipientEmail: "client@example.com",
    subject,
    emailBody: "Here is the update.",
    attachments: [],
  };
}

function mockCtx() {
  const runAction = vi.fn(async (..._args: unknown[]) => null);
  const runMutation = vi.fn(async (..._args: unknown[]) => null);
  return {
    ctx: { runAction, runMutation } as unknown as ActionCtx,
    runAction,
    runMutation,
  };
}

function respond(answers: Record<string, unknown>) {
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.13.0",
    answers: answers as never,
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

beforeEach(() => {
  vi.mocked(clRouterDecide).mockReset();
});

describe("runInboundEmailDeterministicControls", () => {
  test("does not send thread-global drafts from a prose command", async () => {
    const { ctx, runAction } = mockCtx();
    respond({
      control: {
        type: "choice",
        choice: "send",
        probabilities: { send: 0.99 },
        confidence: 1,
      },
    });

    await expect(
      runInboundEmailDeterministicControls(ctx, {
        messageText: "send all",
        draftEmails: [draft("draft-1"), draft("draft-2")],
        orgId,
      }),
    ).resolves.toBeNull();
    expect(runAction).not.toHaveBeenCalled();
  });

  test("shows drafts for a Jev paraphrase of the exact list phrases", async () => {
    const { ctx } = mockCtx();
    respond({
      control: {
        type: "choice",
        choice: "show_drafts",
        probabilities: { show_drafts: 0.9 },
        confidence: 1,
      },
    });
    const result = await runInboundEmailDeterministicControls(ctx, {
      messageText: "Can you list what you have drafted so far?",
      draftEmails: [draft("draft-1", "Renewal terms")],
      orgId,
    });
    expect(result?.responseBody).toContain("Renewal terms");
  });

  test("stays on the exact path without an org id", async () => {
    const { ctx } = mockCtx();
    expect(
      await runInboundEmailDeterministicControls(ctx, {
        messageText: "Can you list what you have drafted so far?",
        draftEmails: [draft("draft-1")],
      }),
    ).toBeNull();
    expect(
      (
        await runInboundEmailDeterministicControls(ctx, {
          messageText: "show drafts",
          draftEmails: [draft("draft-1")],
        })
      )?.responseBody,
    ).toContain("Coverage update");
    expect(clRouterDecide).not.toHaveBeenCalled();
  });

  test("records the send authorization decision on the source message at ingest", async () => {
    const { ctx, runMutation } = mockCtx();
    respond({
      control: {
        type: "choice",
        choice: "none",
        probabilities: { none: 0.9 },
        confidence: 1,
      },
    });
    respond({
      send: { type: "noul", noul: 0.9 },
      negated: { type: "noul", noul: 0.05 },
    });
    const sourceMessage = {
      _id: "message" as Id<"threadMessages">,
      orgId,
      threadId: "thread" as Id<"threads">,
      content: "Yes, please send the renewal email now.",
    };
    expect(
      await runInboundEmailDeterministicControls(ctx, {
        messageText: sourceMessage.content,
        draftEmails: [draft("draft-1")],
        orgId,
        sourceMessage,
      }),
    ).toBeNull();
    expect(getFunctionName(runMutation.mock.calls[0][0] as never)).toBe(
      "emailSendAuthorizations:recordDecision",
    );
    expect(runMutation.mock.calls[0][1]).toMatchObject({
      messageId: "message",
      decision: { sendProbability: 0.9, negatedProbability: 0.05 },
    });
  });
});
