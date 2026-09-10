"use node";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { convert } from "html-to-text";
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
const DIRECTORY_PAGE_SIZE = 50;
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
  if (typeof value !== "string" || value.length > GOOGLE_WORKSPACE_LIMITS.maxCursorChars) {
    throw new Error("Google Workspace cursor is invalid.");
  }
  return value;
}

function optionalLimit(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error("Google Workspace page size is invalid.");
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  return value;
}

export function parseGoogleWorkspaceToolInput(
  toolName: OperatorGoogleWorkspaceToolName,
  value: unknown,
):
  | OperatorGoogleWorkspaceListMailboxesInput
  | OperatorGoogleWorkspaceSearchEmailInput
  | OperatorGoogleWorkspaceReadThreadInput
  | OperatorGoogleWorkspaceGetAttachmentInput {
  const input = inputRecord(value);
  if (toolName === "list_company_mailboxes") {
    return {
      cursor: optionalCursor(input.cursor),
      limit: optionalLimit(input.limit),
    };
  }
  if (toolName === "search_company_email") {
    let mailboxes: string[] | undefined;
    if (input.mailboxes !== undefined) {
      if (!Array.isArray(input.mailboxes) || input.mailboxes.some((item) => typeof item !== "string")) {
        throw new Error("Google Workspace mailboxes are invalid.");
      }
      mailboxes = input.mailboxes as string[];
    }
    return {
      query: requiredString(input.query, "Gmail search query"),
      mailboxes,
      cursor: optionalCursor(input.cursor),
      limit: optionalLimit(input.limit),
    };
  }
  if (toolName === "read_company_email_thread") {
    return {
      mailbox: requiredString(input.mailbox, "Company mailbox"),
      threadId: requiredString(input.threadId, "Gmail thread ID"),
      cursor: optionalCursor(input.cursor),
      limit: optionalLimit(input.limit),
    };
  }
  if (toolName === "get_company_email_attachment") {
    return {
      mailbox: requiredString(input.mailbox, "Company mailbox"),
      messageId: requiredString(input.messageId, "Gmail message ID"),
      attachmentId: requiredString(input.attachmentId, "Gmail attachment ID"),
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
  mailbox: string;
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
    typeof envelope.state !== "object"
  ) {
    throw new Error(
      "Google Workspace cursor does not match this request or current settings.",
    );
  }
  return envelope.state as T;
}

function validOptionalToken(value: unknown) {
  return value === undefined || (typeof value === "string" && value.length <= 8_000);
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
    state.mailboxIndex > state.mailboxes.length ||
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
    typeof state.mailbox !== "string" ||
    !state.mailbox ||
    state.mailbox.length > GOOGLE_WORKSPACE_LIMITS.maxMailboxChars ||
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
  if (!Number.isInteger(value) || value < 1 || value > GOOGLE_WORKSPACE_LIMITS.maxPageSize) {
    throw new Error(
      `Google Workspace page size must be between 1 and ${GOOGLE_WORKSPACE_LIMITS.maxPageSize}.`,
    );
  }
  return value;
}

function normalizedRequestedMailboxes(mailboxes: string[] | undefined) {
  if (!mailboxes) return null;
  if (mailboxes.length === 0) {
    throw new Error("Omit mailboxes to search all configured company mailboxes.");
  }
  if (mailboxes.length > GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes) {
    throw new Error(
      `Request at most ${GOOGLE_WORKSPACE_LIMITS.maxRequestedMailboxes} company mailboxes.`,
    );
  }
  const values = mailboxes.map((mailbox) => mailbox.trim().toLowerCase());
  if (values.some((mailbox) => !mailbox || !mailbox.includes("@"))) {
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

function manualMailbox(config: OperatorGoogleWorkspaceConfig, requested: string) {
  const mailbox = config.mailboxes.find((value) => value === requested);
  if (!mailbox) throw new Error("Requested mailbox is not configured for the company.");
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
    if (!Number.isInteger(offset) || offset < 0 || offset > config.mailboxes.length) {
      throw new Error("Google Workspace cursor is invalid.");
    }
    const mailboxes = config.mailboxes.slice(offset, offset + limit).map((mailbox) => ({
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

function messageHeaders(message: GoogleWorkspaceMessage) {
  const headers = message.payload?.headers ?? [];
  const value = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null;
  const addresses = (name: string) => {
    const header = value(name);
    return header
      ? header.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  };
  return { value, addresses };
}

function searchMessage(
  mailbox: string,
  reference: { id: string; threadId: string },
  metadata: GoogleWorkspaceMessage | null,
): OperatorGoogleWorkspaceSearchMessage {
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
  const headers = messageHeaders(metadata);
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
  if (input.cursor) {
    assertSearchCursorState(state);
  } else if (requested) {
    for (let offset = 0; offset < requested.length; offset += 5) {
      state.mailboxes.push(
        ...(await Promise.all(
          requested
            .slice(offset, offset + 5)
            .map((mailbox) => resolveMailbox(provider, config, mailbox)),
        )),
      );
    }
  } else if (config.mailboxMode === "manual") {
    state.mailboxes = [...config.mailboxes];
  }
  assertSearchCursorState(state);
  if (
    config.mailboxMode === "manual" &&
    state.mailboxes.some((mailbox) => !config.mailboxes.includes(mailbox))
  ) {
    throw new Error("Google Workspace cursor contains an unauthorized mailbox.");
  }
  const messages: OperatorGoogleWorkspaceSearchMessage[] = [];
  const searchedMailboxes: string[] = [];
  const errors: Array<{ mailbox: string; error: string }> = [];
  let directoryError: string | null = null;
  let attempted = 0;
  let directoryPagesFetched = 0;

  while (
    messages.length < limit &&
    attempted < MAX_SEARCH_MAILBOXES_PER_CALL
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

    const mailbox = state.mailboxes[state.mailboxIndex];
    attempted += 1;
    searchedMailboxes.push(mailbox);
    try {
      const page = await provider.listMessages({
        mailbox,
        query,
        pageToken: state.gmailPageToken,
        maxResults: limit - messages.length,
      });
      const metadata = await Promise.all(
        page.messages.map(async (reference) => {
          try {
            return await provider.getMessageMetadata({
              mailbox,
              messageId: reference.id,
            });
          } catch (error) {
            errors.push({ mailbox, error: sanitizeGoogleWorkspaceError(error) });
            state.hadErrors = true;
            state.encounteredErrorCount += 1;
            return null;
          }
        }),
      );
      messages.push(
        ...page.messages.map((reference, index) =>
          searchMessage(mailbox, reference, metadata[index]),
        ),
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
        state,
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
            candidate.mailbox === error.mailbox && candidate.error === error.error,
        ) === index,
    ),
    directoryError,
    encounteredErrorCount: state.encounteredErrorCount,
    nextCursor,
    completeness:
      !nextCursor && !state.hadErrors ? "complete" : "partial",
    ordering: "mailbox_then_gmail",
    querySemantics: "gmail_api_no_alias_expansion",
  };
}

function decodePartData(data: string) {
  return Buffer.from(data, "base64url");
}

function disposition(part: GoogleWorkspaceMessagePart) {
  return (
    part.headers.find(
      (header) => header.name.toLowerCase() === "content-disposition",
    )?.value.toLowerCase() ?? ""
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
    const isAttachment = Boolean(part.filename) || disposition(part).includes("attachment");
    if (!isAttachment && part.body.data) {
      if (part.mimeType.toLowerCase() === "text/plain") {
        plain.push(decodePartData(part.body.data).toString("utf8"));
      } else if (part.mimeType.toLowerCase() === "text/html") {
        html.push(decodePartData(part.body.data).toString("utf8"));
      }
    }
    part.parts.forEach(visit);
  };
  if (message.payload) visit(message.payload);
  const plainText = plain.map((value) => value.trim()).filter(Boolean).join("\n\n");
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

function attachmentMetadata(located: LocatedPart): OperatorGoogleWorkspaceThreadAttachment {
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

function threadMessage(
  mailbox: string,
  message: GoogleWorkspaceMessage,
  bodyOffset: number,
  remainingChars: number,
) {
  const headers = messageHeaders(message);
  const content = messageBody(message);
  const body = content.body.slice(bodyOffset, bodyOffset + remainingChars);
  const nextOffset = bodyOffset + body.length;
  const bodyComplete = nextOffset >= content.body.length;
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
    bodyComplete,
    attachments: allParts(message)
      .filter(({ part }) => isAttachmentPart(part))
      .map(attachmentMetadata),
  };
  return { value, nextOffset };
}

export async function readCompanyEmailThread(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceReadThreadInput,
): Promise<OperatorGoogleWorkspaceReadThreadResult> {
  const { config, provider } = dependencies;
  const mailbox = await resolveMailbox(provider, config, input.mailbox);
  const threadId = input.threadId.trim();
  if (!threadId || threadId.length > 512) throw new Error("Gmail thread ID is invalid.");
  const limit = pageSize(input.limit);
  const requestFingerprint = hashJson({ mailbox, threadId, limit });
  const messageIds = await provider.getThreadMessageIds({ mailbox, threadId });
  const threadFingerprint = hashJson(messageIds);
  const state = decodeCursor<ThreadCursorState>(
    input.cursor,
    {
      tool: "read_company_email_thread",
      configUpdatedAt: config.updatedAt,
      requestFingerprint,
    },
    { messageIndex: 0, bodyOffset: 0, threadFingerprint },
  );
  if (
    state.threadFingerprint !== threadFingerprint ||
    !Number.isInteger(state.messageIndex) ||
    state.messageIndex < 0 ||
    state.messageIndex > messageIds.length ||
    !Number.isInteger(state.bodyOffset) ||
    state.bodyOffset < 0
  ) {
    throw new Error("The Gmail thread changed; restart the thread read.");
  }

  const messages: OperatorGoogleWorkspaceThreadMessage[] = [];
  let remainingChars = MAX_THREAD_BODY_CHARS_PER_PAGE;
  while (
    state.messageIndex < messageIds.length &&
    messages.length < limit &&
    remainingChars > 0
  ) {
    const message = await provider.getMessageFull({
      mailbox,
      messageId: messageIds[state.messageIndex],
    });
    if (message.threadId !== threadId) {
      throw new Error("Gmail returned a message outside the requested thread.");
    }
    const rendered = threadMessage(
      mailbox,
      message,
      state.bodyOffset,
      remainingChars,
    );
    messages.push(rendered.value);
    remainingChars -= rendered.value.body.length;
    if (!rendered.value.bodyComplete) {
      state.bodyOffset = rendered.nextOffset;
      break;
    }
    state.messageIndex += 1;
    state.bodyOffset = 0;
  }
  const hasMore = state.messageIndex < messageIds.length;
  const nextCursor = hasMore
    ? encodeCursor(
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
    completeness: nextCursor ? "partial" : "complete",
    maxBodyCharsPerPage: MAX_THREAD_BODY_CHARS_PER_PAGE,
  };
}

function locatedAttachment(message: GoogleWorkspaceMessage, attachmentId: string) {
  const parts = allParts(message).filter(({ part }) => isAttachmentPart(part));
  if (attachmentId.startsWith("part:")) {
    const stablePartId = attachmentId.slice("part:".length);
    return parts.find(
      (located) =>
        located.stablePartId === stablePartId &&
        !located.part.body.attachmentId &&
        Boolean(located.part.body.data),
    );
  }
  return parts.find((located) => located.part.body.attachmentId === attachmentId);
}

export async function getCompanyEmailAttachment(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceGetAttachmentInput,
): Promise<{ result: OperatorGoogleWorkspaceGetAttachmentResult; attachment: StoredAttachment }> {
  const { config, provider, attachmentStorage } = dependencies;
  const mailbox = await resolveMailbox(provider, config, input.mailbox);
  const messageId = input.messageId.trim();
  const attachmentId = input.attachmentId.trim();
  if (!messageId || !attachmentId) throw new Error("Gmail attachment identity is invalid.");
  const message = await provider.getMessageFull({ mailbox, messageId });
  if (message.id !== messageId) throw new Error("Gmail message identity changed.");
  const located = locatedAttachment(message, attachmentId);
  if (!located) throw new Error("Attachment is not part of the requested Gmail message.");
  const metadata = attachmentMetadata(located);
  if (metadata.size > GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes) {
    throw new Error("Gmail attachment exceeds the 15 MB retrieval limit.");
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
  if (encoded == null) throw new Error("Gmail attachment content is unavailable.");
  const bytes = decodePartData(encoded);
  if (bytes.byteLength > GOOGLE_WORKSPACE_LIMITS.maxAttachmentBytes) {
    throw new Error("Gmail attachment exceeds the 15 MB retrieval limit.");
  }
  const source: OperatorGoogleWorkspaceAttachmentSource = {
    mailbox,
    messageId,
    threadId: message.threadId,
    attachmentId: metadata.attachmentId,
    partId: metadata.partId,
    filename: metadata.filename,
    contentType: metadata.contentType,
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
      filename: metadata.filename,
      contentType: metadata.contentType,
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

export async function runGoogleWorkspaceTool(
  dependencies: GoogleWorkspaceToolDependencies,
  toolName: OperatorGoogleWorkspaceToolName,
  input: unknown,
) {
  const parsed = parseGoogleWorkspaceToolInput(toolName, input);
  if (toolName === "list_company_mailboxes") {
    return { result: await listCompanyMailboxes(dependencies, parsed as OperatorGoogleWorkspaceListMailboxesInput) };
  }
  if (toolName === "search_company_email") {
    return { result: await searchCompanyEmail(dependencies, parsed as OperatorGoogleWorkspaceSearchEmailInput) };
  }
  if (toolName === "read_company_email_thread") {
    return { result: await readCompanyEmailThread(dependencies, parsed as OperatorGoogleWorkspaceReadThreadInput) };
  }
  if (toolName === "get_company_email_attachment") {
    const output = await getCompanyEmailAttachment(
      dependencies,
      parsed as OperatorGoogleWorkspaceGetAttachmentInput,
    );
    return { result: output.result, attachments: [output.attachment] };
  }
  throw new Error(`Unsupported Google Workspace tool: ${String(toolName)}`);
}

export const googleWorkspaceToolTesting = {
  decodeCursor,
  encodeCursor,
  hashJson,
  locatedAttachment,
};
