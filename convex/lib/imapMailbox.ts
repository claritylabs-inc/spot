"use node";

// Shared IMAP account helpers for connected-mailbox node actions.
// Uses Node.js built-ins, so import this module only from "use node" action files.
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  resolveImapDestination,
  type ResolvedImapDestination,
} from "./imapDestination";
import { comparableRfcId } from "./messageId";
import { decryptSecret } from "./secretBox";

export type ConnectedEmailAccount = Doc<"connectedEmailAccounts">;

export type ImapConnectionConfig = Pick<
  ConnectedEmailAccount,
  "host" | "port" | "secure" | "username" | "encryptedPassword"
>;

export const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
export const IMAP_GREETING_TIMEOUT_MS = 10_000;
export const IMAP_SOCKET_TIMEOUT_MS = 18_000;
export const SEARCH_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const MAILBOX_MESSAGE_UNAVAILABLE_MESSAGE =
  "This email is no longer available in the connected mailbox. It may have been moved or deleted.";

const MAX_MESSAGE_ID_SEARCH_MAILBOXES = 8;
const MESSAGE_ID_SEARCH_SPECIAL_USES = new Set(["\\all", "\\archive"]);
const MESSAGE_ID_SEARCH_FOLDER_NAMES = new Set(["all mail", "archive", "archives"]);

export class MailboxMessageUnavailableError extends Error {
  constructor(message = MAILBOX_MESSAGE_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "MailboxMessageUnavailableError";
  }
}

export function isMailboxMessageUnavailableError(
  error: unknown,
): error is MailboxMessageUnavailableError {
  return error instanceof MailboxMessageUnavailableError;
}

export async function withClient<T>(
  account: ImapConnectionConfig,
  fn: (client: ImapFlow) => Promise<T>,
  destination?: ResolvedImapDestination,
): Promise<T> {
  const resolvedDestination =
    destination ??
    await resolveImapDestination({
      host: account.host,
      port: account.port,
    });
  const client = new ImapFlow({
    host: resolvedDestination.connectionHost,
    port: resolvedDestination.port,
    servername: resolvedDestination.servername,
    secure: account.secure,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    auth: {
      user: account.username,
      pass: decryptSecret(account.encryptedPassword),
    },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export function imapErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const parts = [
    record.message,
    record.response,
    record.responseText,
    record.serverResponse,
    record.code,
    record.command,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  return [...new Set(parts)].join(" · ") || "IMAP command failed";
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function messageRef(accountId: string, mailbox: string, uid: number) {
  return Buffer.from(JSON.stringify({ accountId, mailbox, uid }), "utf8").toString("base64url");
}

export function parseMessageRef(ref: string): {
  accountId: Id<"connectedEmailAccounts">;
  mailbox: string;
  uid: number;
} {
  const parsed = JSON.parse(Buffer.from(ref, "base64url").toString("utf8"));
  return {
    accountId: parsed.accountId,
    mailbox: parsed.mailbox,
    uid: Number(parsed.uid),
  };
}

export function isSpotSearchLoopAddress(address?: string) {
  const domain = address?.split("@").pop()?.trim().toLowerCase();
  return !!domain && (
    domain === "spot.insure" ||
    domain.endsWith(".spot.insure") ||
    domain === "spot.claritylabs.inc" ||
    domain.endsWith(".spot.claritylabs.inc") ||
    domain === "glass.insure" ||
    domain.endsWith(".glass.insure") ||
    domain === "glass.claritylabs.inc" ||
    domain.endsWith(".glass.claritylabs.inc")
  );
}

export function isSpotSearchLoopEmail(parsed: ParsedMail) {
  return parsed.from?.value.some((item) => isSpotSearchLoopAddress(item.address)) ?? false;
}

export async function fetchParsedMessage(
  client: ImapFlow,
  mailbox: string,
  uid: number,
  maxBytes = SEARCH_DOWNLOAD_MAX_BYTES,
) {
  await client.mailboxOpen(mailbox);
  const downloaded = await client.download(String(uid), undefined, {
    uid: true,
    maxBytes,
  });
  if (!downloaded?.content || !downloaded.meta) {
    throw new MailboxMessageUnavailableError();
  }
  const raw = await streamToBuffer(downloaded.content);
  if (
    downloaded.meta.expectedSize > 0 &&
    raw.length < downloaded.meta.expectedSize
  ) {
    throw new Error(
      `Email message exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB download limit`,
    );
  }
  return await simpleParser(raw);
}

function searchableMailboxPaths(
  originalMailbox: string,
  mailboxes: Awaited<ReturnType<ImapFlow["list"]>>,
) {
  const candidates = mailboxes
    .filter((mailbox) => {
      const flags = [...mailbox.flags].map((flag) => flag.toLowerCase());
      const specialUse = mailbox.specialUse?.toLowerCase();
      return (
        mailbox.listed &&
        !flags.includes("\\noselect") &&
        (
          (specialUse && MESSAGE_ID_SEARCH_SPECIAL_USES.has(specialUse)) ||
          MESSAGE_ID_SEARCH_FOLDER_NAMES.has(mailbox.name.toLowerCase())
        )
      );
    })
    .sort((left, right) => {
      const priority = (specialUse?: string) => {
        if (specialUse?.toLowerCase() === "\\all") return 0;
        if (specialUse?.toLowerCase() === "\\archive") return 1;
        return 2;
      };
      return priority(left.specialUse) - priority(right.specialUse);
    });

  return [originalMailbox, ...candidates.map((mailbox) => mailbox.path)]
    .filter((path, index, paths) =>
      paths.findIndex((candidate) => candidate.toLowerCase() === path.toLowerCase()) === index
    )
    .slice(0, MAX_MESSAGE_ID_SEARCH_MAILBOXES);
}

export async function resolveParsedMessage(
  client: ImapFlow,
  args: {
    mailbox: string;
    uid: number;
    messageId?: string;
    maxBytes?: number;
  },
): Promise<{ parsed: ParsedMail; mailbox: string; uid: number }> {
  const maxBytes = args.maxBytes ?? SEARCH_DOWNLOAD_MAX_BYTES;
  const messageId = args.messageId?.trim();
  const expectedMessageId = comparableRfcId(messageId);
  try {
    const parsed = await fetchParsedMessage(client, args.mailbox, args.uid, maxBytes);
    if (!expectedMessageId || comparableRfcId(parsed.messageId) === expectedMessageId) {
      return { parsed, mailbox: args.mailbox, uid: args.uid };
    }
  } catch (error) {
    if (!isMailboxMessageUnavailableError(error) || !messageId) {
      throw error;
    }
  }

  if (!messageId) throw new MailboxMessageUnavailableError();
  const paths = searchableMailboxPaths(args.mailbox, await client.list());
  let searchedMailbox = false;
  let firstSearchError: unknown;

  for (const mailbox of paths) {
    let result: Awaited<ReturnType<ImapFlow["search"]>>;
    try {
      await client.mailboxOpen(mailbox);
      result = await client.search(
        { header: { "Message-ID": messageId } },
        { uid: true },
      );
      searchedMailbox = true;
    } catch (error) {
      firstSearchError ??= error;
      continue;
    }

    const uids = Array.isArray(result) ? [...result].sort((left, right) => right - left) : [];
    for (const uid of uids) {
      try {
        const parsed = await fetchParsedMessage(client, mailbox, uid, maxBytes);
        if (comparableRfcId(parsed.messageId) === expectedMessageId) {
          return { parsed, mailbox, uid };
        }
      } catch (error) {
        if (!isMailboxMessageUnavailableError(error)) throw error;
      }
    }
  }

  if (!searchedMailbox && firstSearchError) throw firstSearchError;
  throw new MailboxMessageUnavailableError();
}

export async function accessibleAccount(ctx: ActionCtx, args: {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  accountId?: Id<"connectedEmailAccounts">;
}): Promise<ConnectedEmailAccount> {
  if (args.accountId) {
    const account = await ctx.runQuery(internal.connectedEmail.getAccessibleInternal, {
      accountId: args.accountId,
      orgId: args.orgId,
      userId: args.userId,
    });
    if (!account) throw new Error("Connected email account not found");
    return account;
  }
  const accounts = await ctx.runQuery(internal.connectedEmail.listAccessibleInternal, {
    orgId: args.orgId,
    userId: args.userId,
  });
  const account = accounts[0];
  if (!account) throw new Error("No connected email account is available");
  return account;
}
