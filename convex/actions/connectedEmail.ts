"use node";

import dayjs from "dayjs";
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import type { ParsedMail } from "mailparser";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveImapDestination } from "../lib/imapDestination";
import { preparePdfTextWithParserFallback } from "../lib/liteparsePreprocessor";
import {
  accessibleAccount,
  encryptPassword,
  fetchParsedMessage,
  imapErrorMessage,
  isMailboxMessageUnavailableError,
  isSpotSearchLoopEmail,
  MailboxMessageUnavailableError,
  messageRef,
  parseMessageRef,
  resolveParsedMessage,
  withClient,
  IMPORT_DOWNLOAD_MAX_BYTES,
  type ConnectedEmailAccount,
} from "../lib/imapMailbox";
import {
  isPdfMailboxAttachment,
  isSupportedRequirementAttachment,
} from "../lib/mailboxAutomation";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

const SEARCH_CANDIDATE_MULTIPLIER = 3;
const SEARCH_MAX_CANDIDATES = 30;
const THREAD_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_PREVIEW_TTL_MS = 60 * 60 * 1000;

type MailboxAttachmentInfo = {
  attachmentIndex?: number;
  filename?: string;
  contentType: string;
  size: number;
};

type MailboxAddressInfo = {
  name?: string;
  address: string;
};

type MailboxSearchRow = {
  emailRef: string;
  accountId: Id<"connectedEmailAccounts">;
  accountEmail: string;
  accountHost: string;
  mailbox: string;
  uid: number;
  dateFrom: string;
  dateTo?: string;
  subject: string;
  from?: string;
  to: string[];
  cc: string[];
  date?: string;
  snippet: string;
  attachmentCount: number;
  attachments: MailboxAttachmentInfo[];
};

type MailboxSearchErrorRow = {
  type: "mailbox_search_error";
  accountId: Id<"connectedEmailAccounts">;
  accountEmail: string;
  accountHost: string;
  mailbox: string;
  message: string;
  hint: string;
};

type MailboxReadRow = {
  emailRef: string;
  accountId: Id<"connectedEmailAccounts">;
  accountEmail: string;
  accountHost: string;
  mailbox: string;
  uid: number;
  subject: string;
  from?: string;
  fromAddresses: MailboxAddressInfo[];
  to: string;
  toAddresses: MailboxAddressInfo[];
  cc: string;
  ccAddresses: MailboxAddressInfo[];
  date?: string;
  text: string;
  html?: string;
  attachments: MailboxAttachmentInfo[];
};

type MailboxReadArgs = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  emailRef: string;
  automationItemId?: Id<"connectedEmailAutomationItems">;
};

type SavedThreadAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId: Id<"_storage">;
};

export type SaveAttachmentsOutcome =
  | { status: "no_saveable_attachments" }
  | {
      status: "duplicate_attachments";
      attachments: SavedThreadAttachment[];
      skippedDuplicateFilenames: string[];
    }
  | {
      status: "saved";
      messageId: Id<"threadMessages">;
      attachments: SavedThreadAttachment[];
      skippedDuplicateFilenames: string[];
    };

export type SaveMessageOutcome =
  | { status: "message_too_large"; message: string }
  | {
      status: "duplicate_attachments";
      attachments: SavedThreadAttachment[];
      skippedDuplicateFilenames: string[];
    }
  | {
      status: "saved";
      messageId: Id<"threadMessages">;
      attachment: SavedThreadAttachment;
      attachments: SavedThreadAttachment[];
    };

export type PolicyImportFile = {
  fileId: Id<"_storage">;
  fileName: string;
  fileSha256: string;
};

export type PolicyImportOutcome =
  | { status: "no_pdf_attachments" }
  | {
      status: "duplicate" | "started" | "failed";
      files: PolicyImportFile[];
      result:
        | { error: string }
        | { success: true; policyId: string; duplicate: boolean };
    };

export type RequirementImportEntry =
  | {
      source: "email_body";
      subject: string;
      createdCount: number;
      requirementIds: Id<"insuranceRequirements">[];
      sourceDocumentId: Id<"requirementSourceDocuments">;
    }
  | {
      source: "attachment";
      fileId: Id<"_storage">;
      fileName: string;
      createdCount: number;
      requirementIds: Id<"insuranceRequirements">[];
      sourceDocumentId: Id<"requirementSourceDocuments">;
    };

export type RequirementImportOutcome =
  | { status: "no_requirement_sources" }
  | { status: "imported"; imports: RequirementImportEntry[] };

function normalizeThreadAttachmentFilename(filename?: string | null) {
  return (filename?.trim() || "email-attachment").toLowerCase();
}

async function getExistingThreadAttachmentNames(
  ctx: ActionCtx,
  args: { threadId: Id<"threads">; orgId: Id<"organizations"> },
) {
  const attachments: Array<Pick<SavedThreadAttachment, "filename">> =
    await ctx.runQuery(internal.threads.listThreadAttachmentsInternal, args);
  return new Set(
    attachments.map((attachment) =>
      normalizeThreadAttachmentFilename(attachment.filename),
    ),
  );
}

function headerLine(name: string, value?: string) {
  return value?.trim() ? `${name}: ${value.replace(/\r?\n/g, " ").trim()}\r\n` : "";
}

function safeEmailExportFilename(subject?: string, requested?: string) {
  const base = (requested?.trim() || subject?.trim() || "connected-email")
    .replace(/\.eml$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "connected-email";
  return `${base}.eml`;
}

function buildSavedMessageExport(args: {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: Date;
  text?: string;
  html?: string | false;
}) {
  const html = typeof args.html === "string" && args.html.trim() ? args.html : undefined;
  const text = args.text?.trim() || (html ? "This email contains HTML content." : "");
  if (html) {
    const boundary = `spot-${createHash("sha256").update(`${args.subject ?? ""}${args.date?.toISOString() ?? ""}`).digest("hex").slice(0, 16)}`;
    return [
      headerLine("Subject", args.subject ?? "(no subject)"),
      headerLine("From", args.from),
      headerLine("To", args.to),
      headerLine("Cc", args.cc),
      headerLine("Date", args.date?.toUTCString()),
      "MIME-Version: 1.0\r\n",
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`,
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: text/plain; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      text,
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: text/html; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      html,
      "\r\n",
      `--${boundary}--\r\n`,
    ].join("");
  }
  return [
    headerLine("Subject", args.subject ?? "(no subject)"),
    headerLine("From", args.from),
    headerLine("To", args.to),
    headerLine("Cc", args.cc),
    headerLine("Date", args.date?.toUTCString()),
    "MIME-Version: 1.0\r\n",
    "Content-Type: text/plain; charset=utf-8\r\n",
    "Content-Transfer-Encoding: 8bit\r\n",
    "\r\n",
    text,
    "\r\n",
  ].join("");
}

async function requireOrgMember(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  const members: Array<Pick<Doc<"orgMemberships">, "role" | "userId">> =
    await ctx.runQuery(internal.orgs.getMembersInternal, { orgId });
  const membership = members.find((member) => member.userId === userId);
  if (!membership) {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Connected email is available only to members of this organization.",
    );
  }
  return membership;
}

function mailboxSearchError(
  account: ConnectedEmailAccount,
  mailbox: string,
  error: unknown,
): MailboxSearchErrorRow {
  const message = imapErrorMessage(error);
  console.warn("[connectedEmail.searchInternal] IMAP search failed", {
    accountId: account._id,
    accountEmail: account.emailAddress,
    host: account.host,
    mailbox,
    error: message,
  });
  return {
    type: "mailbox_search_error",
    accountId: account._id,
    accountEmail: account.emailAddress,
    accountHost: account.host,
    mailbox,
    message,
    hint:
      "Spot could not search this mailbox. The folder may not exist, the provider rejected the IMAP SEARCH command, or the mailbox connection needs to be reconnected.",
  };
}

function mailboxSearchQuery(args: {
  since: Date;
  before?: Date;
  query?: string;
}): Record<string, unknown> {
  const criteria: Record<string, unknown> = { since: args.since };
  if (args.before) criteria.before = args.before;
  const query = args.query?.trim();
  if (query) criteria.text = query;
  return criteria;
}

function searchDateWindow(args: {
  sinceDays?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const explicitFrom = args.dateFrom ? dayjs(args.dateFrom) : undefined;
  const explicitTo = args.dateTo ? dayjs(args.dateTo) : undefined;
  const endExclusive = explicitTo?.isValid()
    ? explicitTo.add(1, "day").startOf("day")
    : undefined;
  const fallbackBase = endExclusive ?? dayjs();
  const since = explicitFrom?.isValid()
    ? explicitFrom.startOf("day")
    : fallbackBase.subtract(args.sinceDays ?? 14, "day").startOf("day");
  const before = endExclusive && endExclusive.isAfter(since) ? endExclusive : undefined;
  return {
    since: since.toDate(),
    before: before?.toDate(),
    dateFrom: since.format("YYYY-MM-DD"),
    dateTo: before ? before.subtract(1, "day").format("YYYY-MM-DD") : undefined,
  };
}

function addressText(value: ParsedMail["from"] | ParsedMail["to"] | ParsedMail["cc"]) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) =>
    entry.value
      .map((item) => item.address)
      .filter((address): address is string => Boolean(address)),
  );
}

function addressDetails(
  value: ParsedMail["from"] | ParsedMail["to"] | ParsedMail["cc"],
): MailboxAddressInfo[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) =>
    entry.value.flatMap((item) => {
      const addresses = item.group?.length ? item.group : [item];
      return addresses.flatMap((address) => {
        const email = address.address?.trim();
        if (!email) return [];
        const name = address.name.trim();
        return [name ? { name, address: email } : { address: email }];
      });
    }),
  );
}

function buildEmailRequirementText(parsed: ParsedMail) {
  const body = (parsed.text ?? "").replace(/\s+\n/g, "\n").trim();
  if (!body) return "";
  const headers = [
    parsed.subject ? `Subject: ${parsed.subject}` : undefined,
    parsed.from?.text ? `From: ${parsed.from.text}` : undefined,
    parsed.date ? `Date: ${parsed.date.toISOString()}` : undefined,
  ].filter(Boolean);
  return [...headers, "", body].join("\n");
}

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

async function extractDocxText(buffer: ArrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractAttachmentText(attachment: ParsedMail["attachments"][number]) {
  const lowerName = (attachment.filename ?? "").toLowerCase();
  const type = attachment.contentType.toLowerCase();
  const copy = new Uint8Array(attachment.content.length);
  copy.set(attachment.content);
  const buffer = copy.buffer;
  if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
    const prepared = await preparePdfTextWithParserFallback({
      pdfBytes: new Uint8Array(buffer),
      documentId: attachment.filename ?? "email-attachment",
      sourceKind: "attachment",
    });
    return prepared.text;
  }
  if (type.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return await extractDocxText(buffer);
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json")
  ) {
    return decodeText(buffer);
  }
  throw new Error("Unsupported attachment type for text reading");
}

export const connect = action({
  args: {
    orgId: v.id("organizations"),
    scope: v.optional(v.union(v.literal("user"), v.literal("org"))),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    password: v.string(),
    automation: v.optional(
      v.object({
        policyImports: v.boolean(),
        requirementImports: v.boolean(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<Id<"connectedEmailAccounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const membership = await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    const scope = args.scope ?? "user";
    if (scope === "org" && membership.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can connect a shared mailbox.",
      );
    }

    const destination = await resolveImapDestination({
      host: args.host,
      port: args.port,
    });
    const encryptedPassword = encryptPassword(args.password);
    await withClient(
      {
        host: destination.normalizedHost,
        port: destination.port,
        secure: args.secure,
        username: args.username.trim(),
        encryptedPassword,
      },
      async (client) => {
        await client.mailboxOpen("INBOX");
        return true;
      },
      destination,
    );

    return await ctx.runMutation(internal.connectedEmail.upsertInternal, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      scope,
      label: args.label?.trim() || undefined,
      emailAddress: args.emailAddress.trim().toLowerCase(),
      host: destination.normalizedHost,
      port: destination.port,
      secure: args.secure,
      username: args.username.trim(),
      encryptedPassword,
      encryptionKeyVersion: "v1",
      automation: args.automation,
    });
  },
});

export const searchInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    accountId: v.optional(v.id("connectedEmailAccounts")),
    mailbox: v.optional(v.string()),
    query: v.optional(v.string()),
    sinceDays: v.optional(v.number()),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<MailboxSearchRow | MailboxSearchErrorRow>> => {
    const account = await accessibleAccount(ctx, args);
    const mailbox = args.mailbox ?? "INBOX";
    const window = searchDateWindow({
      sinceDays: args.sinceDays,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
    });
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);
    const query = args.query?.trim().toLowerCase();

    try {
      return await withClient(account, async (client) => {
        await client.mailboxOpen(mailbox);
        const searchResult = await client.search(
          mailboxSearchQuery({
            since: window.since,
            before: window.before,
            query: args.query,
          }),
          { uid: true },
        );
        const candidateLimit = Math.min(
          SEARCH_MAX_CANDIDATES,
          Math.max(limit * SEARCH_CANDIDATE_MULTIPLIER, limit),
        );
        const uids = Array.isArray(searchResult) ? searchResult.slice(-candidateLimit).reverse() : [];
        const rows: MailboxSearchRow[] = [];
        for (const uid of uids) {
          if (rows.length >= limit) break;
          try {
            const parsed = await fetchParsedMessage(client, mailbox, uid);
            if (isSpotSearchLoopEmail(parsed)) continue;
            const haystack = [
              parsed.subject,
              parsed.from?.text,
              Array.isArray(parsed.to) ? parsed.to.map((item) => item.text).join(", ") : parsed.to?.text,
              Array.isArray(parsed.cc) ? parsed.cc.map((item) => item.text).join(", ") : parsed.cc?.text,
              parsed.text,
            ].filter(Boolean).join("\n").toLowerCase();
            if (query && !haystack.includes(query)) continue;
            rows.push({
              emailRef: messageRef(account._id, mailbox, uid),
              accountId: account._id,
              accountEmail: account.emailAddress,
              accountHost: account.host,
              mailbox,
              uid,
              dateFrom: window.dateFrom,
              dateTo: window.dateTo,
              subject: parsed.subject ?? "(no subject)",
              from: parsed.from?.text,
              to: addressText(parsed.to),
              cc: addressText(parsed.cc),
              date: parsed.date?.toISOString(),
              snippet: (parsed.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
              attachmentCount: parsed.attachments.length,
              attachments: parsed.attachments.map((attachment) => ({
                filename: attachment.filename,
                contentType: attachment.contentType,
                size: attachment.size,
              })),
            });
          } catch (error) {
            console.warn("[connectedEmail.searchInternal] Skipping unreadable message", {
              accountId: account._id,
              accountEmail: account.emailAddress,
              mailbox,
              uid,
              error: imapErrorMessage(error),
            });
          }
        }
        return rows;
      });
    } catch (error) {
      return [mailboxSearchError(account, mailbox, error)];
    }
  },
});

async function readMailboxMessage(
  ctx: ActionCtx,
  args: MailboxReadArgs,
): Promise<MailboxReadRow> {
  const parsedRef = parseMessageRef(args.emailRef);
  const reviewLocator = args.automationItemId
    ? await ctx.runQuery(
        internal.connectedEmailAutomation.getReviewMessageLocatorInternal,
        {
          itemId: args.automationItemId,
          orgId: args.orgId,
          emailRef: args.emailRef,
        },
      )
    : null;
  if (args.automationItemId && !reviewLocator) {
    throw new MailboxMessageUnavailableError("Email review is no longer available.");
  }
  const ref = reviewLocator
    ? {
        accountId: reviewLocator.accountId,
        mailbox: reviewLocator.mailbox,
        uid: reviewLocator.uid,
      }
    : parsedRef;
  const account = await accessibleAccount(ctx, {
    orgId: args.orgId,
    userId: args.userId,
    accountId: ref.accountId,
  });
  return await withClient(account, async (client) => {
    const resolved = await resolveParsedMessage(client, {
      mailbox: ref.mailbox,
      uid: ref.uid,
      messageId: reviewLocator?.sourceMessageId,
      maxBytes: IMPORT_DOWNLOAD_MAX_BYTES,
    });
    const parsed = resolved.parsed;
    return {
      emailRef: messageRef(account._id, resolved.mailbox, resolved.uid),
      accountId: account._id,
      accountEmail: account.emailAddress,
      accountHost: account.host,
      mailbox: resolved.mailbox,
      uid: resolved.uid,
      subject: parsed.subject ?? "(no subject)",
      from: parsed.from?.text,
      fromAddresses: addressDetails(parsed.from),
      to: addressText(parsed.to).join(", "),
      toAddresses: addressDetails(parsed.to),
      cc: addressText(parsed.cc).join(", "),
      ccAddresses: addressDetails(parsed.cc),
      date: parsed.date?.toISOString(),
      text: (parsed.text ?? "").slice(0, 20_000),
      html: typeof parsed.html === "string" ? parsed.html.slice(0, 20_000) : undefined,
      attachments: parsed.attachments.map((attachment, attachmentIndex) => ({
        attachmentIndex,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      })),
    };
  });
}

export const readInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    emailRef: v.string(),
    automationItemId: v.optional(v.id("connectedEmailAutomationItems")),
  },
  handler: readMailboxMessage,
});

export const readEmail = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    automationItemId: v.optional(v.id("connectedEmailAutomationItems")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<MailboxReadRow> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    try {
      return await readMailboxMessage(ctx, {
        ...args,
        userId: userId as Id<"users">,
      });
    } catch (error) {
      if (isMailboxMessageUnavailableError(error)) {
        throw new ConvexError({
          code: "EMAIL_UNAVAILABLE",
          message: error.message,
        });
      }
      throw error;
    }
  },
});

export const deleteAttachmentPreviewInternal = internalAction({
  args: {
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.fileId);
  },
});

export const previewAttachment = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    filename: v.string(),
    attachmentIndex: v.optional(v.number()),
  },
  returns: v.object({
    url: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);

    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: userId as Id<"users">,
      accountId: ref.accountId,
    });
    const attachment = await withClient(account, async (client) => {
      const parsed = await fetchParsedMessage(
        client,
        ref.mailbox,
        ref.uid,
        IMPORT_DOWNLOAD_MAX_BYTES,
      );
      if (args.attachmentIndex !== undefined) {
        if (
          !Number.isInteger(args.attachmentIndex) ||
          args.attachmentIndex < 0
        ) {
          throw new Error("Attachment index is invalid");
        }
        const indexed = parsed.attachments[args.attachmentIndex];
        if (
          indexed?.filename &&
          indexed.filename.trim().toLowerCase() !==
            args.filename.trim().toLowerCase()
        ) {
          throw new Error("Attachment identity no longer matches this email");
        }
        return indexed;
      }

      const requested = args.filename.trim().toLowerCase();
      const matches = parsed.attachments.filter(
        (item) => item.filename?.trim().toLowerCase() === requested,
      );
      if (matches.length > 1) {
        throw new Error("Attachment filename is ambiguous; reopen the email and try again");
      }
      return matches[0];
    });

    if (!attachment) throw new Error("Attachment not found on this email");
    if (!isPdfMailboxAttachment(attachment)) {
      throw new Error("Only PDF attachments can be previewed");
    }
    if (attachment.size > THREAD_ATTACHMENT_MAX_BYTES) {
      throw new Error("This attachment is too large to preview");
    }

    const copy = new Uint8Array(attachment.content.length);
    copy.set(attachment.content);
    const fileId = await ctx.storage.store(
      new Blob([copy], { type: attachment.contentType }),
    );
    const url = await ctx.storage.getUrl(fileId);
    if (!url) {
      await ctx.storage.delete(fileId);
      throw new Error("Could not create an attachment preview");
    }
    await ctx.scheduler.runAfter(
      ATTACHMENT_PREVIEW_TTL_MS,
      internal.actions.connectedEmail.deleteAttachmentPreviewInternal,
      { fileId },
    );

    return {
      url,
      filename: attachment.filename ?? args.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    };
  },
});

export const readAttachmentInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    emailRef: v.string(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client) => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = args.filename.trim().toLowerCase();
      const attachment = parsed.attachments.find(
        (item) => item.filename?.toLowerCase() === requested,
      );
      if (!attachment) throw new Error("Attachment not found on this email");
      const text = await extractAttachmentText(attachment);
      return {
        emailRef: args.emailRef,
        accountId: account._id,
        accountEmail: account.emailAddress,
        accountHost: account.host,
        mailbox: ref.mailbox,
        uid: ref.uid,
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text,
        date: parsed.date?.toISOString(),
        filename: attachment.filename ?? args.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        text: text.replace(/\s+\n/g, "\n").trim().slice(0, 30_000),
        truncated: text.trim().length > 30_000,
      };
    });
  },
});

export const saveAttachmentsToThreadInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<SaveAttachmentsOutcome> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<SaveAttachmentsOutcome> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const requested = new Set((args.filenames ?? []).map((name) => name.toLowerCase()));
      const existingNames = await getExistingThreadAttachmentNames(ctx, {
        threadId: args.threadId,
        orgId: args.orgId,
      });
      const skippedDuplicateFilenames: string[] = [];
      const attachments = parsed.attachments.filter((attachment) => {
        if (attachment.size > THREAD_ATTACHMENT_MAX_BYTES) return false;
        if (requested.size === 0) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      }).filter((attachment) => {
        const filename = attachment.filename ?? "email-attachment";
        const normalized = normalizeThreadAttachmentFilename(filename);
        if (existingNames.has(normalized)) {
          skippedDuplicateFilenames.push(filename);
          return false;
        }
        existingNames.add(normalized);
        return true;
      });
      if (attachments.length === 0) {
        return skippedDuplicateFilenames.length > 0
          ? {
              status: "duplicate_attachments" as const,
              attachments: [],
              skippedDuplicateFilenames: [...new Set(skippedDuplicateFilenames)],
            }
          : { status: "no_saveable_attachments" as const };
      }

      const saved: SavedThreadAttachment[] = [];
      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        saved.push({
          filename: attachment.filename ?? "email-attachment",
          contentType: attachment.contentType,
          size: attachment.size,
          fileId,
        });
      }

      const messageId = await ctx.runMutation(internal.threads.insertAttachmentMessageInternal, {
        threadId: args.threadId,
        orgId: args.orgId,
        content: [
          `Saved ${saved.length} document${saved.length === 1 ? "" : "s"} from connected email for reuse in this thread.`,
          parsed.subject ? `Source email: ${parsed.subject}` : undefined,
        ].filter(Boolean).join("\n"),
        attachments: saved,
      });

      return {
        status: "saved" as const,
        messageId,
        attachments: saved,
        skippedDuplicateFilenames: [...new Set(skippedDuplicateFilenames)],
      };
    });
  },
});

export const saveMessageToThreadInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SaveMessageOutcome> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    return await withClient(account, async (client): Promise<SaveMessageOutcome> => {
      const parsed = await fetchParsedMessage(client, ref.mailbox, ref.uid);
      const exportContent = buildSavedMessageExport({
        subject: parsed.subject ?? "(no subject)",
        from: parsed.from?.text,
        to: addressText(parsed.to).join(", "),
        cc: addressText(parsed.cc).join(", "),
        date: parsed.date,
        text: parsed.text ?? undefined,
        html: parsed.html,
      });
      const size = Buffer.byteLength(exportContent, "utf8");
      if (size > THREAD_ATTACHMENT_MAX_BYTES) {
        return {
          status: "message_too_large" as const,
          message: "The email message export is too large to save to this thread.",
        };
      }

      const filename = safeEmailExportFilename(parsed.subject ?? undefined, args.filename);
      const existingNames = await getExistingThreadAttachmentNames(ctx, {
        threadId: args.threadId,
        orgId: args.orgId,
      });
      if (existingNames.has(normalizeThreadAttachmentFilename(filename))) {
        return {
          status: "duplicate_attachments" as const,
          attachments: [],
          skippedDuplicateFilenames: [filename],
        };
      }

      const saved: SavedThreadAttachment = {
        filename,
        contentType: "message/rfc822",
        size,
        fileId: await ctx.storage.store(new Blob([exportContent], { type: "message/rfc822" })),
      };

      const messageId = await ctx.runMutation(internal.threads.insertAttachmentMessageInternal, {
        threadId: args.threadId,
        orgId: args.orgId,
        content: [
          "Saved 1 document from connected email for reuse in this thread.",
          parsed.subject ? `Source email: ${parsed.subject}` : undefined,
          parsed.from?.text ? `From: ${parsed.from.text}` : undefined,
        ].filter(Boolean).join("\n"),
        attachments: [saved],
      });

      return {
        status: "saved" as const,
        messageId,
        attachment: saved,
        attachments: [saved],
      };
    });
  },
});

export const saveAttachmentsToThread = action({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SaveAttachmentsOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    const outcome: SaveAttachmentsOutcome = await ctx.runAction(
      internal.actions.connectedEmail.saveAttachmentsToThreadInternal,
      {
        orgId: args.orgId,
        userId: userId as Id<"users">,
        threadId: args.threadId,
        emailRef: args.emailRef,
        filenames: args.filenames,
      },
    );
    return outcome;
  },
});

export const importPolicyAttachmentsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<PolicyImportOutcome> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      accountId: ref.accountId,
    });
    // Download and store attachments while connected; extraction runs after the
    // IMAP client is closed so long model calls don't hold the socket open.
    const files = await withClient(account, async (client): Promise<PolicyImportFile[]> => {
      const parsed = await fetchParsedMessage(
        client,
        ref.mailbox,
        ref.uid,
        IMPORT_DOWNLOAD_MAX_BYTES,
      );
      const requested = new Set((args.filenames ?? []).map((name) => name.toLowerCase()));
      const attachments = parsed.attachments.filter((attachment) => {
        if (!isPdfMailboxAttachment(attachment)) return false;
        if (requested.size === 0) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      });
      const stored: PolicyImportFile[] = [];
      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        stored.push({
          fileId,
          fileName: attachment.filename ?? "email-attachment.pdf",
          fileSha256: createHash("sha256").update(attachment.content).digest("hex"),
        });
      }
      return stored;
    });
    if (files.length === 0) return { status: "no_pdf_attachments" as const };

    const result = await ctx.runAction(
      internal.actions.extractFromUpload.extractFromUploadInternal,
      {
        orgId: args.orgId,
        userId: args.userId,
        files,
      },
    );
    const success = "success" in result && result.success === true;
    const duplicate = success && result.duplicate === true;
    if (duplicate || (success && files.length > 1)) {
      await Promise.all(files.map((file) => ctx.storage.delete(file.fileId)));
    }
    return {
      status: duplicate ? "duplicate" : success ? "started" : "failed",
      files,
      result,
    };
  },
});

export const importPolicyAttachments = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<PolicyImportOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    const outcome: PolicyImportOutcome = await ctx.runAction(
      internal.actions.connectedEmail.importPolicyAttachmentsInternal,
      {
        orgId: args.orgId,
        userId: userId as Id<"users">,
        emailRef: args.emailRef,
        filenames: args.filenames,
      },
    );
    return outcome;
  },
});

export const importRequirementAttachmentsInternal = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    mailboxUserId: v.optional(v.id("users")),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
    includeEmailBody: v.optional(v.boolean()),
    sourceName: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
    holder: v.optional(v.object({
      displayName: v.string(),
      email: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<RequirementImportOutcome> => {
    const ref = parseMessageRef(args.emailRef);
    const account = await accessibleAccount(ctx, {
      orgId: args.orgId,
      userId: args.mailboxUserId ?? args.userId,
      accountId: ref.accountId,
    });
    // Download and store requirement sources while connected; the extraction
    // actions run after the IMAP client is closed.
    const sources = await withClient(account, async (client) => {
      const parsed = await fetchParsedMessage(
        client,
        ref.mailbox,
        ref.uid,
        IMPORT_DOWNLOAD_MAX_BYTES,
      );
      const requested = args.filenames === undefined
        ? null
        : new Set(args.filenames.map((name) => name.toLowerCase()));
      const attachments = parsed.attachments.filter((attachment) => {
        if (!isSupportedRequirementAttachment(attachment)) return false;
        if (requested === null) return true;
        return !!attachment.filename && requested.has(attachment.filename.toLowerCase());
      });
      const stored: Array<{
        fileId: Id<"_storage">;
        fileName: string;
        contentType: string;
      }> = [];
      for (const attachment of attachments) {
        const copy = new Uint8Array(attachment.content.length);
        copy.set(attachment.content);
        const blob = new Blob([copy], {
          type: attachment.contentType,
        });
        const fileId = await ctx.storage.store(blob);
        stored.push({
          fileId,
          fileName: attachment.filename ?? "email-requirements",
          contentType: attachment.contentType,
        });
      }
      return {
        stored,
        emailText: args.includeEmailBody ? buildEmailRequirementText(parsed) : "",
        subject: parsed.subject ?? "(no subject)",
        holder: args.holder ?? (args.scope === "own_org" && parsed.from?.value[0]
          ? {
              displayName:
                parsed.from.value[0].name.trim() ||
                parsed.from.value[0].address?.trim() ||
                "Requirement sender",
              email: parsed.from.value[0].address?.trim() || undefined,
            }
          : undefined),
      };
    });
    if (sources.stored.length === 0 && !sources.emailText) {
      return { status: "no_requirement_sources" as const };
    }

    const imports: RequirementImportEntry[] = [];
    if (sources.emailText) {
      const result = await ctx.runAction(
        internal.actions.complianceRequirements.importRequirementsInternal,
        {
          orgId: args.orgId,
          userId: args.userId,
          pastedText: sources.emailText,
          sourceType: args.sourceType,
          sourceName: args.sourceName,
          scope: args.scope,
          holder: sources.holder,
        },
      );
      imports.push({
        source: "email_body" as const,
        subject: sources.subject,
        createdCount: result.createdCount,
        requirementIds: result.requirementIds,
        sourceDocumentId: result.sourceDocumentId,
      });
    }

    for (const file of sources.stored) {
      const result = await ctx.runAction(
        internal.actions.complianceRequirements.importRequirementsInternal,
        {
          orgId: args.orgId,
          userId: args.userId,
          fileId: file.fileId,
          fileName: file.fileName,
          contentType: file.contentType,
          sourceType: args.sourceType,
          sourceName: args.sourceName,
          scope: args.scope,
          holder: sources.holder,
        },
      );
      imports.push({
        source: "attachment" as const,
        fileId: file.fileId,
        fileName: file.fileName,
        createdCount: result.createdCount,
        requirementIds: result.requirementIds,
        sourceDocumentId: result.sourceDocumentId,
      });
    }

    return {
      status: "imported" as const,
      imports,
    };
  },
});

export const importRequirementAttachments = action({
  args: {
    orgId: v.id("organizations"),
    emailRef: v.string(),
    filenames: v.optional(v.array(v.string())),
    includeEmailBody: v.optional(v.boolean()),
    sourceName: v.optional(v.string()),
    sourceType: v.optional(
      v.union(
        v.literal("lease_agreement"),
        v.literal("client_contract"),
        v.literal("vendor_requirements"),
        v.literal("other"),
      ),
    ),
    scope: v.optional(v.union(v.literal("vendors"), v.literal("own_org"))),
    holder: v.optional(v.object({
      displayName: v.string(),
      email: v.optional(v.string()),
    })),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<RequirementImportOutcome> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await requireOrgMember(ctx, args.orgId, userId as Id<"users">);
    const outcome: RequirementImportOutcome = await ctx.runAction(
      internal.actions.connectedEmail.importRequirementAttachmentsInternal,
      {
        orgId: args.orgId,
        userId: userId as Id<"users">,
        emailRef: args.emailRef,
        filenames: args.filenames,
        includeEmailBody: args.includeEmailBody,
        sourceName: args.sourceName,
        sourceType: args.sourceType,
        scope: args.scope,
        holder: args.holder,
      },
    );
    return outcome;
  },
});
