"use node";

import dayjs from "dayjs";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceConfig,
  type OperatorGoogleWorkspaceSearchEmailInput,
  type OperatorGoogleWorkspaceSearchEmailResult,
  type OperatorGoogleWorkspaceSearchMessage,
} from "../googleWorkspace";
import { NoWriteInputError } from "../noWriteInputError";
import {
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceMessage,
  type GoogleWorkspaceProvider,
} from "../googleWorkspaceProvider";
import {
  assertSearchCursorState,
  decodeCursor,
  encodeCursor,
  hashJson,
  pageSize,
  type SearchCursorState,
} from "./cursors";
import { messageHeaders } from "./messages";
import {
  DIRECTORY_PAGE_SIZE,
  listDirectoryPage,
  MAX_DIRECTORY_PAGES_PER_CALL,
  normalizedRequestedMailboxes,
  resolveMailbox,
} from "./mailboxes";
import {
  DAY_MS,
  TOOL_WORK_BUDGET_MS,
  type GoogleWorkspaceToolDependencies,
} from "./shared";

const MAX_SEARCH_MAILBOXES_PER_CALL = 10;
const MAX_SEARCH_PARTICIPANTS = 20;
const PARTICIPANT_PATTERN = /^(?:[^\s@(){}":]+@)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

async function searchMessage(
  mailbox: string,
  reference: { id: string; threadId: string },
  metadata: GoogleWorkspaceMessage | null,
): Promise<OperatorGoogleWorkspaceSearchMessage> {
  if (!metadata) {
    return {
      mailbox,
      messageId: reference.id,
      threadId: reference.threadId,
      subject: null,
      from: null,
      to: [],
      cc: [],
      date: null,
      snippet: null,
      metadataComplete: false,
    };
  }
  const headers = await messageHeaders(metadata);
  return {
    mailbox,
    messageId: reference.id,
    threadId: reference.threadId,
    subject: headers.value("Subject"),
    from: headers.value("From"),
    to: headers.addresses("To"),
    cc: headers.addresses("Cc"),
    date: headers.value("Date") ?? metadata.internalDate,
    snippet: metadata.snippet,
    metadataComplete: true,
  };
}

async function loadDirectorySearchMailboxes(
  provider: GoogleWorkspaceProvider,
  config: OperatorGoogleWorkspaceConfig,
  state: SearchCursorState,
  maxPages: number,
) {
  const page = await listDirectoryPage(
    provider,
    config,
    state.directoryPageToken,
    DIRECTORY_PAGE_SIZE,
    maxPages,
  );
  state.mailboxes = page.mailboxes.map((mailbox) => mailbox.mailbox);
  state.mailboxIndex = 0;
  state.gmailPageToken = undefined;
  state.directoryPageToken = page.nextPageToken;
  state.directoryDone = !page.nextPageToken;
  return page.pagesFetched;
}

/** Folds participants and a UTC date window into one Gmail query. */
function composedSearchQuery(
  query: string,
  input: OperatorGoogleWorkspaceSearchEmailInput,
) {
  const participants = [
    ...new Set(
      (input.participants ?? []).map((value) =>
        value.trim().toLowerCase().replace(/^@/, ""),
      ),
    ),
  ];
  if (
    participants.length > MAX_SEARCH_PARTICIPANTS ||
    participants.some((value) => !PARTICIPANT_PATTERN.test(value))
  ) {
    throw new NoWriteInputError(
      "invalid_input",
      `Participants must be at most ${MAX_SEARCH_PARTICIPANTS} email addresses or bare domains such as acme.com.`,
    );
  }
  const clauses = query ? [query] : [];
  if (participants.length) {
    clauses.push(
      `(${participants
        .flatMap((value) => [`from:${value}`, `to:${value}`, `cc:${value}`])
        .join(" OR ")})`,
    );
  }
  if (input.since) {
    clauses.push(`after:${searchDay(input.since, "Search start date") / 1000}`);
  }
  if (input.until) {
    clauses.push(
      `before:${(searchDay(input.until, "Search end date") + DAY_MS) / 1000}`,
    );
  }
  return clauses.join(" ");
}

function searchDay(value: string, label: string) {
  const parsed = dayjs(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !parsed.isValid()) {
    throw new NoWriteInputError(
      "invalid_input",
      `${label} must be a YYYY-MM-DD date.`,
    );
  }
  return parsed.valueOf();
}

export async function searchCompanyEmail(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceSearchEmailInput,
): Promise<OperatorGoogleWorkspaceSearchEmailResult> {
  const { config, provider, cursorSecret } = dependencies;
  const query = input.query.trim();
  const scoped = Boolean(input.participants?.length || input.since || input.until);
  if (
    (!query && !scoped) ||
    query.length > GOOGLE_WORKSPACE_LIMITS.maxQueryChars
  ) {
    throw new Error(
      `Google Workspace search query must be 1 to ${GOOGLE_WORKSPACE_LIMITS.maxQueryChars.toLocaleString()} characters.`,
    );
  }
  const limit = pageSize(input.limit);
  const requested = normalizedRequestedMailboxes(input.mailboxes);
  const gmailQuery = composedSearchQuery(query, input);
  const requestFingerprint = hashJson({
    query: gmailQuery,
    requested,
    limit,
  });
  const state = decodeCursor<SearchCursorState>(
    cursorSecret,
    input.cursor,
    {
      tool: "search_company_email",
      configUpdatedAt: config.updatedAt,
      requestFingerprint,
    },
    {
      mailboxes: [],
      mailboxIndex: 0,
      directoryDone: requested !== null || config.mailboxMode === "manual",
      hadErrors: false,
      encounteredErrorCount: 0,
    },
  );
  assertSearchCursorState(state);
  // Fixed rosters come from the bound request/config, keeping cursors small.
  if (requested || config.mailboxMode === "manual") {
    state.mailboxes = requested ?? [...config.mailboxes];
    if (state.mailboxIndex > state.mailboxes.length) {
      throw new Error("Google Workspace cursor is invalid.");
    }
  }
  const deadline = dayjs().valueOf() + TOOL_WORK_BUDGET_MS;
  if (state.mailboxIndex > state.mailboxes.length)
    throw new Error("Google Workspace cursor is invalid.");
  const messages: OperatorGoogleWorkspaceSearchMessage[] = [];
  const searchedMailboxes: string[] = [];
  const errors: Array<{ mailbox: string; error: string }> = [];
  let directoryError: string | null = null;
  let attempted = 0;
  let directoryPagesFetched = 0;

  while (
    messages.length < limit &&
    attempted < MAX_SEARCH_MAILBOXES_PER_CALL &&
    dayjs().valueOf() < deadline
  ) {
    if (state.mailboxIndex >= state.mailboxes.length) {
      if (state.directoryDone) break;
      if (directoryPagesFetched >= MAX_DIRECTORY_PAGES_PER_CALL) break;
      try {
        directoryPagesFetched += await loadDirectorySearchMailboxes(
          provider,
          config,
          state,
          MAX_DIRECTORY_PAGES_PER_CALL - directoryPagesFetched,
        );
      } catch (error) {
        directoryError = sanitizeGoogleWorkspaceError(error);
        state.hadErrors = true;
        state.encounteredErrorCount += 1;
        state.directoryDone = true;
        break;
      }
      if (!state.mailboxes.length && state.directoryDone) break;
      if (!state.mailboxes.length) continue;
    }

    let mailbox = state.mailboxes[state.mailboxIndex];
    attempted += 1;
    try {
      mailbox = await resolveMailbox(provider, config, mailbox);
      searchedMailboxes.push(mailbox);
      const page = await provider.listMessages({
        mailbox,
        query: gmailQuery,
        pageToken: state.gmailPageToken,
        maxResults: limit - messages.length,
      });
      const metadata: Array<GoogleWorkspaceMessage | null> = [];
      for (let offset = 0; offset < page.messages.length; offset += 5) {
        metadata.push(
          ...(await Promise.all(
            page.messages.slice(offset, offset + 5).map(async (reference) => {
              try {
                if (dayjs().valueOf() >= deadline) {
                  throw new Error("metadata budget exhausted");
                }
                return await provider.getMessageMetadata({
                  mailbox,
                  messageId: reference.id,
                });
              } catch (error) {
                errors.push({
                  mailbox,
                  error:
                    dayjs().valueOf() >= deadline
                      ? "Metadata time budget reached. Read the returned thread for full details."
                      : sanitizeGoogleWorkspaceError(error),
                });
                state.hadErrors = true;
                state.encounteredErrorCount += 1;
                return null;
              }
            }),
          )),
        );
      }
      messages.push(
        ...(await Promise.all(
          page.messages.map((reference, index) =>
            searchMessage(mailbox, reference, metadata[index]),
          ),
        )),
      );
      if (page.nextPageToken) {
        state.gmailPageToken = page.nextPageToken;
        break;
      }
      state.gmailPageToken = undefined;
      state.mailboxIndex += 1;
    } catch (error) {
      errors.push({ mailbox, error: sanitizeGoogleWorkspaceError(error) });
      state.hadErrors = true;
      state.encounteredErrorCount += 1;
      state.gmailPageToken = undefined;
      state.mailboxIndex += 1;
    }
  }

  const hasMore =
    Boolean(state.gmailPageToken) ||
    state.mailboxIndex < state.mailboxes.length ||
    !state.directoryDone;
  const nextCursor = hasMore
    ? encodeCursor(
        cursorSecret,
        "search_company_email",
        config.updatedAt,
        requestFingerprint,
        {
          ...state,
          mailboxes:
            requested || config.mailboxMode === "manual" ? [] : state.mailboxes,
        },
      )
    : null;
  return {
    query: gmailQuery,
    messages: messages.slice(0, limit),
    searchedMailboxes: [...new Set(searchedMailboxes)],
    errors: errors.filter(
      (error, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.mailbox === error.mailbox &&
            candidate.error === error.error,
        ) === index,
    ),
    directoryError,
    encounteredErrorCount: state.encounteredErrorCount,
    nextCursor,
    bounded: Boolean(nextCursor) || state.hadErrors,
    completeness: !nextCursor && !state.hadErrors ? "complete" : "partial",
    ordering: "mailbox_then_gmail",
    querySemantics: "gmail_api_no_alias_expansion",
  };
}
