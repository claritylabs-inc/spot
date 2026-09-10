"use node";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { convert } from "html-to-text";
import { simpleParser } from "mailparser";
import dayjs from "dayjs";
import {
  normalizeAgentAttachmentFilename,
  normalizeAgentAttachmentContentType,
} from "./agentAttachmentLimits";
import type { Id } from "../_generated/dataModel";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceAttachmentSource,
  type OperatorGoogleWorkspaceConfig,
  type OperatorGoogleWorkspaceGetAttachmentInput,
  type OperatorGoogleWorkspaceGetAttachmentResult,
  type OperatorGoogleWorkspaceListMailboxesInput,
  type OperatorGoogleWorkspaceListMailboxesResult,
  type OperatorGoogleWorkspaceMailbox,
  type OperatorGoogleWorkspaceReadThreadInput,
  type OperatorGoogleWorkspaceReadThreadResult,
  type OperatorGoogleWorkspaceSearchEmailInput,
  type OperatorGoogleWorkspaceSearchEmailResult,
  type OperatorGoogleWorkspaceSearchMessage,
  type OperatorGoogleWorkspaceThreadAttachment,
  type OperatorGoogleWorkspaceThreadMessage,
  type OperatorGoogleWorkspaceToolName,
} from "./googleWorkspace";
import {
  isEligibleDirectoryMailbox,
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceDirectoryUser,
  type GoogleWorkspaceMessage,
  type GoogleWorkspaceMessagePart,
  type GoogleWorkspaceProvider,
} from "./googleWorkspaceProvider";

const MAX_DIRECTORY_PAGES_PER_CALL = 3;
const DIRECTORY_PAGE_SIZE = 20;
const TOOL_WORK_BUDGET_MS = 60_000;
const MAX_SEARCH_MAILBOXES_PER_CALL = 10;
const MAX_THREAD_BODY_CHARS_PER_PAGE = 80_000;
const MAX_EXTERNAL_BODY_PART_BYTES = 2 * 1024 * 1024;

type StoredAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

type AttachmentStorage = {
  store(blob: Blob): Promise<Id<"_storage">>;
  delete(fileId: Id<"_storage">): Promise<void>;
  read(file: StoredAttachment): Promise<unknown>;
};

export type GoogleWorkspaceToolDependencies = {
  config: OperatorGoogleWorkspaceConfig;
  provider: GoogleWorkspaceProvider;
  cursorSecret: string;
  attachmentStorage: AttachmentStorage;
};

function inputRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Google Workspace tool input is invalid.");
  }
  return value as Record<string, unknown>;
}

function optionalCursor(value: unknown) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
  return value;
}

function optionalLimit(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number")
    throw new Error("Google Workspace page size is invalid.");
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  return value;
}

export function parseGoogleWorkspaceToolInput(
  toolName: OperatorGoogleWorkspaceToolName,
  value: unknown,
) {
  const input = inputRecord(value);
  if (toolName === "list_company_mailboxes") {
    return {
      toolName: "list_company_mailboxes" as const,
      input: {
        cursor: optionalCursor(input.cursor),
        limit: optionalLimit(input.limit),
      },
    };
  }
  if (toolName === "search_company_email") {
    let mailboxes: string[] | undefined;
    if (input.mailboxes !== undefined) {
      if (
        !Array.isArray(input.mailboxes) ||
        input.mailboxes.some((item) => typeof item !== "string")
      ) {
        throw new Error("Google Workspace mailboxes are invalid.");
      }
      mailboxes = input.mailboxes.map((mailbox) =>
        requiredString(mailbox, "Company mailbox"),
      );
    }
    return {
      toolName: "search_company_email" as const,
      input: {
        query: requiredString(input.query, "Gmail search query"),
        mailboxes,
        cursor: optionalCursor(input.cursor),
        limit: optionalLimit(input.limit),
      },
    };
  }
  if (toolName === "read_company_email_thread") {
    return {
      toolName: "read_company_email_thread" as const,
      input: {
        mailbox: requiredString(input.mailbox, "Company mailbox"),
        threadId: requiredString(input.threadId, "Gmail thread ID"),
        cursor: optionalCursor(input.cursor),
        limit: optionalLimit(input.limit),
      },
    };
  }
  if (toolName === "get_company_email_attachment") {
    return {
      toolName: "get_company_email_attachment" as const,
      input: {
        mailbox: requiredString(input.mailbox, "Company mailbox"),
        messageId: requiredString(input.messageId, "Gmail message ID"),
        attachmentId: requiredString(input.attachmentId, "Gmail attachment ID"),
      },
    };
  }
  throw new Error(`Unsupported Google Workspace tool: ${String(toolName)}`);
}

type ListCursorState = { offset?: number; pageToken?: string };
type SearchCursorState = {
  mailboxes: string[];
  mailboxIndex: number;
  gmailPageToken?: string;
  directoryPageToken?: string;
  directoryDone: boolean;
  hadErrors: boolean;
  encounteredErrorCount: number;
};
type ThreadCursorState = {
  hadUnavailableBody: boolean;
  messageIndex: number;
  bodyOffset: number;
  threadFingerprint: string;
};

type CursorEnvelope = {
  version: 1;
  tool: OperatorGoogleWorkspaceToolName;
  configUpdatedAt: number;
  requestFingerprint: string;
  state: unknown;
};

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

function encodeCursor(
  secret: string,
  tool: OperatorGoogleWorkspaceToolName,
  configUpdatedAt: number,
  requestFingerprint: string,
  state: unknown,
) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      tool,
      configUpdatedAt,
      requestFingerprint,
      state,
    } satisfies CursorEnvelope),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const cursor = `${payload}.${signature}`;
  if (cursor.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars) {
    throw new Error("Google Workspace continuation state is too large.");
  }
  return cursor;
}

function decodeCursor<T>(
  secret: string,
  cursor: string | undefined,
  expected: {
    tool: OperatorGoogleWorkspaceToolName;
    configUpdatedAt: number;
    requestFingerprint: string;
  },
  initial: T,
): T {
  if (!cursor) return initial;
  if (cursor.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars) {
    throw new Error("Google Workspace cursor is invalid.");
  }
  let envelope: CursorEnvelope;
  try {
    const pieces = cursor.split(".");
    if (pieces.length !== 2) throw new Error("invalid cursor");
    const expectedSignature = createHmac("sha256", secret)
      .update(pieces[0])
      .digest();
    const suppliedSignature = Buffer.from(pieces[1], "base64url");
    if (
      expectedSignature.byteLength !== suppliedSignature.byteLength ||
      !timingSafeEqual(expectedSignature, suppliedSignature)
    ) {
      throw new Error("invalid cursor signature");
    }
    const value = JSON.parse(
      Buffer.from(pieces[0], "base64url").toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid cursor envelope");
    }
    envelope = value as CursorEnvelope;
  } catch {
    throw new Error("Google Workspace cursor is invalid.");
  }
  if (
    envelope.version !== 1 ||
    envelope.tool !== expected.tool ||
    envelope.configUpdatedAt !== expected.configUpdatedAt ||
    envelope.requestFingerprint !== expected.requestFingerprint ||
    !envelope.state ||
    typeof envelope.state !== "object" ||
    Array.isArray(envelope.state)
  ) {
    throw new Error(
      "Google Workspace cursor does not match this request or current settings.",
    );
  }
  return envelope.state as T;
}

function validOptionalToken(value: unknown) {
  return (
    value === undefined || (typeof value === "string" && value.length <= 8_000)
  );
}

function assertListCursorState(state: ListCursorState) {
  if (
    (state.offset !== undefined &&
      (!Number.isInteger(state.offset) || state.offset < 0)) ||
    !validOptionalToken(state.pageToken)
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

function assertSearchCursorState(state: SearchCursorState) {
  if (
    !Array.isArray(state.mailboxes) ||
    state.mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes ||
    state.mailboxes.some(
      (mailbox) =>
        typeof mailbox !== "string" ||
        !mailbox ||
        mailbox.length > GOOGLE_WORKSPACE_LIMITS.maxMailboxChars,
    ) ||
    !Number.isInteger(state.mailboxIndex) ||
    state.mailboxIndex < 0 ||
    state.mailboxIndex > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes ||
    !validOptionalToken(state.gmailPageToken) ||
    !validOptionalToken(state.directoryPageToken) ||
    typeof state.directoryDone !== "boolean" ||
    typeof state.hadErrors !== "boolean" ||
    !Number.isInteger(state.encounteredErrorCount) ||
    state.encounteredErrorCount < 0
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

function assertThreadCursorState(state: ThreadCursorState) {
  if (
    typeof state.hadUnavailableBody !== "boolean" ||
    !Number.isInteger(state.messageIndex) ||
    state.messageIndex < 0 ||
    !Number.isInteger(state.bodyOffset) ||
    state.bodyOffset < 0 ||
    typeof state.threadFingerprint !== "string" ||
    state.threadFingerprint.length > 100
  ) {
    throw new Error("Google Workspace cursor is invalid.");
  }
}

function pageSize(limit: number | undefined) {
  const value = limit ?? GOOGLE_WORKSPACE_LIMITS.defaultPageSize;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > GOOGLE_WORKSPACE_LIMITS.maxPageSize
  ) {
    throw new Error(
      `Google Workspace page size must be between 1 and ${GOOGLE_WORKSPACE_LIMITS.maxPageSize}.`,
    );
  }
  return value;
}

function normalizedRequestedMailboxes(mailboxes: string[] | undefined) {
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

async function resolveMailbox(
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

async function listDirectoryPage(
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

async function messageHeaders(message: GoogleWorkspaceMessage) {
  const headers = message.payload?.headers ?? [];
  const value = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null;
  const parsed = await simpleParser(
    ["To", "Cc", "Bcc"]
      .flatMap((name) => (value(name) ? [`${name}: ${value(name)}`] : []))
      .join("\r\n") + "\r\n\r\n",
  );
  const addresses = (name: "To" | "Cc" | "Bcc") => {
    const field =
      name === "To" ? parsed.to : name === "Cc" ? parsed.cc : parsed.bcc;
    return (Array.isArray(field) ? field : field ? [field] : []).flatMap(
      (group) =>
        group.value.flatMap((address) =>
          address.address
            ? [
                address.name
                  ? `${address.name} <${address.address}>`
                  : address.address,
              ]
            : [],
        ),
    );
  };
  return { value, addresses };
}

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

export async function searchCompanyEmail(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceSearchEmailInput,
): Promise<OperatorGoogleWorkspaceSearchEmailResult> {
  const { config, provider, cursorSecret } = dependencies;
  const query = input.query.trim();
  if (!query || query.length > GOOGLE_WORKSPACE_LIMITS.maxQueryChars) {
    throw new Error(
      `Google Workspace search query must be 1 to ${GOOGLE_WORKSPACE_LIMITS.maxQueryChars.toLocaleString()} characters.`,
    );
  }
  const limit = pageSize(input.limit);
  const requested = normalizedRequestedMailboxes(input.mailboxes);
  const requestFingerprint = hashJson({ query, requested, limit });
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
        query,
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
    query,
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
    completeness: !nextCursor && !state.hadErrors ? "complete" : "partial",
    ordering: "mailbox_then_gmail",
    querySemantics: "gmail_api_no_alias_expansion",
  };
}

function decodePartData(data: string) {
  return Buffer.from(data, "base64url");
}

function disposition(part: GoogleWorkspaceMessagePart) {
  return (
    part.headers
      .find((header) => header.name.toLowerCase() === "content-disposition")
      ?.value.toLowerCase() ?? ""
  );
}

function htmlFallback(html: string) {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

export function messageBody(message: GoogleWorkspaceMessage) {
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GoogleWorkspaceMessagePart) => {
    const isAttachment =
      Boolean(part.filename) || disposition(part).includes("attachment");
    if (isAttachment) return;
    if (part.body.data) {
      if (part.mimeType.toLowerCase() === "text/plain") {
        plain.push(decodePartData(part.body.data).toString("utf8"));
      } else if (part.mimeType.toLowerCase() === "text/html") {
        html.push(decodePartData(part.body.data).toString("utf8"));
      }
    }
    part.parts.forEach(visit);
  };
  if (message.payload) visit(message.payload);
  const plainText = plain
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
  if (plainText) return { body: plainText, format: "plain" as const };
  const converted = html.map(htmlFallback).filter(Boolean).join("\n\n");
  return converted
    ? { body: converted, format: "html_fallback" as const }
    : { body: "", format: "unavailable" as const };
}

type LocatedPart = { part: GoogleWorkspaceMessagePart; stablePartId: string };

function allParts(message: GoogleWorkspaceMessage) {
  const values: LocatedPart[] = [];
  const visit = (part: GoogleWorkspaceMessagePart, path: number[]) => {
    const stablePartId = part.partId || path.join(".") || "0";
    values.push({ part, stablePartId });
    part.parts.forEach((child, index) => visit(child, [...path, index]));
  };
  if (message.payload) visit(message.payload, []);
  return values;
}

function isAttachmentPart(part: GoogleWorkspaceMessagePart) {
  const value = disposition(part);
  return Boolean(
    part.filename ||
    part.body.attachmentId ||
    value.includes("attachment") ||
    value.includes("inline"),
  );
}

function contentId(part: GoogleWorkspaceMessagePart) {
  return (
    part.headers.find((header) => header.name.toLowerCase() === "content-id")
      ?.value ?? null
  );
}

function attachmentMetadata(
  located: LocatedPart,
): OperatorGoogleWorkspaceThreadAttachment {
  const { part, stablePartId } = located;
  return {
    attachmentId: part.body.attachmentId ?? `part:${stablePartId}`,
    partId: stablePartId,
    filename: part.filename || `attachment-${stablePartId}`,
    contentType: part.mimeType || "application/octet-stream",
    size: part.body.size,
    inline: disposition(part).includes("inline"),
    contentId: contentId(part),
  };
}

async function loadExternalBodyParts(
  provider: GoogleWorkspaceProvider,
  mailbox: string,
  message: GoogleWorkspaceMessage,
  budget: { bytes: number; requests: number; deadline: number },
) {
  const unavailable: OperatorGoogleWorkspaceThreadMessage["bodyUnavailableParts"] =
    [];
  const visit = async (part: GoogleWorkspaceMessagePart) => {
    if (part.filename || disposition(part).includes("attachment")) return;
    if (
      /^text\/(plain|html)$/i.test(part.mimeType) &&
      part.body.data === null &&
      part.body.attachmentId
    ) {
      let reason: string | null = null;
      if (
        part.body.size > budget.bytes ||
        budget.requests <= 0 ||
        dayjs().valueOf() >= budget.deadline
      ) {
        reason =
          "Body retrieval budget reached. Retrieve this part using get_company_email_attachment.";
      } else {
        budget.requests -= 1;
        try {
          const content = await provider.getAttachment({
            mailbox,
            messageId: message.id,
            attachmentId: part.body.attachmentId,
          });
          if (
            content.data.length > Math.ceil(budget.bytes / 3) * 4 + 4 ||
            content.size > budget.bytes
          ) {
            reason =
              "Body part exceeds the text retrieval limit. Retrieve it using get_company_email_attachment.";
          } else {
            const bytes = decodePartData(content.data);
            if (bytes.byteLength > budget.bytes) {
              reason =
                "Body part exceeds the text retrieval limit. Retrieve it using get_company_email_attachment.";
            } else {
              budget.bytes -= bytes.byteLength;
              part.body.data = content.data;
            }
          }
        } catch (error) {
          reason = sanitizeGoogleWorkspaceError(error);
        }
      }
      if (reason)
        unavailable.push({
          partId: part.partId,
          attachmentId: part.body.attachmentId,
          reason,
        });
    }
    for (const child of part.parts) await visit(child);
  };
  if (message.payload) await visit(message.payload);
  return unavailable;
}

async function threadMessage(
  mailbox: string,
  message: GoogleWorkspaceMessage,
  bodyOffset: number,
  remainingChars: number,
  unavailable: OperatorGoogleWorkspaceThreadMessage["bodyUnavailableParts"],
) {
  const headers = await messageHeaders(message);
  const content = messageBody(message);
  if (bodyOffset > content.body.length)
    throw new Error("The Gmail body changed; restart the thread read.");
  const body = content.body.slice(bodyOffset, bodyOffset + remainingChars);
  const nextOffset = bodyOffset + body.length;
  const sliceComplete = nextOffset >= content.body.length;
  const value: OperatorGoogleWorkspaceThreadMessage = {
    mailbox,
    messageId: message.id,
    threadId: message.threadId,
    from: headers.value("From"),
    to: headers.addresses("To"),
    cc: headers.addresses("Cc"),
    bcc: headers.addresses("Bcc"),
    replyTo: headers.value("Reply-To"),
    subject: headers.value("Subject"),
    date: headers.value("Date") ?? message.internalDate,
    internetMessageId: headers.value("Message-ID"),
    inReplyTo: headers.value("In-Reply-To"),
    references: headers.value("References"),
    body,
    bodyFormat: content.format,
    bodyOffset,
    bodyComplete: sliceComplete && unavailable.length === 0,
    bodySourceComplete: unavailable.length === 0,
    bodyUnavailableParts: unavailable,
    attachments: allParts(message)
      .filter(({ part }) => isAttachmentPart(part))
      .map(attachmentMetadata),
  };
  return { value, nextOffset, sliceComplete };
}

export async function readCompanyEmailThread(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceReadThreadInput,
): Promise<OperatorGoogleWorkspaceReadThreadResult> {
  const { config, provider, cursorSecret } = dependencies;
  const requestedMailbox = input.mailbox.trim().toLowerCase();
  const threadId = input.threadId.trim();
  if (!threadId || threadId.length > GOOGLE_WORKSPACE_LIMITS.maxThreadIdChars)
    throw new Error("Gmail thread ID is invalid.");
  const limit = pageSize(input.limit);
  const requestFingerprint = hashJson({
    mailbox: requestedMailbox,
    threadId,
    limit,
  });
  const state = decodeCursor<ThreadCursorState>(
    cursorSecret,
    input.cursor,
    {
      tool: "read_company_email_thread",
      configUpdatedAt: config.updatedAt,
      requestFingerprint,
    },
    {
      messageIndex: 0,
      bodyOffset: 0,
      threadFingerprint: "",
      hadUnavailableBody: false,
    },
  );
  assertThreadCursorState(state);
  const bodyBudget = {
    bytes: MAX_EXTERNAL_BODY_PART_BYTES,
    requests: 10,
    deadline: dayjs().valueOf() + TOOL_WORK_BUDGET_MS,
  };
  const mailbox = await resolveMailbox(provider, config, requestedMailbox);
  const messageIds = await provider.getThreadMessageIds({ mailbox, threadId });
  const threadFingerprint = hashJson(messageIds);
  if (
    (input.cursor && state.threadFingerprint !== threadFingerprint) ||
    state.messageIndex > messageIds.length
  ) {
    throw new Error("The Gmail thread changed; restart the thread read.");
  }
  state.threadFingerprint = threadFingerprint;
  const messages: OperatorGoogleWorkspaceThreadMessage[] = [];
  let remainingChars = MAX_THREAD_BODY_CHARS_PER_PAGE;
  while (
    state.messageIndex < messageIds.length &&
    messages.length < limit &&
    remainingChars > 0 &&
    dayjs().valueOf() < bodyBudget.deadline
  ) {
    const message = await provider.getMessageFull({
      mailbox,
      messageId: messageIds[state.messageIndex],
    });
    if (
      message.threadId !== threadId ||
      message.id !== messageIds[state.messageIndex]
    ) {
      throw new Error("Gmail returned a message outside the requested thread.");
    }
    const unavailable = await loadExternalBodyParts(
      provider,
      mailbox,
      message,
      bodyBudget,
    );
    const rendered = await threadMessage(
      mailbox,
      message,
      state.bodyOffset,
      remainingChars,
      unavailable,
    );
    state.hadUnavailableBody ||= unavailable.length > 0;
    messages.push(rendered.value);
    remainingChars -= rendered.value.body.length;
    if (!rendered.sliceComplete) {
      state.bodyOffset = rendered.nextOffset;
      break;
    }
    state.messageIndex += 1;
    state.bodyOffset = 0;
  }
  const nextCursor =
    state.messageIndex < messageIds.length
      ? encodeCursor(
          cursorSecret,
          "read_company_email_thread",
          config.updatedAt,
          requestFingerprint,
          state,
        )
      : null;
  return {
    mailbox,
    threadId,
    messages,
    nextCursor,
    completeness:
      nextCursor || state.hadUnavailableBody ? "partial" : "complete",
    maxBodyCharsPerPage: MAX_THREAD_BODY_CHARS_PER_PAGE,
  };
}

function locatedAttachment(
  message: GoogleWorkspaceMessage,
  attachmentId: string,
) {
  const parts = allParts(message).filter(({ part }) => isAttachmentPart(part));
  if (attachmentId.startsWith("part:")) {
    const stablePartId = attachmentId.slice("part:".length);
    return parts.find(
      (located) =>
        located.stablePartId === stablePartId &&
        !located.part.body.attachmentId &&
        located.part.body.data !== null,
    );
  }
  return parts.find(
    (located) => located.part.body.attachmentId === attachmentId,
  );
}

export async function getCompanyEmailAttachment(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceGetAttachmentInput,
): Promise<{
  result: OperatorGoogleWorkspaceGetAttachmentResult;
  attachment: StoredAttachment;
}> {
  const { config, provider, attachmentStorage } = dependencies;
  const mailbox = await resolveMailbox(provider, config, input.mailbox);
  const messageId = input.messageId.trim();
  const attachmentId = input.attachmentId.trim();
  if (
    !messageId ||
    messageId.length > GOOGLE_WORKSPACE_LIMITS.maxMessageIdChars ||
    !attachmentId ||
    attachmentId.length > GOOGLE_WORKSPACE_LIMITS.maxAttachmentIdChars
  )
    throw new Error("Gmail attachment identity is invalid.");
  const message = await provider.getMessageFull({ mailbox, messageId });
  if (message.id !== messageId)
    throw new Error("Gmail message identity changed.");
  const located = locatedAttachment(message, attachmentId);
  if (!located)
    throw new Error("Attachment is not part of the requested Gmail message.");
  const metadata = attachmentMetadata(located);
  if (metadata.size > GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes) {
    throw new Error("Gmail attachment exceeds the 15 MiB retrieval limit.");
  }
  const encoded = located.part.body.attachmentId
    ? (
        await provider.getAttachment({
          mailbox,
          messageId,
          attachmentId: located.part.body.attachmentId,
        })
      ).data
    : located.part.body.data;
  if (encoded == null)
    throw new Error("Gmail attachment content is unavailable.");
  if (
    encoded.length >
    Math.ceil(GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes / 3) * 4 + 4
  ) {
    throw new Error("Gmail attachment exceeds the 15 MiB retrieval limit.");
  }
  const bytes = decodePartData(encoded);
  if (bytes.byteLength > GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes) {
    throw new Error("Gmail attachment exceeds the 15 MiB retrieval limit.");
  }
  const source: OperatorGoogleWorkspaceAttachmentSource = {
    mailbox,
    messageId,
    threadId: message.threadId,
    attachmentId: metadata.attachmentId,
    partId: metadata.partId,
    filename: normalizeAgentAttachmentFilename(metadata.filename),
    contentType: normalizeAgentAttachmentContentType(metadata.contentType),
    size: bytes.byteLength,
    inline: metadata.inline,
    contentId: metadata.contentId,
  };
  let fileId: Id<"_storage"> | null = null;
  try {
    fileId = await attachmentStorage.store(
      new Blob([new Uint8Array(bytes)], { type: metadata.contentType }),
    );
    const attachment = {
      fileId,
      filename: source.filename,
      contentType: source.contentType,
      size: bytes.byteLength,
    };
    const extracted = await attachmentStorage.read(attachment);
    return {
      result: { status: "attached", source, extracted },
      attachment,
    };
  } catch (error) {
    if (fileId) await attachmentStorage.delete(fileId).catch(() => undefined);
    throw error;
  }
}

async function executeGoogleWorkspaceTool(
  dependencies: GoogleWorkspaceToolDependencies,
  toolName: OperatorGoogleWorkspaceToolName,
  input: unknown,
) {
  const parsed = parseGoogleWorkspaceToolInput(toolName, input);
  switch (parsed.toolName) {
    case "list_company_mailboxes":
      return { result: await listCompanyMailboxes(dependencies, parsed.input) };
    case "search_company_email":
      return { result: await searchCompanyEmail(dependencies, parsed.input) };
    case "read_company_email_thread":
      return {
        result: await readCompanyEmailThread(dependencies, parsed.input),
      };
    case "get_company_email_attachment": {
      const output = await getCompanyEmailAttachment(
        dependencies,
        parsed.input,
      );
      return { result: output.result, attachments: [output.attachment] };
    }
  }
}

export async function runGoogleWorkspaceTool(
  dependencies: GoogleWorkspaceToolDependencies,
  toolName: OperatorGoogleWorkspaceToolName,
  input: unknown,
) {
  const output = await executeGoogleWorkspaceTool(
    dependencies,
    toolName,
    input,
  );
  // Leave room for the audit envelope and preserve lossless idempotent replay.
  if (Buffer.byteLength(JSON.stringify(output.result), "utf8") > 512 * 1024) {
    if (output.attachments) {
      await Promise.all(
        output.attachments.map((file) =>
          dependencies.attachmentStorage.delete(file.fileId),
        ),
      );
    }
    throw new Error(
      "Company email result is too large. Use a smaller page size or a narrower search.",
    );
  }
  return output;
}
