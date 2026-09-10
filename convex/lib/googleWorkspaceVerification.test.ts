// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { OperatorGoogleWorkspaceConfig } from "./googleWorkspace";
import type {
  GoogleWorkspaceDirectoryUser,
  GoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";
import { verifyGoogleWorkspaceConnection } from "./googleWorkspaceVerification";

function config(
  overrides: Partial<OperatorGoogleWorkspaceConfig> = {},
): OperatorGoogleWorkspaceConfig {
  return {
    enabled: true,
    mailboxMode: "manual",
    mailboxes: ["first@example.com"],
    directoryAdminEmail: null,
    updatedAt: 100,
    ...overrides,
  };
}

function provider(
  overrides: Partial<GoogleWorkspaceProvider> = {},
): GoogleWorkspaceProvider {
  return {
    listDirectoryUsers: vi.fn().mockResolvedValue({
      users: [],
      nextPageToken: null,
    }),
    getDirectoryUser: vi.fn(),
    getMailboxProfile: vi.fn().mockImplementation(async (mailbox: string) => ({
      emailAddress: mailbox,
    })),
    listMessages: vi.fn(),
    getThreadMessageIds: vi.fn(),
    getMessageMetadata: vi.fn(),
    getMessageFull: vi.fn(),
    getAttachment: vi.fn(),
    ...overrides,
  };
}

function directoryUser(
  primaryEmail: string,
  overrides: Partial<GoogleWorkspaceDirectoryUser> = {},
): GoogleWorkspaceDirectoryUser {
  return {
    primaryEmail,
    displayName: null,
    aliases: [],
    suspended: false,
    archived: false,
    mailboxSetup: true,
    ...overrides,
  };
}

describe("Google Workspace verification", () => {
  it("returns complete only after every configured mailbox succeeds", async () => {
    const result = await verifyGoogleWorkspaceConnection(
      provider(),
      config({ mailboxes: ["first@example.com", "second@example.com"] }),
    );
    expect(result).toMatchObject({
      status: "verified",
      completeness: "complete",
      configUpdatedAt: 100,
      checkedMailboxCount: 2,
      totalMailboxCount: 2,
      directory: {
        status: "not_required",
        totalMailboxCount: 2,
      },
    });
    expect(result.mailboxes).toEqual([
      { mailbox: "first@example.com", status: "verified", error: null },
      { mailbox: "second@example.com", status: "verified", error: null },
    ]);
  });

  it("returns sanitized partial diagnostics for a mailbox failure", async () => {
    const getMailboxProfile = vi
      .fn()
      .mockImplementation(async (mailbox: string) => {
        if (mailbox === "second@example.com") {
          throw {
            message: "private_key=LEAK token=LEAK",
            response: { status: 403, config: { data: "assertion=LEAK" } },
          };
        }
        return { emailAddress: mailbox };
      });
    const result = await verifyGoogleWorkspaceConnection(
      provider({ getMailboxProfile }),
      config({ mailboxes: ["first@example.com", "second@example.com"] }),
    );
    expect(result.status).toBe("partial");
    expect(result.completeness).toBe("partial");
    expect(result.checkedMailboxCount).toBe(2);
    expect(result.mailboxes[1]).toEqual({
      mailbox: "second@example.com",
      status: "failed",
      error:
        "Google Workspace denied delegated access. Check domain-wide delegation, scopes, and the impersonated account.",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /LEAK|private_key|assertion|token=/,
    );
  });

  it("uses customer-wide Directory enumeration, filters ineligible users, and never overstates a bounded sample", async () => {
    const firstPage = [
      ...Array.from({ length: 48 }, (_, index) =>
        directoryUser(`person-${index}@spot.insure`),
      ),
      directoryUser("suspended@glass.insure", { suspended: true }),
      directoryUser("archived@claritylabs.inc", { archived: true }),
    ];
    const secondPage = Array.from({ length: 50 }, (_, index) =>
      directoryUser(`person-${index}@glass.insure`),
    );
    const thirdPage = Array.from({ length: 3 }, (_, index) =>
      directoryUser(`person-${index}@claritylabs.inc`),
    );
    const listDirectoryUsers = vi
      .fn()
      .mockResolvedValueOnce({ users: firstPage, nextPageToken: "page-2" })
      .mockResolvedValueOnce({ users: secondPage, nextPageToken: "page-3" })
      .mockResolvedValueOnce({ users: thirdPage, nextPageToken: null });
    const result = await verifyGoogleWorkspaceConnection(
      provider({ listDirectoryUsers }),
      config({
        mailboxMode: "directory",
        mailboxes: [],
        directoryAdminEmail: "admin@claritylabs.inc",
      }),
    );

    expect(listDirectoryUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "admin@claritylabs.inc",
        maxResults: 50,
      }),
    );
    expect(result).toMatchObject({
      status: "partial",
      completeness: "partial",
      checkedMailboxCount: 100,
      totalMailboxCount: null,
      maxMailboxChecks: 100,
      directory: {
        status: "partial",
        discoveredMailboxCount: 100,
        totalMailboxCount: null,
        hasMore: true,
        error: null,
      },
    });
    expect(
      result.mailboxes.some(({ mailbox }) => mailbox.endsWith("@spot.insure")),
    ).toBe(true);
    expect(
      result.mailboxes.some(({ mailbox }) => mailbox.endsWith("@glass.insure")),
    ).toBe(true);
    expect(result.mailboxes).not.toContainEqual(
      expect.objectContaining({ mailbox: "suspended@glass.insure" }),
    );
  });

  it("bounds mailbox verification by an overall deadline", async () => {
    const getMailboxProfile = vi.fn(
      (_mailbox: string, options?: { signal?: AbortSignal }) =>
        new Promise<{ emailAddress: string }>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject({ code: "ABORT_ERR" }),
          );
        }),
    );
    const mailboxes = Array.from(
      { length: 11 },
      (_, index) => `person-${index}@example.com`,
    );
    const result = await verifyGoogleWorkspaceConnection(
      provider({ getMailboxProfile }),
      config({ mailboxes }),
      { deadlineMs: 5 },
    );
    expect(result).toMatchObject({
      status: "failed",
      completeness: "partial",
      checkedMailboxCount: 0,
      totalMailboxCount: 11,
      error: "Google Workspace verification reached its time limit.",
    });
    expect(result.mailboxes).toHaveLength(0);
    expect(getMailboxProfile).toHaveBeenCalledTimes(10);
  });

  it("applies the same deadline to Directory enumeration even when token fetch ignores abort", async () => {
    const listDirectoryUsers = vi
      .fn()
      .mockResolvedValueOnce({
        users: [directoryUser("first@spot.insure")],
        nextPageToken: "page-2",
      })
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const result = await verifyGoogleWorkspaceConnection(
      provider({ listDirectoryUsers }),
      config({
        mailboxMode: "directory",
        mailboxes: [],
        directoryAdminEmail: "admin@claritylabs.inc",
      }),
      { deadlineMs: 5 },
    );

    expect(result).toMatchObject({
      status: "failed",
      completeness: "partial",
      checkedMailboxCount: 0,
      totalMailboxCount: null,
      error: "Google Workspace verification reached its time limit.",
      directory: {
        status: "partial",
        discoveredMailboxCount: 1,
        totalMailboxCount: null,
        hasMore: true,
        error: "Google Workspace verification reached its time limit.",
      },
      mailboxes: [],
    });
    expect(listDirectoryUsers).toHaveBeenCalledTimes(2);
    expect(listDirectoryUsers.mock.calls[1][0].signal).toBeInstanceOf(
      AbortSignal,
    );
  });
});
