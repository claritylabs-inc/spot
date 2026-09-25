// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import dayjs from "dayjs";
import type { Id } from "../_generated/dataModel";
import {
  availableOperatorAgentToolNames,
  getOperatorAgentToolSpec,
  parseOperatorAgentToolInput,
} from "./operatorAgentToolRegistry";
import type {
  GoogleWorkspaceMessage,
  GoogleWorkspaceMessagePart,
  GoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";
import {
  runGoogleWorkspaceTool,
  scanWorkspaceMailbox,
  type GoogleWorkspaceToolDependencies,
} from "./googleWorkspaceTools";

function part(
  overrides: Partial<GoogleWorkspaceMessagePart> = {},
): GoogleWorkspaceMessagePart {
  return {
    partId: "0",
    mimeType: "text/plain",
    filename: "",
    headers: [],
    body: {
      attachmentId: null,
      size: 4,
      data: Buffer.from("body").toString("base64url"),
    },
    parts: [],
    ...overrides,
  };
}

function attachment(
  partId: string,
  filename: string,
  mimeType: string,
  disposition = "attachment",
) {
  return part({
    partId,
    filename,
    mimeType,
    headers: [
      {
        name: "Content-Disposition",
        value: `${disposition}; filename="${filename}"`,
      },
    ],
    body: { attachmentId: `raw-${partId}`, size: 100, data: null },
  });
}

function message(
  id: string,
  payload: GoogleWorkspaceMessagePart,
): GoogleWorkspaceMessage {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(dayjs("2026-09-15T10:00:00Z").valueOf()),
    snippet: "Attached is the renewal policy",
    payload,
  };
}

const withAttachments = message(
  "m1",
  part({
    mimeType: "multipart/mixed",
    headers: [
      { name: "Subject", value: "Acme renewal" },
      { name: "From", value: "Broker <broker@example.com>" },
      { name: "Date", value: "Tue, 15 Sep 2026 10:00:00 +0000" },
    ],
    body: { attachmentId: null, size: 0, data: null },
    parts: [
      part(),
      attachment("1", "policy.pdf", "application/pdf"),
      attachment("2", "schedule.xlsx", "application/vnd.ms-excel"),
      attachment("3", "logo.png", "image/png", "inline"),
    ],
  }),
);

function setup(
  overrides: Partial<GoogleWorkspaceProvider> = {},
  operatorMailbox = "a@example.com",
): GoogleWorkspaceToolDependencies {
  return {
    config: {
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["a@example.com", "b@example.com"],
      directoryAdminEmail: null,
      updatedAt: 123,
    },
    cursorSecret: "synthetic-test-secret",
    operatorMailbox,
    provider: {
      listDirectoryUsers: vi.fn(),
      getDirectoryUser: vi.fn(),
      getMailboxProfile: vi.fn(),
      listMessages: vi.fn(async () => ({
        messages: [{ id: "m1", threadId: "thread-m1" }],
        nextPageToken: null,
      })),
      getThreadMessageIds: vi.fn(),
      getMessageMetadata: vi.fn(),
      getMessageFull: vi.fn(async () => withAttachments),
      getAttachment: vi.fn(),
      ...overrides,
    },
    attachmentStorage: {
      store: vi.fn(async () => "stored" as Id<"_storage">),
      delete: vi.fn(async () => {}),
      read: vi.fn(async () => ({})),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scan_workspace_mailbox result shape", () => {
  test("returns candidates with suggested follow-up tools and never writes", async () => {
    const deps = setup();
    const result = await scanWorkspaceMailbox(deps, { query: "Acme policy" });

    expect(result).toEqual({
      mailbox: "a@example.com",
      query: `(Acme policy) -in:drafts after:${dayjs("2026-08-26T00:00:00Z").valueOf() / 1000} before:${dayjs("2026-09-25T00:00:00Z").valueOf() / 1000}`,
      dateFrom: "2026-08-26",
      dateTo: "2026-09-24",
      candidates: [
        {
          messageId: "m1",
          threadId: "thread-m1",
          subject: "Acme renewal",
          from: "Broker <broker@example.com>",
          date: "Tue, 15 Sep 2026 10:00:00 +0000",
          snippet: "Attached is the renewal policy",
          attachments: [
            expect.objectContaining({
              attachmentId: "part:1",
              filename: "policy.pdf",
              contentType: "application/pdf",
              suggestedActions: [
                {
                  tool: "get_company_email_attachment",
                  input: {
                    mailbox: "a@example.com",
                    messageId: "m1",
                    attachmentId: "part:1",
                  },
                  reason: expect.any(String),
                },
                { tool: "import_policy_files", reason: expect.any(String) },
              ],
            }),
            expect.objectContaining({
              attachmentId: "part:2",
              filename: "schedule.xlsx",
              suggestedActions: [
                expect.objectContaining({
                  tool: "get_company_email_attachment",
                }),
              ],
            }),
          ],
          suggestedActions: [
            {
              tool: "read_company_email_thread",
              input: { mailbox: "a@example.com", threadId: "thread-m1" },
              reason: expect.any(String),
            },
          ],
        },
      ],
      errors: [],
      hasMoreMatches: false,
      completeness: "complete",
    });
    expect(deps.provider.listMessages).toHaveBeenCalledWith({
      mailbox: "a@example.com",
      query: result.query,
      maxResults: 20,
    });
    expect(deps.provider.getAttachment).not.toHaveBeenCalled();
    expect(deps.attachmentStorage.store).not.toHaveBeenCalled();
  });

  test("reports remaining matches and per-message failures as partial", async () => {
    const deps = setup({
      listMessages: vi.fn(async () => ({
        messages: [
          { id: "m1", threadId: "thread-m1" },
          { id: "m2", threadId: "thread-m2" },
        ],
        nextPageToken: "more",
      })),
      getMessageFull: vi.fn(async ({ messageId }) => {
        if (messageId === "m2") throw { response: { status: 404 } };
        return withAttachments;
      }),
    });
    const result = await scanWorkspaceMailbox(deps, {
      query: "Acme",
      mailbox: "B@example.com",
      limit: 2,
    });
    expect(result).toMatchObject({
      mailbox: "b@example.com",
      hasMoreMatches: true,
      completeness: "partial",
      errors: [
        {
          messageId: "m2",
          error: "The requested Google Workspace resource was not found.",
        },
      ],
    });
    expect(result.candidates.map((candidate) => candidate.messageId)).toEqual([
      "m1",
    ]);
  });

  test("does not return messages outside the date window or from excluded labels", async () => {
    const deps = setup({
      listMessages: vi.fn(async () => ({
        messages: [
          { id: "old", threadId: "thread-old" },
          { id: "draft", threadId: "thread-draft" },
        ],
        nextPageToken: null,
      })),
      getMessageFull: vi.fn(async ({ messageId }) => ({
        ...withAttachments,
        id: messageId,
        threadId: `thread-${messageId}`,
        internalDate: String(
          dayjs(messageId === "old" ? "2026-08-01" : "2026-09-15").valueOf(),
        ),
        labelIds: messageId === "draft" ? ["DRAFT"] : [],
      })),
    });
    const result = await scanWorkspaceMailbox(deps, { query: "policy" });
    expect(result).toMatchObject({
      candidates: [],
      completeness: "partial",
      errors: [
        {
          messageId: "old",
          error: "Message is outside the eligible scan window.",
        },
        {
          messageId: "draft",
          error: "Message is outside the eligible scan window.",
        },
      ],
    });
  });

  test("dispatches through the shared Google Workspace tool runner", async () => {
    const deps = setup();
    const input = parseOperatorAgentToolInput("scan_workspace_mailbox", {
      query: "COI",
      mailbox: null,
      dateFrom: "2026-09-01",
      dateTo: null,
      limit: null,
    });
    expect(input).toEqual({ query: "COI", dateFrom: "2026-09-01" });
    const output = await runGoogleWorkspaceTool(
      deps,
      "scan_workspace_mailbox",
      input,
    );
    expect(output.result).toMatchObject({
      mailbox: "a@example.com",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-24",
    });
    expect(output).not.toHaveProperty("attachments");
  });
});

describe("scan_workspace_mailbox bounds", () => {
  test("caps an open-ended start date at 30 days", async () => {
    const result = await scanWorkspaceMailbox(setup(), {
      query: "Acme",
      dateFrom: "2026-06-01",
    });
    expect(result).toMatchObject({
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });
  });

  test.each([
    [{ dateFrom: "2026-08-01", dateTo: "2026-09-24" }, "at most 30 days"],
    [{ dateFrom: "2026-08-25", dateTo: "2026-09-24" }, "at most 30 days"],
    [{ dateFrom: "2026-09-10", dateTo: "2026-09-01" }, "on or before"],
    [{ dateFrom: "2026-02-30" }, "YYYY-MM-DD"],
    [{ dateTo: "09/01/2026" }, "YYYY-MM-DD"],
    [{ limit: 26 }, "between 1 and 25"],
    [{ limit: 0 }, "between 1 and 25"],
    [{ query: "x".repeat(501) }, "1 to 500 characters"],
    [{ query: "   " }, "1 to 500 characters"],
  ])("rejects %j before any Gmail access", async (override, error) => {
    const deps = setup();
    await expect(
      scanWorkspaceMailbox(deps, { query: "Acme", ...override }),
    ).rejects.toThrow(error);
    expect(deps.provider.listMessages).not.toHaveBeenCalled();
  });

  test("accepts exactly 30 inclusive days", async () => {
    await expect(
      scanWorkspaceMailbox(setup(), {
        query: "Acme",
        dateFrom: "2026-08-26",
        dateTo: "2026-09-24",
      }),
    ).resolves.toMatchObject({ completeness: "complete" });
  });

  test("model-facing schema enforces the same bounds", () => {
    expect(() =>
      parseOperatorAgentToolInput("scan_workspace_mailbox", {
        query: "Acme",
        limit: 26,
      }),
    ).toThrow();
    expect(() =>
      parseOperatorAgentToolInput("scan_workspace_mailbox", {
        query: "Acme",
        dateFrom: "Sept 1",
      }),
    ).toThrow();
    expect(() =>
      parseOperatorAgentToolInput("scan_workspace_mailbox", {
        query: "Acme",
        mailbox: "not-an-email",
      }),
    ).toThrow();
  });
});

describe("scan_workspace_mailbox authorization", () => {
  test("is a read-only company email tool gated on the Workspace integration", () => {
    expect(getOperatorAgentToolSpec("scan_workspace_mailbox")).toMatchObject({
      capability: "operator.company_email.read",
      family: "company_email",
      effect: "read",
      confirmation: "none",
      requiredRole: "operator",
      execution: "action",
    });
    const access = {
      role: "operator" as const,
      impersonating: false,
      integrations: {
        google_workspace: false,
        slack: false,
        mcp: false,
        mapbox: false,
      },
    };
    expect(availableOperatorAgentToolNames(access)).not.toContain(
      "scan_workspace_mailbox",
    );
    expect(
      availableOperatorAgentToolNames({
        ...access,
        integrations: { ...access.integrations, google_workspace: true },
      }),
    ).toContain("scan_workspace_mailbox");
  });

  test("rejects mailboxes outside the configured company roster", async () => {
    const deps = setup();
    await expect(
      scanWorkspaceMailbox(deps, { query: "Acme", mailbox: "x@example.com" }),
    ).rejects.toThrow("not configured for the company");
    expect(deps.provider.listMessages).not.toHaveBeenCalled();
  });

  test("defaults to the operator's mailbox only when it is a company mailbox", async () => {
    const outside = setup({}, "operator@example.com");
    await expect(
      scanWorkspaceMailbox(outside, { query: "Acme" }),
    ).rejects.toThrow("not configured for the company");
    expect(outside.provider.listMessages).not.toHaveBeenCalled();

    await expect(
      scanWorkspaceMailbox(
        { ...setup(), operatorMailbox: undefined },
        { query: "Acme" },
      ),
    ).rejects.toThrow("Choose a company mailbox");
  });

  test("uses Directory eligibility in directory mode", async () => {
    const deps = setup({
      getDirectoryUser: vi.fn(async () => ({
        primaryEmail: "a@example.com",
        displayName: null,
        aliases: [],
        suspended: true,
        archived: false,
        mailboxSetup: true,
      })),
    });
    deps.config = {
      ...deps.config,
      mailboxMode: "directory",
      directoryAdminEmail: "admin@example.com",
    };
    await expect(scanWorkspaceMailbox(deps, { query: "Acme" })).rejects.toThrow(
      "not an active company mailbox",
    );
    expect(deps.provider.listMessages).not.toHaveBeenCalled();
  });
});
