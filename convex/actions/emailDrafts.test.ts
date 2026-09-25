import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildEmailToolExecutors } from "../lib/emailTools";
import { resolveEmailAgentIdentity } from "../lib/emailIdentity";
import { executeMcpEmailTool } from "./emailDrafts";

vi.mock("../lib/emailIdentity", () => ({
  resolveEmailAgentIdentity: vi.fn(),
}));

vi.mock("../lib/emailTools", () => ({
  buildEmailToolExecutors: vi.fn(),
  serializeEmailDraft: (draft: Doc<"pendingEmails"> | null) =>
    draft && {
      id: draft._id,
      status: draft.status,
      threadId: draft.threadId,
      threadMessageId: draft.threadMessageId,
      recipientEmail: draft.recipientEmail,
      ccAddresses: draft.ccAddresses,
      bccAddresses: draft.bccAddresses,
      subject: draft.subject,
      emailBody: draft.emailBody,
      attachments: draft.attachments,
      scheduledSendTime: draft.scheduledSendTime,
      sentMessageId: draft.sentMessageId,
      createdAt: draft._creationTime,
    },
}));

const orgId = "org-1" as Id<"organizations">;
const userId = "user-1" as Id<"users">;
const draftId = "draft-1" as Id<"pendingEmails">;
const threadId = "thread-1" as Id<"threads">;
const baseDraft = {
  _id: draftId,
  _creationTime: 100,
  orgId,
  threadId,
  status: "draft",
  recipientEmail: "holder@example.test",
  subject: "Policy",
  emailBody: "Attached policy.",
  scheduledSendTime: 0,
} as Doc<"pendingEmails">;

function context(drafts = [baseDraft]) {
  const byId = new Map(drafts.map((draft) => [draft._id, { ...draft }]));
  const runQuery = vi.fn(async (ref, args) => {
    switch (getFunctionName(ref)) {
      case "orgs:getInternal":
        return { _id: orgId, name: "Acme", agentHandle: "agent" };
      case "users:getInternal":
        return { _id: userId, email: "requester@example.test" };
      case "pendingEmails:getInternal":
        return byId.get(args.id) ?? null;
      default:
        throw new Error(`Unexpected query ${getFunctionName(ref)}`);
    }
  });
  const result = {
    status: "draft",
    pendingEmailId: draftId,
    responseBody: "Draft ready.",
  };
  const executeDraft = vi.fn(async () => result);
  const executeSend = vi.fn(async (input: { draftId: string }) => {
    const draft = byId.get(input.draftId as Id<"pendingEmails">)!;
    draft.status = "sent";
    return { ...result, status: "sent", pendingEmailId: draft._id };
  });
  const executeCancel = vi.fn(async () => {
    byId.get(draftId)!.status = "cancelled";
    return { ...result, status: "draft" };
  });
  const executeList = vi.fn(async () => ({
    drafts: [...byId.values()].map((draft) => ({
      id: draft._id,
      ...draft,
    })),
  }));
  const spec = (execute: unknown) => ({
    inputSchema: { parse: (input: unknown) => input },
    execute,
  });
  vi.mocked(buildEmailToolExecutors).mockReturnValue({
    draft_email: spec(executeDraft),
    update_email_draft: spec(executeDraft),
    send_email_draft: spec(executeSend),
    cancel_email_draft: spec(executeCancel),
    list_email_drafts: spec(executeList),
  } as unknown as ReturnType<typeof buildEmailToolExecutors>);
  return {
    ctx: { runQuery } as unknown as ActionCtx,
    executeDraft,
    executeSend,
    executeCancel,
    executeList,
    runQuery,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveEmailAgentIdentity).mockReturnValue({
    canSend: true,
    agentAddress: "agent@agent.spot.insure",
    fromHeader: "Spot <agent@agent.spot.insure>",
  });
});

test("MCP create and replacement updates use the shared tools and preserve draft DTOs", async () => {
  const { ctx, executeDraft } = context();
  for (const name of ["draft_email", "update_email_draft"]) {
    const draft = await executeMcpEmailTool(ctx, {
      orgId,
      userId,
      name,
      input: {
        draftId,
        to: baseDraft.recipientEmail,
        subject: "Policy",
        body: "Attached policy.",
      },
    });
    expect(draft).toMatchObject({
      id: draftId,
      threadId,
      recipientEmail: baseDraft.recipientEmail,
      emailBody: baseDraft.emailBody,
      createdAt: 100,
    });
    expect(executeDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cc: [],
        bcc: [],
        recipientDirection: "explicit",
      }),
    );
  }
  expect(buildEmailToolExecutors).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ mcpOriginalPolicyIds: [] }),
  );
  expect(buildEmailToolExecutors).not.toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ sendAuthorization: expect.anything() }),
  );
});

test("MCP original policy requests are trusted adapter context, never model input", async () => {
  const { ctx, executeDraft } = context();
  await executeMcpEmailTool(ctx, {
    orgId,
    userId,
    name: "draft_email",
    input: {
      to: baseDraft.recipientEmail,
      subject: baseDraft.subject,
      body: baseDraft.emailBody,
      originalPolicyIds: ["policy-1"],
    },
  });
  expect(buildEmailToolExecutors).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ mcpOriginalPolicyIds: ["policy-1"] }),
  );
  expect(executeDraft).not.toHaveBeenCalledWith(
    expect.objectContaining({ originalPolicyIds: expect.anything() }),
  );
});

test("listing and cancelling drafts remain available when outgoing identity is disabled", async () => {
  vi.mocked(resolveEmailAgentIdentity).mockReturnValue({
    canSend: false,
    reason: "Email sending is not configured.",
  });
  const { ctx } = context();
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "list_email_drafts",
      input: {},
    }),
  ).toContain("1 email draft ready");
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "cancel_email_draft",
      input: { draftId },
    }),
  ).toMatchObject({ id: draftId, status: "cancelled" });
  await expect(
    executeMcpEmailTool(ctx, {
      orgId,
      userId,
      name: "draft_email",
      input: {
        to: baseDraft.recipientEmail,
        subject: "Policy",
        body: "Attached.",
      },
    }),
  ).rejects.toThrow("Email sending is not configured.");
});

test("only a direct MCP send receives the trusted explicit-action authorization", async () => {
  const { ctx, executeSend } = context();
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "send_email_draft",
      input: { draftId },
    }),
  ).toMatchObject({ id: draftId, status: "sent" });
  expect(executeSend).toHaveBeenCalledExactlyOnceWith({ draftId });
  expect(buildEmailToolExecutors).toHaveBeenLastCalledWith(
    ctx,
    expect.objectContaining({
      sendAuthorization: { kind: "mcp_explicit_action" },
    }),
  );
});

test("batch validates every tenant target before any send and deduplicates draft IDs", async () => {
  const foreign = {
    ...baseDraft,
    _id: "foreign" as Id<"pendingEmails">,
    orgId: "org-other" as Id<"organizations">,
  };
  const { ctx, executeSend } = context([baseDraft, foreign]);
  await expect(
    executeMcpEmailTool(ctx, {
      orgId,
      name: "send_email_drafts",
      input: { draftIds: [draftId, foreign._id] },
    }),
  ).rejects.toThrow(/not found/i);
  expect(executeSend).not.toHaveBeenCalled();
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "send_email_drafts",
      input: { draftIds: [draftId, draftId] },
    }),
  ).toEqual({
    sent: [{ id: draftId, recipientEmail: baseDraft.recipientEmail }],
    failed: [],
    summary: "Sent 1 email.",
  });
  expect(executeSend).toHaveBeenCalledTimes(1);
});

test("batch keeps legacy per-draft failures without claiming unsuccessful sends", async () => {
  const { ctx, executeSend } = context();
  executeSend.mockRejectedValueOnce(new Error("Delivery rejected"));
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "send_email_drafts",
      input: { draftIds: [draftId] },
    }),
  ).toEqual({
    sent: [],
    failed: [{ id: draftId, error: "Delivery rejected" }],
    summary: "Sent 0 emails; 1 failed.",
  });
});

test("list keeps the MCP text contract and cancel delegates to the shared tool", async () => {
  const { ctx, executeList, executeCancel } = context();
  const result = await executeMcpEmailTool(ctx, {
    orgId,
    name: "list_email_drafts",
    input: { threadId, showAll: true },
  });
  expect(result).toContain(`holder@example.test (${draftId})`);
  expect(result).toContain("send_email_drafts");
  expect(executeList).toHaveBeenCalledWith({ threadId });
  expect(
    await executeMcpEmailTool(ctx, {
      orgId,
      name: "cancel_email_draft",
      input: { draftId },
    }),
  ).toMatchObject({ id: draftId, status: "cancelled" });
  expect(executeCancel).toHaveBeenCalledExactlyOnceWith({ draftId });
});
