import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  decideSlackControlIntent,
  isContextualConfirmation,
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
  parseTaskControlCommand,
  parseTextChannelCommand,
  resolveChannelEmailControl,
  resolvePendingActionConfirmation,
  resolveTextChannelEmailControl,
} from "./channelControls";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const orgId = "org" as Id<"organizations">;

function respondChoice(choice: string, probability: number) {
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.13.0",
    answers: {
      control: {
        type: "choice",
        choice,
        probabilities: { [choice]: probability },
        confidence: 1,
      },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

function respondSlack(resolve: number, humanRequest: number) {
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.13.0",
    answers: {
      resolve: { type: "noul", noul: resolve },
      humanRequest: { type: "noul", noul: humanRequest },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

beforeEach(() => {
  vi.mocked(clRouterDecide).mockReset();
});

describe("slash commands", () => {
  it("parses exact commands unchanged", () => {
    expect(parseTextChannelCommand("/cancel")).toEqual({
      kind: "known",
      name: "cancel",
      rawName: "/cancel",
      args: [],
      target: undefined,
    });
    expect(parseTextChannelCommand("/NEW")).toMatchObject({ name: "reset" });
    expect(parseTextChannelCommand("/send 2")).toMatchObject({
      name: "send",
      target: 2,
    });
    expect(parseTextChannelCommand("/drafts all")).toMatchObject({
      name: "drafts",
      target: "all",
    });
    expect(parseTextChannelCommand("/wat")).toEqual({
      kind: "unknown",
      rawName: "/wat",
      args: [],
    });
    expect(parseTextChannelCommand("cancel")).toBeNull();
  });

  it("recognizes task controls only as bare commands", () => {
    expect(parseTaskControlCommand("/cancel")).toBe("cancel_task");
    expect(parseTaskControlCommand(" /Reset ")).toBe("reset_task");
    expect(parseTaskControlCommand("/new")).toBe("reset_task");
    expect(parseTaskControlCommand("/cancel it")).toBeNull();
    expect(parseTaskControlCommand("/send")).toBeNull();
    expect(parseTaskControlCommand("cancel")).toBeNull();
  });
});

describe("exact email controls", () => {
  it("keeps exact phrase behavior", () => {
    expect(isPendingEmailCancelIntent("Cancel the email!")).toBe(true);
    expect(isPendingEmailCancelIntent("cancel everything please")).toBe(false);
    expect(isPendingEmailCancelConfirmation("yes, cancel it")).toBe(true);
    expect(isContextualConfirmation("Send it.")).toBe(true);
    expect(isContextualConfirmation("send it to bob")).toBe(false);
  });

  it("resolves exact controls against current drafts and pending emails", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "cancel",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
      }),
    ).toEqual({ kind: "request_draft_cancel_confirmation", count: 1 });
    expect(
      resolveTextChannelEmailControl({
        messageText: "yes cancel",
        isCancelConfirmationContext: true,
        draftEmailIds: [],
        pendingEmailIds: ["pending"],
      }),
    ).toEqual({ kind: "cancel_pending_emails", emailIds: ["pending"] });
    expect(
      resolveTextChannelEmailControl({
        messageText: "undo cancel",
        isCancelConfirmationContext: false,
        latestCancelledEmailId: "cancelled",
        draftEmailIds: [],
        pendingEmailIds: [],
      }),
    ).toEqual({ kind: "restore_cancelled_email", emailId: "cancelled" });
    expect(
      resolveTextChannelEmailControl({
        messageText: "show more",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
        allowDraftList: true,
      }),
    ).toEqual({ kind: "show_draft_emails" });
    expect(
      resolveTextChannelEmailControl({
        messageText: "new@example.com",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        pendingEmailIds: [],
      }),
    ).toEqual({
      kind: "update_single_draft_recipient",
      emailId: "draft",
      recipientEmail: "new@example.com",
    });
  });

  it("does not approve a draft that was not attached to the preceding response", () => {
    expect(
      resolveTextChannelEmailControl({
        messageText: "send",
        isCancelConfirmationContext: false,
        draftEmailIds: ["stale-draft"],
        draftApprovalEmailIds: [],
        pendingEmailIds: [],
        allowDraftApproval: true,
      }),
    ).toBeNull();

    expect(
      resolveTextChannelEmailControl({
        messageText: "ReLease Coverage Company, Inc. is correct. Send please",
        isCancelConfirmationContext: false,
        draftEmailIds: ["draft"],
        draftApprovalEmailIds: ["draft"],
        pendingEmailIds: [],
        allowDraftApproval: true,
      }),
    ).toBeNull();
  });
});

describe("resolveChannelEmailControl", () => {
  const base = {
    orgId,
    isCancelConfirmationContext: false,
    draftEmailIds: ["draft"],
    pendingEmailIds: [] as string[],
  };

  it("uses the exact fast path without calling Jev", async () => {
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "cancel",
      }),
    ).toEqual({ kind: "request_draft_cancel_confirmation", count: 1 });
    expect(clRouterDecide).not.toHaveBeenCalled();
  });

  it("skips Jev when nothing is controllable or the text is long", async () => {
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        draftEmailIds: [],
        messageText: "please scrap that email",
      }),
    ).toBeNull();
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "please scrap that email ".repeat(12),
      }),
    ).toBeNull();
    expect(clRouterDecide).not.toHaveBeenCalled();
  });

  it("acts on a confident Jev cancel paraphrase", async () => {
    respondChoice("cancel", 0.91);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "actually scrap that email",
      }),
    ).toEqual({ kind: "request_draft_cancel_confirmation", count: 1 });
    expect(vi.mocked(clRouterDecide).mock.calls[0][0]).toMatchObject({
      task: "text_channel_email_control",
      state: { messageText: "actually scrap that email", draftCount: 1 },
    });
  });

  it("falls through to the agent below the threshold or on router failure", async () => {
    respondChoice("cancel", 0.6);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "hmm, maybe not that one",
      }),
    ).toBeNull();
    vi.mocked(clRouterDecide).mockRejectedValueOnce(new Error("router down"));
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "actually scrap that email",
      }),
    ).toBeNull();
  });

  it("maps restore and show_drafts only when the channel allows them", async () => {
    respondChoice("restore", 0.9);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        draftEmailIds: [],
        latestCancelledEmailId: "cancelled",
        messageText: "bring back the one I cancelled",
      }),
    ).toEqual({ kind: "restore_cancelled_email", emailId: "cancelled" });
    respondChoice("show_drafts", 0.9);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "what drafts do I have?",
      }),
    ).toBeNull();
    respondChoice("show_drafts", 0.9);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        allowDraftList: true,
        messageText: "what drafts do I have?",
      }),
    ).toEqual({ kind: "show_draft_emails" });
  });

  it("requires draft approval and the send authorization decision for a Jev send", async () => {
    respondChoice("send", 0.95);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        messageText: "go ahead and fire it off",
        authorizeSend: async () => true,
      }),
    ).toBeNull();
    respondChoice("send", 0.95);
    const authorizeSend = vi.fn(async () => false);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        allowDraftApproval: true,
        messageText: "go ahead and fire it off",
        authorizeSend,
      }),
    ).toBeNull();
    expect(authorizeSend).toHaveBeenCalledTimes(1);
    respondChoice("send", 0.95);
    expect(
      await resolveChannelEmailControl(undefined, {
        ...base,
        allowDraftApproval: true,
        messageText: "go ahead and fire it off",
        authorizeSend: async () => true,
      }),
    ).toEqual({ kind: "send_draft_emails", emailIds: ["draft"] });
  });
});

describe("resolvePendingActionConfirmation", () => {
  const threadId = "thread" as Id<"threads">;
  const userId = "user" as Id<"users">;
  const currentMessageId = "message" as Id<"threadMessages">;
  const confirmation = {
    _id: "confirmation" as Id<"threadActionConfirmations">,
    orgId,
    threadId,
    actor: { kind: "user", userId },
    payload: {
      kind: "email_send",
      pendingEmailIds: ["draft"],
      draftFingerprints: ["fp"],
    },
  } as unknown as Doc<"threadActionConfirmations">;

  function ctxWith(outcome: string) {
    const runQuery = vi.fn(async (..._args: unknown[]) => confirmation);
    const runMutation = vi.fn(async (..._args: unknown[]) => outcome);
    return {
      ctx: { runQuery, runMutation } as unknown as ActionCtx,
      runMutation,
    };
  }

  it("consumes an exact confirmation and returns the send command", async () => {
    const { ctx, runMutation } = ctxWith("completed");
    const result = await resolvePendingActionConfirmation(ctx, {
      messageText: "Yes",
      orgId,
      threadId,
      userId,
      currentMessageId,
      draftEmailIds: ["draft" as Id<"pendingEmails">],
    });
    expect(result.resolution).toEqual({
      kind: "email_send",
      command: { kind: "send_draft_emails", emailIds: ["draft"] },
      sendConfirmationId: "confirmation",
    });
    expect(getFunctionName(runMutation.mock.calls[0][0] as never)).toBe(
      "threadActionConfirmations:consumeInternal",
    );
  });

  it("never infers a confirmation from prose", async () => {
    const { ctx, runMutation } = ctxWith("completed");
    const result = await resolvePendingActionConfirmation(ctx, {
      messageText: "yes please go ahead and send it",
      orgId,
      threadId,
      userId,
      currentMessageId,
      draftEmailIds: [],
    });
    expect(result.resolution).toEqual({ kind: "none" });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("reports stale confirmations", async () => {
    const { ctx } = ctxWith("expired");
    const result = await resolvePendingActionConfirmation(ctx, {
      messageText: "confirm",
      orgId,
      threadId,
      userId,
      currentMessageId,
      draftEmailIds: [],
    });
    expect(result.resolution).toEqual({ kind: "stale", outcome: "expired" });
  });
});

describe("decideSlackControlIntent", () => {
  it("strips the bot mention and applies the shared threshold", async () => {
    respondSlack(0.85, 0.1);
    expect(
      await decideSlackControlIntent(undefined, {
        orgId,
        messageText: "<@U123> that fixed it, you can close this out",
        botUserId: "U123",
      }),
    ).toEqual({ resolve: true, humanRequest: false });
    expect(vi.mocked(clRouterDecide).mock.calls[0][0]).toMatchObject({
      task: "slack_thread_control",
      state: { messageText: "that fixed it, you can close this out" },
    });
    respondSlack(0.2, 0.75);
    expect(
      await decideSlackControlIntent(undefined, {
        orgId,
        messageText: "can I get a real person on this?",
      }),
    ).toEqual({ resolve: false, humanRequest: true });
  });

  it("returns no control on failure, empty text, or long messages", async () => {
    vi.mocked(clRouterDecide).mockRejectedValueOnce(new Error("router down"));
    expect(
      await decideSlackControlIntent(undefined, {
        orgId,
        messageText: "close it",
      }),
    ).toEqual({ resolve: false, humanRequest: false });
    expect(
      await decideSlackControlIntent(undefined, {
        orgId,
        messageText: "<@U123>",
        botUserId: "U123",
      }),
    ).toEqual({ resolve: false, humanRequest: false });
    expect(
      await decideSlackControlIntent(undefined, {
        orgId,
        messageText: "close it ".repeat(40),
      }),
    ).toEqual({ resolve: false, humanRequest: false });
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
  });
});
