/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const provider = vi.hoisted(() => ({
  listDirectoryUsers: vi.fn(),
  getDirectoryUser: vi.fn(),
  getMailboxProfile: vi.fn(),
  listMessages: vi.fn(),
  getThreadMessageIds: vi.fn(),
  getMessageMetadata: vi.fn(),
  getMessageFull: vi.fn(),
  getAttachment: vi.fn(),
}));

vi.mock("./lib/googleWorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/googleWorkspaceProvider")>()),
  createGoogleWorkspaceProvider: () => provider,
}));

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operator = async (email: string) => {
      const userId = await ctx.db.insert("users", {
        email,
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email,
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    };
    const operatorUserId = await operator("operator@example.com");
    const otherOperatorUserId = await operator("other@example.com");
    const customerUserId = await ctx.db.insert("users", {
      email: "customer@example.com",
      accountKind: "customer",
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: operatorUserId,
      visibility: "private",
      channel: "chat",
      title: "Company email",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, otherOperatorUserId, customerUserId, threadId };
  });
  const operator = t.withIdentity({ subject: `${ids.operatorUserId}|session` });
  await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
    enabled: true,
    mailboxMode: "manual",
    mailboxes: ["operator@example.com", "shared@example.com"],
  });
  const scan = (
    input: Record<string, unknown>,
    operatorUserId = ids.operatorUserId,
  ) =>
    t.action(internal.actions.operatorGoogleWorkspace.runToolInternal, {
      operatorUserId,
      threadId: ids.threadId,
      toolName: "scan_workspace_mailbox",
      input,
      channel: "chat",
    });
  return { t, ids, operator, scan };
}

describe("scan_workspace_mailbox authorization", () => {
  beforeEach(() => {
    vi.stubEnv(
      "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        type: "service_account",
        client_email: "spot-reader@example.iam.gserviceaccount.com",
        client_id: "1234567890",
        private_key:
          "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n",
      }),
    );
    provider.listMessages.mockResolvedValue({
      messages: [{ id: "m1", threadId: "thread-1" }],
      nextPageToken: null,
    });
    provider.getMessageFull.mockResolvedValue({
      id: "m1",
      threadId: "thread-1",
      internalDate: "1000",
      snippet: "COI attached",
      payload: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("scans the calling operator's mailbox by default without storing anything", async () => {
    const { scan, t } = await fixture();
    const output = await scan({ query: "COI" });
    expect(output.result).toMatchObject({
      mailbox: "operator@example.com",
      candidates: [{ messageId: "m1", threadId: "thread-1", attachments: [] }],
      completeness: "complete",
    });
    expect(output.attachments).toBeUndefined();
    expect(provider.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox: "operator@example.com" }),
    );
    expect(provider.getAttachment).not.toHaveBeenCalled();
    await expect(
      t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).resolves.toEqual([]);
  });

  it("uses the invoking operator as the default sponsor, not another operator", async () => {
    const { ids, t, scan } = await fixture();
    await t.run((ctx) => ctx.db.patch(ids.threadId, { visibility: "shared" }));
    await expect(
      scan({ query: "COI" }, ids.otherOperatorUserId),
    ).rejects.toThrow("not configured for the company");
    await expect(
      scan(
        { query: "COI", mailbox: "shared@example.com" },
        ids.otherOperatorUserId,
      ),
    ).resolves.toMatchObject({ result: { mailbox: "shared@example.com" } });
  });

  it("fails closed before Gmail access for other operators' threads, customers, and disabled access", async () => {
    const { ids, operator, scan } = await fixture();
    await expect(
      scan(
        { query: "COI", mailbox: "shared@example.com" },
        ids.otherOperatorUserId,
      ),
    ).rejects.toThrow("Operator agent thread not found");
    await expect(scan({ query: "COI" }, ids.customerUserId)).rejects.toThrow(
      "Spot operators",
    );
    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
      enabled: false,
      mailboxMode: "manual",
      mailboxes: ["operator@example.com"],
    });
    await expect(scan({ query: "COI" })).rejects.toThrow("access is disabled");
    expect(provider.listMessages).not.toHaveBeenCalled();
  });

  it("rejects out-of-bounds ranges before Gmail access", async () => {
    const { scan } = await fixture();
    await expect(
      scan({ query: "COI", dateFrom: "2026-01-01", dateTo: "2026-03-01" }),
    ).rejects.toThrow("at most 30 days");
    expect(provider.listMessages).not.toHaveBeenCalled();
  });
});
