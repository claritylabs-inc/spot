import { describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { buildMailboxTools } from "./mailboxTools";

const orgId = "org-1" as Id<"organizations">;
const userId = "user-1" as Id<"users">;
const accountId = "account-1" as Id<"connectedEmailAccounts">;
const account2 = "account-2" as Id<"connectedEmailAccounts">;
const threadId = "thread-1" as Id<"threads">;
const account = { _id: accountId, emailAddress: "one@example.com" };

function fixture(
  overrides: Partial<Parameters<typeof buildMailboxTools>[1]> = {},
) {
  const runQuery = vi.fn<ActionCtx["runQuery"]>(async () => [
    account,
    { _id: account2, emailAddress: "two@example.com" },
  ]);
  const runAction = vi.fn(async (ref, args) => {
    expect(args.orgId).toBe(orgId);
    expect(args.userId).toBe(userId);
    if (getFunctionName(ref).endsWith("searchInternal")) {
      return args.accountId === accountId
        ? [{ emailRef: "older", subject: "Old", date: "2026-09-01" }]
        : [{ emailRef: "newer", subject: "New", date: "2026-09-20" }];
    }
    return { emailRef: args.emailRef, subject: "Read", attachments: [] };
  });
  const onToolArtifact = vi.fn();
  const tools = buildMailboxTools(
    { runQuery, runAction } as unknown as ActionCtx,
    {
      orgId,
      userId,
      canWrite: true,
      threadId,
      onToolArtifact,
      ...overrides,
    },
  );
  return { tools, runQuery, runAction, onToolArtifact };
}

describe("shared mailbox tools", () => {
  test("fans out only accessible accounts and applies a global newest-first limit", async () => {
    const { tools, runQuery, runAction, onToolArtifact } = fixture();
    expect(
      await tools.search_connected_email.execute({ query: "policy", limit: 1 }),
    ).toEqual([expect.objectContaining({ emailRef: "newer" })]);
    expect(getFunctionName(runQuery.mock.calls[0]![0])).toBe(
      "connectedEmail:listAccessibleInternal",
    );
    expect(runAction).toHaveBeenCalledTimes(2);
    expect(onToolArtifact.mock.lastCall?.[0].data.searches).toHaveLength(2);
    expect(onToolArtifact.mock.lastCall?.[0].data.evidence.emails).toEqual([]);
  });

  test("never broadens a selected but inaccessible account to all accounts", async () => {
    const { tools, runQuery, runAction } = fixture({
      orgId,
      userId,
      accountIds: [accountId],
    });
    runQuery.mockResolvedValue(null as never);
    expect(await tools.search_connected_email.execute({})).toEqual([
      expect.objectContaining({ type: "mailbox_search_error" }),
    ]);
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runAction).not.toHaveBeenCalled();
  });

  test("keeps account errors visible even when matches fill the requested limit", async () => {
    const { tools, runAction, onToolArtifact } = fixture();
    runAction.mockImplementation(async (_ref, args) => {
      if (args.accountId === accountId) throw new Error("IMAP unavailable");
      return [{ emailRef: "newer", subject: "New", date: "2026-09-20" }];
    });
    expect(await tools.search_connected_email.execute({ limit: 1 })).toEqual([
      expect.objectContaining({ emailRef: "newer" }),
      expect.objectContaining({ type: "mailbox_search_error" }),
    ]);
    expect(onToolArtifact.mock.lastCall?.[0].data.mailboxErrors).toHaveLength(
      1,
    );
  });

  test("evidence includes only used references and merges repeated reads deterministically", async () => {
    const { tools, onToolArtifact } = fixture();
    await tools.search_connected_email.execute({});
    await tools.read_connected_email.execute({ emailRef: "newer" });
    await tools.read_connected_email.execute({ emailRef: "newer" });
    const evidence = onToolArtifact.mock.lastCall?.[0].data.evidence;
    expect(evidence.emails).toEqual([
      expect.objectContaining({ emailRef: "newer", subject: "Read" }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain("older");
  });

  test("read-only execution blocks every mailbox write before dispatch", async () => {
    const { tools, runAction } = fixture({ orgId, userId, canWrite: false });
    const params = { emailRef: "email", vendorEmail: "vendor@example.com" };
    for (const name of [
      "import_connected_email_policy_attachments",
      "import_connected_email_requirement_attachments",
      "save_connected_email_attachments_to_thread",
      "save_connected_email_message_to_thread",
      "send_connected_vendor_invite",
    ] as const) {
      expect(await tools[name].execute(params)).toMatchObject({
        status: "write_unavailable",
      });
    }
    expect(runAction).not.toHaveBeenCalled();
  });

  test("attachment evidence from a prior-turn email reference stays under its parent email", async () => {
    const { tools, runAction, onToolArtifact } = fixture();
    runAction.mockResolvedValue({
      emailRef: "prior-email",
      filename: "policy.pdf",
      contentType: "application/pdf",
      size: 100,
    } as never);
    await tools.read_connected_email_attachment.execute({
      emailRef: "prior-email",
      filename: "policy.pdf",
    });
    expect(onToolArtifact.mock.lastCall?.[0].data.evidence.emails).toEqual([
      expect.objectContaining({
        emailRef: "prior-email",
        attachments: [
          { filename: "policy.pdf", contentType: "application/pdf", size: 100 },
        ],
      }),
    ]);
  });

  test("a direct save requires an authorized thread and rejects private or foreign threads", async () => {
    const { tools, runQuery, runAction } = fixture({
      orgId,
      userId,
      threadId: undefined,
    });
    expect(
      await tools.save_connected_email_message_to_thread.execute({
        emailRef: "email",
      }),
    ).toMatchObject({ status: "thread_unavailable" });
    runQuery.mockResolvedValue({
      orgId,
      createdBy: "someone-else",
      visibility: "user_private",
    } as never);
    await expect(
      tools.save_connected_email_message_to_thread.execute({
        emailRef: "email",
        threadId,
      }),
    ).rejects.toThrow("Thread not found");
    expect(runAction).not.toHaveBeenCalled();
  });

  test("save and import preserve the explicit source and email-body flag", async () => {
    const { tools, runAction } = fixture();
    await tools.import_connected_email_requirement_attachments.execute({
      emailRef: "email",
      includeEmailBody: true,
      scope: "own_org",
    });
    expect(runAction.mock.lastCall?.[1]).toMatchObject({
      emailRef: "email",
      includeEmailBody: true,
      scope: "own_org",
    });
    await tools.save_connected_email_attachments_to_thread.execute({
      emailRef: "email",
      filenames: ["policy.pdf"],
    });
    expect(runAction.mock.lastCall?.[1]).toMatchObject({
      orgId,
      userId,
      threadId,
      emailRef: "email",
      filenames: ["policy.pdf"],
    });
  });
});
