// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const googleMocks = vi.hoisted(() => ({
  jwtOptions: [] as Array<Record<string, unknown>>,
  gmailFactory: vi.fn(),
  adminFactory: vi.fn(),
  gmailClients: [] as Array<Record<string, unknown>>,
  directoryClients: [] as Array<Record<string, unknown>>,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: class {
        subject: string;
        constructor(options: Record<string, unknown>) {
          googleMocks.jwtOptions.push(options);
          this.subject = String(options.subject);
        }
      },
    },
    gmail: googleMocks.gmailFactory,
    admin: googleMocks.adminFactory,
  },
}));

import {
  createGoogleWorkspaceProvider,
  GoogleWorkspaceProviderError,
  sanitizeGoogleWorkspaceError,
} from "./googleWorkspaceProvider";

const credentials = {
  clientEmail: "spot-reader@example.iam.gserviceaccount.com",
  clientId: "1234567890",
  privateKey: "private-key-material",
  privateKeyId: "key-id",
};

function gmailClient() {
  return {
    users: {
      getProfile: vi.fn().mockResolvedValue({
        data: { emailAddress: "operator@example.com" },
      }),
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: vi.fn().mockImplementation(({ id, format }) =>
          Promise.resolve({
            data: {
              id,
              threadId: "thread-1",
              payload: format === "minimal" ? undefined : { headers: [] },
            },
          }),
        ),
        attachments: {
          get: vi.fn().mockResolvedValue({ data: { data: "", size: 0 } }),
        },
      },
      threads: {
        get: vi.fn().mockResolvedValue({
          data: { messages: [{ id: "message-1" }] },
        }),
      },
    },
  };
}

function directoryClient() {
  return {
    users: {
      list: vi.fn().mockResolvedValue({ data: { users: [] } }),
      get: vi.fn().mockResolvedValue({
        data: {
          primaryEmail: "operator@example.com",
          name: { fullName: "Operator" },
        },
      }),
    },
  };
}

describe("Google Workspace provider boundary", () => {
  beforeEach(() => {
    googleMocks.jwtOptions.length = 0;
    googleMocks.gmailClients.length = 0;
    googleMocks.directoryClients.length = 0;
    googleMocks.gmailFactory.mockReset().mockImplementation(() => {
      const client = gmailClient();
      googleMocks.gmailClients.push(client as unknown as Record<string, unknown>);
      return client;
    });
    googleMocks.adminFactory.mockReset().mockImplementation(() => {
      const client = directoryClient();
      googleMocks.directoryClients.push(client as unknown as Record<string, unknown>);
      return client;
    });
  });

  it("isolates and reuses delegated clients by subject within one credential instance", async () => {
    const provider = createGoogleWorkspaceProvider(credentials, {
      gmail: ["gmail.readonly"],
      directory: ["directory.readonly"],
    });

    await provider.getMailboxProfile("first@example.com");
    await provider.getMessageMetadata({
      mailbox: "first@example.com",
      messageId: "message-1",
    });
    await provider.getMailboxProfile("second@example.com");
    await provider.listDirectoryUsers({
      subject: "admin@example.com",
      maxResults: 20,
    });
    await provider.getDirectoryUser({
      subject: "admin@example.com",
      userKey: "first@example.com",
    });

    expect(googleMocks.gmailFactory).toHaveBeenCalledTimes(2);
    expect(googleMocks.adminFactory).toHaveBeenCalledTimes(1);
    expect(googleMocks.jwtOptions).toHaveLength(3);
    expect(googleMocks.jwtOptions.map((options) => options.subject)).toEqual([
      "first@example.com",
      "second@example.com",
      "admin@example.com",
    ]);
    expect(googleMocks.jwtOptions[0]).toMatchObject({
      scopes: ["gmail.readonly"],
      transporterOptions: {
        timeout: 15_000,
        retry: true,
        retryConfig: { retry: 2, noResponseRetries: 2 },
      },
    });
    expect(googleMocks.jwtOptions[2]).toMatchObject({
      scopes: ["directory.readonly"],
    });

    const otherProvider = createGoogleWorkspaceProvider(credentials, {
      gmail: ["gmail.readonly"],
      directory: ["directory.readonly"],
    });
    await otherProvider.getMailboxProfile("first@example.com");
    expect(googleMocks.gmailFactory).toHaveBeenCalledTimes(3);
    expect(googleMocks.jwtOptions).toHaveLength(4);
  });

  it("requests only thread message IDs and accepts an empty attachment body", async () => {
    const provider = createGoogleWorkspaceProvider(credentials, {
      gmail: ["gmail.readonly"],
      directory: ["directory.readonly"],
    });
    await expect(
      provider.getThreadMessageIds({
        mailbox: "operator@example.com",
        threadId: "thread-1",
      }),
    ).resolves.toEqual(["message-1"]);
    await expect(
      provider.getAttachment({
        mailbox: "operator@example.com",
        messageId: "message-1",
        attachmentId: "attachment-1",
      }),
    ).resolves.toEqual({ data: "", size: 0 });

    const client = googleMocks.gmailClients[0] as ReturnType<typeof gmailClient>;
    expect(client.users.threads.get).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "minimal",
        fields: "messages/id",
      }),
      expect.objectContaining({ timeout: 15_000, retry: true }),
    );
  });

  it("never leaks provider request or credential payloads through errors", async () => {
    googleMocks.gmailFactory.mockImplementationOnce(() => {
      const client = gmailClient();
      client.users.messages.get.mockRejectedValue({
        message: "private_key=LEAK token=LEAK",
        response: { status: 403, config: { data: "assertion=LEAK" } },
      });
      googleMocks.gmailClients.push(client as unknown as Record<string, unknown>);
      return client;
    });
    const provider = createGoogleWorkspaceProvider(credentials, {
      gmail: ["gmail.readonly"],
      directory: ["directory.readonly"],
    });
    const error = await provider
      .getMessageFull({
        mailbox: "operator@example.com",
        messageId: "message-1",
      })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GoogleWorkspaceProviderError);
    expect(String(error)).toContain("denied delegated access");
    expect(String(error)).not.toMatch(/LEAK|private_key|assertion|token=/);

    expect(
      sanitizeGoogleWorkspaceError({
        message: "private_key=LEAK",
        config: { data: "assertion=LEAK" },
      }),
    ).toBe("Google Workspace request failed.");
  });
});
