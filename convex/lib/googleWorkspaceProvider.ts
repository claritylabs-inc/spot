"use node";

import { google, type admin_directory_v1, type gmail_v1 } from "googleapis";
import type { GoogleWorkspaceServiceAccountCredentials } from "./googleWorkspaceCredentials";

const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;
const GOOGLE_REQUEST_OPTIONS = {
  timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  retry: true,
  retryConfig: { retry: 2, noResponseRetries: 2 },
};
const GOOGLE_AUTH_TRANSPORT_OPTIONS = {
  timeout: GOOGLE_REQUEST_TIMEOUT_MS,
  retry: true,
  retryConfig: { retry: 2, noResponseRetries: 2 },
};

export type GoogleWorkspaceDirectoryUser = {
  primaryEmail: string;
  displayName: string | null;
  aliases: string[];
  suspended: boolean;
  archived: boolean;
  mailboxSetup: boolean | null;
};

export type GoogleWorkspaceMessagePart = {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Array<{ name: string; value: string }>;
  body: {
    attachmentId: string | null;
    size: number;
    data: string | null;
  };
  parts: GoogleWorkspaceMessagePart[];
};

export type GoogleWorkspaceMessage = {
  id: string;
  threadId: string;
  internalDate: string | null;
  snippet: string | null;
  payload: GoogleWorkspaceMessagePart | null;
};

export type GoogleWorkspaceProvider = {
  listDirectoryUsers(args: {
    subject: string;
    pageToken?: string;
    maxResults: number;
  }): Promise<{
    users: GoogleWorkspaceDirectoryUser[];
    nextPageToken: string | null;
  }>;
  getDirectoryUser(args: {
    subject: string;
    userKey: string;
  }): Promise<GoogleWorkspaceDirectoryUser>;
  getMailboxProfile(
    mailbox: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ emailAddress: string }>;
  listMessages(args: {
    mailbox: string;
    query: string;
    pageToken?: string;
    maxResults: number;
  }): Promise<{
    messages: Array<{ id: string; threadId: string }>;
    nextPageToken: string | null;
  }>;
  getThreadMessageIds(args: {
    mailbox: string;
    threadId: string;
  }): Promise<string[]>;
  getMessageMetadata(args: {
    mailbox: string;
    messageId: string;
  }): Promise<GoogleWorkspaceMessage>;
  getMessageFull(args: {
    mailbox: string;
    messageId: string;
  }): Promise<GoogleWorkspaceMessage>;
  getAttachment(args: {
    mailbox: string;
    messageId: string;
    attachmentId: string;
  }): Promise<{ data: string; size: number }>;
};

export class GoogleWorkspaceProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleWorkspaceProviderError";
  }
}

function normalizedPart(
  part: gmail_v1.Schema$MessagePart | undefined,
): GoogleWorkspaceMessagePart | null {
  if (!part) return null;
  return {
    partId: part.partId ?? "",
    mimeType: part.mimeType ?? "application/octet-stream",
    filename: part.filename ?? "",
    headers: (part.headers ?? []).flatMap((header) =>
      header.name && header.value
        ? [{ name: header.name, value: header.value }]
        : [],
    ),
    body: {
      attachmentId: part.body?.attachmentId ?? null,
      size: part.body?.size ?? 0,
      data: part.body?.data ?? null,
    },
    parts: (part.parts ?? []).flatMap((child) => {
      const normalized = normalizedPart(child);
      return normalized ? [normalized] : [];
    }),
  };
}

function normalizedMessage(
  message: gmail_v1.Schema$Message,
): GoogleWorkspaceMessage {
  if (!message.id || !message.threadId) {
    throw new Error("Google Workspace returned an invalid Gmail message.");
  }
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: message.internalDate ?? null,
    snippet: message.snippet ?? null,
    payload: normalizedPart(message.payload),
  };
}

function normalizedDirectoryUser(
  user: admin_directory_v1.Schema$User,
): GoogleWorkspaceDirectoryUser {
  if (!user.primaryEmail) {
    throw new Error("Google Workspace returned a Directory user without an email.");
  }
  const primaryEmail = user.primaryEmail.trim().toLowerCase();
  const aliases = [...(user.aliases ?? []), ...(user.nonEditableAliases ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, values) =>
      value !== primaryEmail && values.indexOf(value) === index,
    );
  return {
    primaryEmail,
    displayName: user.name?.fullName?.trim() || null,
    aliases,
    suspended: user.suspended === true,
    archived: user.archived === true,
    mailboxSetup:
      typeof user.isMailboxSetup === "boolean" ? user.isMailboxSetup : null,
  };
}

export function isEligibleDirectoryMailbox(user: GoogleWorkspaceDirectoryUser) {
  return !user.suspended && !user.archived && user.mailboxSetup !== false;
}

export function delegatedJwtOptions(
  credentials: GoogleWorkspaceServiceAccountCredentials,
  subject: string,
  scopes: readonly string[],
) {
  return {
    email: credentials.clientEmail,
    key: credentials.privateKey,
    keyId: credentials.privateKeyId ?? undefined,
    subject,
    scopes: [...scopes],
    transporterOptions: GOOGLE_AUTH_TRANSPORT_OPTIONS,
  };
}

function delegatedAuth(
  credentials: GoogleWorkspaceServiceAccountCredentials,
  subject: string,
  scopes: readonly string[],
) {
  return new google.auth.JWT(delegatedJwtOptions(credentials, subject, scopes));
}

function headerNames() {
  return [
    "From",
    "To",
    "Cc",
    "Bcc",
    "Reply-To",
    "Subject",
    "Date",
    "Message-ID",
    "In-Reply-To",
    "References",
  ];
}

export function createGoogleWorkspaceProvider(
  credentials: GoogleWorkspaceServiceAccountCredentials,
  scopes: {
    gmail: readonly string[];
    directory: readonly string[];
  },
): GoogleWorkspaceProvider {
  const gmailClients = new Map<string, gmail_v1.Gmail>();
  const directoryClients = new Map<string, admin_directory_v1.Admin>();
  const gmailFor = (mailbox: string) => {
    const existing = gmailClients.get(mailbox);
    if (existing) return existing;
    const client = google.gmail({
      version: "v1",
      auth: delegatedAuth(credentials, mailbox, scopes.gmail),
    });
    gmailClients.set(mailbox, client);
    return client;
  };
  const directoryFor = (subject: string) => {
    const existing = directoryClients.get(subject);
    if (existing) return existing;
    const client = google.admin({
      version: "directory_v1",
      auth: delegatedAuth(credentials, subject, scopes.directory),
    });
    directoryClients.set(subject, client);
    return client;
  };
  const request = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      throw new GoogleWorkspaceProviderError(sanitizeGoogleWorkspaceError(error));
    }
  };

  return {
    async listDirectoryUsers({ subject, pageToken, maxResults }) {
      const response = await request(() =>
        directoryFor(subject).users.list(
          {
            customer: "my_customer",
            orderBy: "email",
            projection: "full",
            showDeleted: "false",
            pageToken,
            maxResults,
          },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return {
        users: (response.data.users ?? []).map(normalizedDirectoryUser),
        nextPageToken: response.data.nextPageToken ?? null,
      };
    },

    async getDirectoryUser({ subject, userKey }) {
      const response = await request(() =>
        directoryFor(subject).users.get(
          { userKey, projection: "full" },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return normalizedDirectoryUser(response.data);
    },

    async getMailboxProfile(mailbox, options) {
      const response = await request(() =>
        gmailFor(mailbox).users.getProfile(
          { userId: "me" },
          { ...GOOGLE_REQUEST_OPTIONS, signal: options?.signal },
        ),
      );
      if (!response.data.emailAddress) {
        throw new Error("Google Workspace returned an invalid mailbox profile.");
      }
      return { emailAddress: response.data.emailAddress.toLowerCase() };
    },

    async listMessages({ mailbox, query, pageToken, maxResults }) {
      const response = await request(() =>
        gmailFor(mailbox).users.messages.list(
          {
            userId: "me",
            q: query,
            pageToken,
            maxResults,
            includeSpamTrash: false,
          },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return {
        messages: (response.data.messages ?? []).flatMap((message) =>
          message.id && message.threadId
            ? [{ id: message.id, threadId: message.threadId }]
            : [],
        ),
        nextPageToken: response.data.nextPageToken ?? null,
      };
    },

    async getThreadMessageIds({ mailbox, threadId }) {
      const response = await request(() =>
        gmailFor(mailbox).users.threads.get(
          {
            userId: "me",
            id: threadId,
            format: "minimal",
            fields: "messages/id",
          },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return (response.data.messages ?? []).flatMap((message) =>
        message.id ? [message.id] : [],
      );
    },

    async getMessageMetadata({ mailbox, messageId }) {
      const response = await request(() =>
        gmailFor(mailbox).users.messages.get(
          {
            userId: "me",
            id: messageId,
            format: "metadata",
            metadataHeaders: headerNames(),
          },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return normalizedMessage(response.data);
    },

    async getMessageFull({ mailbox, messageId }) {
      const response = await request(() =>
        gmailFor(mailbox).users.messages.get(
          { userId: "me", id: messageId, format: "full" },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      return normalizedMessage(response.data);
    },

    async getAttachment({ mailbox, messageId, attachmentId }) {
      const response = await request(() =>
        gmailFor(mailbox).users.messages.attachments.get(
          { userId: "me", messageId, id: attachmentId },
          GOOGLE_REQUEST_OPTIONS,
        ),
      );
      if (response.data.data == null) {
        throw new Error("Google Workspace returned an empty attachment.");
      }
      return { data: response.data.data, size: response.data.size ?? 0 };
    },
  };
}

export function sanitizeGoogleWorkspaceError(error: unknown): string {
  if (error instanceof GoogleWorkspaceProviderError) return error.message;
  if (!error || typeof error !== "object") {
    return "Google Workspace request failed.";
  }
  const record = error as {
    code?: unknown;
    response?: { status?: unknown };
    errors?: Array<{ reason?: unknown }>;
  };
  const status =
    typeof record.response?.status === "number"
      ? record.response.status
      : typeof record.code === "number"
        ? record.code
        : null;
  if (status === 400) return "Google Workspace rejected the request.";
  if (status === 401) return "Google Workspace credentials were rejected.";
  if (status === 403) {
    return "Google Workspace denied delegated access. Check domain-wide delegation, scopes, and the impersonated account.";
  }
  if (status === 404) return "The requested Google Workspace resource was not found.";
  if (status === 429) return "Google Workspace rate-limited the request. Retry shortly.";
  if (status !== null && status >= 500) {
    return "Google Workspace is temporarily unavailable. Retry shortly.";
  }
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  if (code.includes("TIMEOUT") || code === "ETIMEDOUT" || code === "ECONNRESET") {
    return "The Google Workspace request timed out. Retry shortly.";
  }
  return "Google Workspace request failed.";
}
