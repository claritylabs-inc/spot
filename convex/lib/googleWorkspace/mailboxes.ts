"use node";

import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceConfig,
  type OperatorGoogleWorkspaceListMailboxesInput,
  type OperatorGoogleWorkspaceListMailboxesResult,
  type OperatorGoogleWorkspaceMailbox,
} from "../googleWorkspace";
import {
  isEligibleDirectoryMailbox,
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceDirectoryUser,
  type GoogleWorkspaceProvider,
} from "../googleWorkspaceProvider";
import {
  assertListCursorState,
  decodeCursor,
  encodeCursor,
  hashJson,
  pageSize,
  type ListCursorState,
} from "./cursors";
import type { GoogleWorkspaceToolDependencies } from "./shared";

export const MAX_DIRECTORY_PAGES_PER_CALL = 3;
export const DIRECTORY_PAGE_SIZE = 20;

export function normalizedRequestedMailboxes(mailboxes: string[] | undefined) {
  if (!mailboxes) return null;
  if (mailboxes.length === 0) {
    throw new Error(
      "Omit mailboxes to search all configured company mailboxes.",
    );
  }
  if (mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes) {
    throw new Error(
      `Request at most ${GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes} company mailboxes.`,
    );
  }
  const values = mailboxes.map((mailbox) => mailbox.trim().toLowerCase());
  if (
    values.some(
      (mailbox) =>
        !mailbox ||
        !mailbox.includes("@") ||
        mailbox.length > GOOGLE_WORKSPACE_LIMITS.maxMailboxChars,
    )
  ) {
    throw new Error("A requested company mailbox is invalid.");
  }
  return values.filter((mailbox, index) => values.indexOf(mailbox) === index);
}

function requireDirectoryAdmin(config: OperatorGoogleWorkspaceConfig) {
  if (!config.directoryAdminEmail) {
    throw new Error("Google Workspace directory mode is not configured.");
  }
  return config.directoryAdminEmail;
}

function manualMailbox(
  config: OperatorGoogleWorkspaceConfig,
  requested: string,
) {
  const mailbox = config.mailboxes.find((value) => value === requested);
  if (!mailbox)
    throw new Error("Requested mailbox is not configured for the company.");
  return mailbox;
}

async function directoryMailbox(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  requested: string,
) {
  const user = await provider.getDirectoryUser({
    subject: requireDirectoryAdmin(config),
    userKey: requested,
  });
  if (
    !isEligibleDirectoryMailbox(user) ||
    (user.primaryEmail !== requested && !user.aliases.includes(requested))
  ) {
    throw new Error("Requested mailbox is not an active company mailbox.");
  }
  return user.primaryEmail;
}

export async function resolveMailbox(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  requested: string,
) {
  const normalized = requested.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > GOOGLE_WORKSPACE_LIMITS.maxMailboxChars ||
    !normalized.includes("@")
  ) {
    throw new Error("Company mailbox is invalid.");
  }
  return config.mailboxMode === "manual"
    ? manualMailbox(config, normalized)
    : await directoryMailbox(provider, config, normalized);
}

function directoryMailboxValue(user: GoogleWorkspaceDirectoryUser) {
  return {
    mailbox: user.primaryEmail,
    displayName: user.displayName,
    aliases: user.aliases,
    source: "directory" as const,
  };
}

export async function listDirectoryPage(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  pageToken: string | undefined,
  desired: number,
  maxPages = MAX_DIRECTORY_PAGES_PER_CALL,
) {
  let token = pageToken;
  let pages = 0;
  const mailboxes: OperatorGoogleWorkspaceMailbox[] = [];
  while (pages < maxPages && mailboxes.length < desired) {
    const remaining = desired - mailboxes.length;
    const page = await provider.listDirectoryUsers({
      subject: requireDirectoryAdmin(config),
      pageToken: token,
      maxResults: Math.min(DIRECTORY_PAGE_SIZE, remaining),
    });
    pages += 1;
    mailboxes.push(
      ...page.users
        .filter(isEligibleDirectoryMailbox)
        .map(directoryMailboxValue),
    );
    token = page.nextPageToken ?? undefined;
    if (!token) break;
  }
  return { mailboxes, nextPageToken: token, pagesFetched: pages };
}

export async function listCompanyMailboxes(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceListMailboxesInput,
): Promise<OperatorGoogleWorkspaceListMailboxesResult> {
  const { config, provider, cursorSecret } = dependencies;
  const limit = pageSize(input.limit);
  const requestFingerprint = hashJson({ limit });
  const state = decodeCursor<ListCursorState>(
    cursorSecret,
    input.cursor,
    {
      tool: "list_company_mailboxes",
      configUpdatedAt: config.updatedAt,
      requestFingerprint,
    },
    {},
  );
  assertListCursorState(state);

  if (config.mailboxMode === "manual") {
    const offset = state.offset ?? 0;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > config.mailboxes.length
    ) {
      throw new Error("Google Workspace cursor is invalid.");
    }
    const mailboxes = config.mailboxes
      .slice(offset, offset + limit)
      .map((mailbox) => ({
        mailbox,
        displayName: null,
        aliases: [],
        source: "manual" as const,
      }));
    const nextOffset = offset + mailboxes.length;
    const nextCursor =
      nextOffset < config.mailboxes.length
        ? encodeCursor(
            cursorSecret,
            "list_company_mailboxes",
            config.updatedAt,
            requestFingerprint,
            { offset: nextOffset } satisfies ListCursorState,
          )
        : null;
    return {
      mailboxMode: "manual",
      mailboxes,
      nextCursor,
      completeness: nextCursor ? "partial" : "complete",
      error: null,
    };
  }

  try {
    const page = await listDirectoryPage(
      provider,
      config,
      state.pageToken,
      limit,
    );
    const nextCursor = page.nextPageToken
      ? encodeCursor(
          cursorSecret,
          "list_company_mailboxes",
          config.updatedAt,
          requestFingerprint,
          { pageToken: page.nextPageToken } satisfies ListCursorState,
        )
      : null;
    return {
      mailboxMode: "directory",
      mailboxes: page.mailboxes,
      nextCursor,
      completeness: nextCursor ? "partial" : "complete",
      error: null,
    };
  } catch (error) {
    return {
      mailboxMode: "directory",
      mailboxes: [],
      nextCursor: null,
      completeness: "partial",
      error: sanitizeGoogleWorkspaceError(error),
    };
  }
}
