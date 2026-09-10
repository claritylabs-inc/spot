// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { GOOGLE_WORKSPACE_LIMITS } from "./googleWorkspace";
import { parseOperatorAgentToolInput } from "./operatorAgentToolRegistry";
import type {
  GoogleWorkspaceDirectoryUser,
  GoogleWorkspaceMessage,
  GoogleWorkspaceMessagePart,
  GoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";
import {
  getCompanyEmailAttachment,
  runGoogleWorkspaceTool,
  listCompanyMailboxes,
  readCompanyEmailThread,
  searchCompanyEmail,
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
function message(id = "m1", payload = part()): GoogleWorkspaceMessage {
  return {
    id,
    threadId: "thread",
    internalDate: "1000",
    snippet: "summary",
    payload,
  };
}
function directoryUser(index: number): GoogleWorkspaceDirectoryUser {
  return {
    primaryEmail: `person${index}@example.com`,
    displayName: null,
    aliases: [],
    suspended: false,
    archived: false,
    mailboxSetup: true,
  };
}
function setup(
  overrides: Partial<GoogleWorkspaceProvider> = {},
): GoogleWorkspaceToolDependencies {
  return {
    config: {
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["a@example.com", "b@example.com"],
      directoryAdminEmail: "admin@example.com",
      updatedAt: 123,
    },
    cursorSecret: "synthetic-test-secret",
    provider: {
      listDirectoryUsers: vi.fn(async () => ({
        users: [],
        nextPageToken: null,
      })),
      getDirectoryUser: vi.fn(async ({ userKey }) => ({
        ...directoryUser(0),
        primaryEmail: userKey,
      })),
      getMailboxProfile: vi.fn(async (mailbox) => ({ emailAddress: mailbox })),
      listMessages: vi.fn(async () => ({
        messages: [{ id: "m1", threadId: "thread" }],
        nextPageToken: null,
      })),
      getThreadMessageIds: vi.fn(async () => ["m1"]),
      getMessageMetadata: vi.fn(async ({ messageId }) => message(messageId)),
      getMessageFull: vi.fn(async ({ messageId }) => message(messageId)),
      getAttachment: vi.fn(async () => ({
        data: Buffer.from("content").toString("base64url"),
        size: 7,
      })),
      ...overrides,
    },
    attachmentStorage: {
      store: vi.fn(async () => "original" as Id<"_storage">),
      delete: vi.fn(async () => {}),
      read: vi.fn(async () => ({ text: "extracted" })),
    },
  };
}

async function allMailboxPages(deps: GoogleWorkspaceToolDependencies) {
  const mailboxes: string[] = [];
  let cursor: string | undefined;
  for (let calls = 0; calls < 20; calls++) {
    const page = await listCompanyMailboxes(deps, { limit: 20, cursor });
    mailboxes.push(...page.mailboxes.map((mailbox) => mailbox.mailbox));
    if (!page.nextCursor) {
      expect(page.completeness).toBe("complete");
      return mailboxes;
    }
    cursor = page.nextCursor;
  }
  throw new Error("Directory pagination did not terminate");
}

describe("company Gmail continuation boundaries", () => {
  test("model null optionals reach Gmail providers as omitted inputs", async () => {
    const deps = setup();
    const cases = [
      { name: "list_company_mailboxes", input: { cursor: null, limit: 1 } },
      {
        name: "search_company_email",
        input: { query: "warehouse", mailboxes: null, cursor: null, limit: 10 },
      },
      {
        name: "read_company_email_thread",
        input: {
          mailbox: "a@example.com",
          threadId: "thread",
          cursor: null,
          limit: null,
        },
      },
    ] as const;
    for (const { name, input } of cases) {
      const parsed = parseOperatorAgentToolInput(name, input);
      expect(parsed).not.toHaveProperty("cursor");
      expect(parsed).not.toHaveProperty("mailboxes");
      if (input.limit === null) expect(parsed).not.toHaveProperty("limit");
      await expect(
        runGoogleWorkspaceTool(deps, name, parsed),
      ).resolves.toHaveProperty("result");
    }
    expect(deps.provider.listMessages).toHaveBeenCalledTimes(2);
    expect(deps.provider.getMessageFull).toHaveBeenCalled();
  });

  test("does not drop Directory users when short pages contain ineligible users", async () => {
    const users = Array.from({ length: 83 }, (_, i) => ({
      ...directoryUser(i),
      suspended: i % 4 === 0,
    }));
    const deps = setup({
      listDirectoryUsers: vi.fn(async ({ pageToken, maxResults }) => {
        const offset = Number(pageToken ?? 0);
        return {
          users: users.slice(offset, offset + maxResults),
          nextPageToken:
            offset + maxResults < users.length
              ? String(offset + maxResults)
              : null,
        };
      }),
    });
    deps.config.mailboxMode = "directory";
    expect(await allMailboxPages(deps)).toEqual(
      users.filter((user) => !user.suspended).map((user) => user.primaryEmail),
    );
  });

  test("bounds entirely filtered Directory search and resumes to a later eligible mailbox", async () => {
    const deps = setup({
      listDirectoryUsers: vi.fn(async ({ pageToken }) => {
        const page = Number(pageToken ?? 0);
        return {
          users: [{ ...directoryUser(page), suspended: page < 4 }],
          nextPageToken: page < 4 ? String(page + 1) : null,
        };
      }),
    });
    deps.config.mailboxMode = "directory";
    const first = await searchCompanyEmail(deps, { query: "insurance" });
    expect(deps.provider.listDirectoryUsers).toHaveBeenCalledTimes(3);
    expect(first.messages).toEqual([]);
    expect(first.nextCursor).toBeTruthy();
    const last = await searchCompanyEmail(deps, {
      query: "insurance",
      cursor: first.nextCursor!,
    });
    expect(last.messages.map((item) => item.mailbox)).toEqual([
      "person4@example.com",
    ]);
    expect(last.completeness).toBe("complete");
  });

  test("rejects forged, query-changed, settings-changed and rotated-credential cursors before provider access", async () => {
    const deps = setup();
    const first = await searchCompanyEmail(deps, {
      query: "insurance",
      limit: 1,
    });
    const [payload, signature] = first.nextCursor!.split(".");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    value.state.mailboxes = ["outside@example.com"];
    const forged = `${Buffer.from(JSON.stringify(value)).toString("base64url")}.${signature}`;
    vi.mocked(deps.provider.listMessages).mockClear();
    await expect(
      searchCompanyEmail(deps, {
        query: "insurance",
        limit: 1,
        cursor: forged,
      }),
    ).rejects.toThrow("cursor");
    await expect(
      searchCompanyEmail(deps, {
        query: "different",
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow("cursor");
    await expect(
      searchCompanyEmail(
        { ...deps, cursorSecret: "rotated" },
        { query: "insurance", limit: 1, cursor: first.nextCursor! },
      ),
    ).rejects.toThrow("cursor");
    await expect(
      searchCompanyEmail(
        { ...deps, config: { ...deps.config, updatedAt: 124 } },
        { query: "insurance", limit: 1, cursor: first.nextCursor! },
      ),
    ).rejects.toThrow("cursor");
    expect(deps.provider.listMessages).not.toHaveBeenCalled();
    expect(deps.provider.getDirectoryUser).not.toHaveBeenCalled();
  });

  test("preserves failed-mailbox completeness and all Gmail matches across exact continuations", async () => {
    const deps = setup({
      listMessages: vi.fn(async ({ mailbox, pageToken, maxResults }) => {
        if (mailbox === "a@example.com")
          throw { response: { status: 403 }, secret: "must-not-escape" };
        const ids = ["m1", "m2", "m3"];
        const offset = Number(pageToken ?? 0);
        return {
          messages: ids
            .slice(offset, offset + maxResults)
            .map((id) => ({ id, threadId: "thread" })),
          nextPageToken:
            offset + maxResults < ids.length
              ? String(offset + maxResults)
              : null,
        };
      }),
    });
    const first = await searchCompanyEmail(deps, {
      query: "insurance",
      limit: 2,
    });
    expect(first.messages.map((item) => item.messageId)).toEqual(["m1", "m2"]);
    expect(JSON.stringify(first)).not.toContain("must-not-escape");
    const last = await searchCompanyEmail(deps, {
      query: "insurance",
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(last.messages.map((item) => item.messageId)).toEqual(["m3"]);
    expect(last).toMatchObject({
      nextCursor: null,
      completeness: "partial",
      encounteredErrorCount: 1,
    });
  });

  test("keeps a maximum manual roster out of cursors without losing later mailboxes", async () => {
    const deps = setup();
    deps.config.mailboxes = Array.from(
      { length: 100 },
      (_, i) => `${i}${"x".repeat(290)}@example.com`,
    );
    let cursor: string | undefined;
    const found: string[] = [];
    for (let i = 0; i < 10; i++) {
      const page = await searchCompanyEmail(deps, {
        query: "insurance",
        limit: 10,
        cursor,
      });
      found.push(...page.messages.map((item) => item.mailbox));
      cursor = page.nextCursor ?? undefined;
      if (cursor)
        expect(cursor.length).toBeLessThan(
          GOOGLE_WORKSPACE_LIMITS.maxCursorChars,
        );
    }
    expect(found).toEqual(deps.config.mailboxes);
    expect(cursor).toBeUndefined();
  });
});

describe("company Gmail original bodies and attachments", () => {
  test("continues long recursive MIME bodies exactly and rejects stale thread continuation", async () => {
    const body = "Current reply. ".repeat(9000);
    const payload = part({
      mimeType: "multipart/mixed",
      body: { attachmentId: null, data: null, size: 0 },
      parts: [
        part({
          body: {
            attachmentId: null,
            data: Buffer.from(body).toString("base64url"),
            size: body.length,
          },
        }),
        part({
          filename: "old-email.txt",
          body: {
            attachmentId: null,
            data: Buffer.from("exclude attachment text").toString("base64url"),
            size: 23,
          },
        }),
      ],
    });
    const deps = setup({
      getMessageFull: vi.fn(async () =>
        message("m1", structuredClone(payload)),
      ),
    });
    const first = await readCompanyEmailThread(deps, {
      mailbox: "a@example.com",
      threadId: "thread",
    });
    expect(first.messages[0].bodyComplete).toBe(false);
    const last = await readCompanyEmailThread(deps, {
      mailbox: "a@example.com",
      threadId: "thread",
      cursor: first.nextCursor!,
    });
    expect(first.messages[0].body + last.messages[0].body).toBe(body.trim());
    expect(last.completeness).toBe("complete");
    vi.mocked(deps.provider.getThreadMessageIds).mockResolvedValue([
      "m1",
      "m2",
    ]);
    await expect(
      readCompanyEmailThread(deps, {
        mailbox: "a@example.com",
        threadId: "thread",
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow("thread changed");
  });

  test("retrieves external HTML body parts and reports oversized original parts as incomplete", async () => {
    const payload = part({
      mimeType: "text/html",
      body: { attachmentId: "external-body", data: null, size: 20 },
    });
    const deps = setup({
      getMessageFull: vi.fn(async () =>
        message("m1", structuredClone(payload)),
      ),
      getAttachment: vi.fn(async () => ({
        data: Buffer.from(
          "<p>Latest facts</p><script>ignore()</script>",
        ).toString("base64url"),
        size: 43,
      })),
    });
    const complete = await readCompanyEmailThread(deps, {
      mailbox: "a@example.com",
      threadId: "thread",
    });
    expect(complete.messages[0]).toMatchObject({
      body: "Latest facts",
      bodyFormat: "html_fallback",
      bodySourceComplete: true,
    });
    payload.body.size = 3 * 1024 * 1024;
    vi.mocked(deps.provider.getAttachment).mockClear();
    const incomplete = await readCompanyEmailThread(deps, {
      mailbox: "a@example.com",
      threadId: "thread",
    });
    expect(incomplete).toMatchObject({
      completeness: "partial",
      nextCursor: null,
    });
    expect(incomplete.messages[0]).toMatchObject({
      bodyComplete: false,
      bodySourceComplete: false,
      bodyUnavailableParts: [{ attachmentId: "part:0" }],
    });
    expect(deps.provider.getAttachment).not.toHaveBeenCalled();
  });

  test("binds attachments to the stated parent, allows zero bytes, and cleans failed extraction", async () => {
    const payload = part({
      filename: "empty.txt",
      body: { attachmentId: null, data: "", size: 0 },
    });
    const deps = setup({
      getMessageFull: vi.fn(async () =>
        message("m1", structuredClone(payload)),
      ),
    });
    await expect(
      getCompanyEmailAttachment(deps, {
        mailbox: "a@example.com",
        messageId: "m1",
        attachmentId: "other-parent",
      }),
    ).rejects.toThrow("not part");
    expect(deps.attachmentStorage.store).not.toHaveBeenCalled();
    const output = await getCompanyEmailAttachment(deps, {
      mailbox: "a@example.com",
      messageId: "m1",
      attachmentId: "part:0",
    });
    expect(output.attachment).toMatchObject({ filename: "empty.txt", size: 0 });
    vi.mocked(deps.attachmentStorage.read).mockRejectedValue(
      new Error("extraction failed"),
    );
    await expect(
      getCompanyEmailAttachment(deps, {
        mailbox: "a@example.com",
        messageId: "m1",
        attachmentId: "part:0",
      }),
    ).rejects.toThrow("extraction failed");
    expect(deps.attachmentStorage.delete).toHaveBeenCalledWith("original");
  });

  test("uses short MIME references for remote originals and rejects ambiguous or wrong parents", async () => {
    const rawId = "provider-attachment-".repeat(25);
    const attachment = part({
      partId: "1.0",
      filename: "evidence.txt",
      body: { attachmentId: rawId, data: null, size: 4 },
    });
    const payload = part({
      partId: "",
      mimeType: "multipart/mixed",
      body: { attachmentId: null, data: null, size: 0 },
      parts: [
        part({
          partId: "1",
          mimeType: "multipart/mixed",
          body: { attachmentId: null, data: null, size: 0 },
          parts: [attachment],
        }),
      ],
    });
    const deps = setup({
      getMessageFull: vi.fn(async () =>
        message("m1", structuredClone(payload)),
      ),
    });
    const thread = await readCompanyEmailThread(deps, {
      mailbox: "a@example.com",
      threadId: "thread",
    });
    const metadata = thread.messages[0].attachments[0];
    expect(metadata).toMatchObject({
      attachmentId: "part:1.0",
      partId: "1.0",
      filename: "evidence.txt",
    });
    expect(JSON.stringify(thread)).not.toContain(rawId);
    const input = {
      mailbox: "a@example.com",
      messageId: "m1",
      attachmentId: metadata.attachmentId,
    };
    const output = await getCompanyEmailAttachment(deps, input);
    expect(deps.provider.getAttachment).toHaveBeenCalledWith({
      mailbox: input.mailbox,
      messageId: input.messageId,
      attachmentId: rawId,
    });
    expect(output.result.source).toMatchObject({ ...input, partId: "1.0" });
    await expect(
      getCompanyEmailAttachment(deps, { ...input, attachmentId: rawId }),
    ).resolves.toHaveProperty("attachment");
    vi.mocked(deps.provider.getAttachment).mockClear();
    await expect(
      getCompanyEmailAttachment(deps, {
        ...input,
        attachmentId: "part:missing",
      }),
    ).rejects.toThrow("not part");
    await expect(
      getCompanyEmailAttachment(deps, { ...input, messageId: "other-parent" }),
    ).rejects.toThrow("identity changed");
    payload.parts.push(structuredClone(attachment));
    await expect(getCompanyEmailAttachment(deps, input)).rejects.toThrow(
      "not part",
    );
    expect(deps.provider.getAttachment).not.toHaveBeenCalled();
  });

  test("enforces the 15 MiB cap on both declared and actual attachment bytes", async () => {
    const payload = part({
      filename: "document.bin",
      body: {
        attachmentId: "original",
        data: null,
        size: GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes,
      },
    });
    const bytes = Buffer.alloc(GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes);
    const deps = setup({
      getMessageFull: vi.fn(async () =>
        message("m1", structuredClone(payload)),
      ),
      getAttachment: vi.fn(async () => ({
        data: bytes.toString("base64url"),
        size: bytes.length,
      })),
    });
    const args = {
      mailbox: "a@example.com",
      messageId: "m1",
      attachmentId: "original",
    };
    expect((await getCompanyEmailAttachment(deps, args)).attachment.size).toBe(
      bytes.length,
    );
    payload.body.size += 1;
    vi.mocked(deps.provider.getAttachment).mockClear();
    await expect(getCompanyEmailAttachment(deps, args)).rejects.toThrow(
      "15 MiB",
    );
    expect(deps.provider.getAttachment).not.toHaveBeenCalled();
    payload.body.size = 1;
    vi.mocked(deps.provider.getAttachment).mockResolvedValue({
      data: Buffer.alloc(bytes.length + 1).toString("base64url"),
      size: bytes.length + 1,
    });
    await expect(getCompanyEmailAttachment(deps, args)).rejects.toThrow(
      "15 MiB",
    );
    expect(deps.attachmentStorage.store).toHaveBeenCalledTimes(1);
  });
});

test("cleans an original if extraction would exceed lossless replay storage", async () => {
  const deps = setup({
    getMessageFull: vi.fn(async () =>
      message("m1", part({ filename: "original.txt" })),
    ),
  });
  vi.mocked(deps.attachmentStorage.read).mockResolvedValue({
    text: "x".repeat(600_000),
  });
  await expect(
    runGoogleWorkspaceTool(deps, "get_company_email_attachment", {
      mailbox: "a@example.com",
      messageId: "m1",
      attachmentId: "part:0",
    }),
  ).rejects.toThrow("result is too large");
  expect(deps.attachmentStorage.delete).toHaveBeenCalledWith("original");
});

test("preserves recipients whose quoted display names contain commas", async () => {
  const deps = setup({
    getMessageMetadata: vi.fn(async () =>
      message(
        "m1",
        part({
          headers: [
            {
              name: "To",
              value: '\"Doe, Jane\" <jane@example.com>, Bob <bob@example.com>',
            },
            { name: "Cc", value: "team@example.com" },
          ],
        }),
      ),
    ),
  });
  const page = await searchCompanyEmail(deps, { query: "insurance", limit: 1 });
  expect(page.messages[0]).toMatchObject({
    to: ["Doe, Jane <jane@example.com>", "Bob <bob@example.com>"],
    cc: ["team@example.com"],
  });
});
