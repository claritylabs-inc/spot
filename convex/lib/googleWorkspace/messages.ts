"use node";

import { convert } from "html-to-text";
import { simpleParser } from "mailparser";
import dayjs from "dayjs";
import {
  normalizeAgentAttachmentFilename,
  normalizeAgentAttachmentContentType,
} from "../agentAttachmentLimits";
import type { Id } from "../../_generated/dataModel";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceAttachmentSource,
  type OperatorGoogleWorkspaceGetAttachmentInput,
  type OperatorGoogleWorkspaceGetAttachmentResult,
  type OperatorGoogleWorkspaceReadThreadInput,
  type OperatorGoogleWorkspaceReadThreadResult,
  type OperatorGoogleWorkspaceReadThreadsInput,
  type OperatorGoogleWorkspaceReadThreadsResult,
  type OperatorGoogleWorkspaceThreadAttachment,
  type OperatorGoogleWorkspaceThreadMessage,
} from "../googleWorkspace";
import { NoWriteInputError } from "../noWriteInputError";
import {
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceMessage,
  type GoogleWorkspaceMessagePart,
  type GoogleWorkspaceProvider,
} from "../googleWorkspaceProvider";
import {
  assertThreadCursorState,
  decodeCursor,
  encodeCursor,
  hashJson,
  pageSize,
  type ThreadCursorState,
} from "./cursors";
import { resolveMailbox } from "./mailboxes";
import {
  TOOL_WORK_BUDGET_MS,
  type GoogleWorkspaceToolDependencies,
  type StoredAttachment,
} from "./shared";

const MAX_THREAD_BODY_CHARS_PER_PAGE = 80_000;
// Keeps ten threads under the 512 KiB tool-result cap; a thread cut short
// reports `truncated` and is read alone for the rest.
const BULK_THREAD_BODY_CHARS_BUDGET = 300_000;
const MAX_EXTERNAL_BODY_PART_BYTES = 2 * 1024 * 1024;

export async function messageHeaders(message: GoogleWorkspaceMessage) {
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

function mimePartId(part: GoogleWorkspaceMessagePart, path: number[]) {
  return part.partId || path.join(".") || "0";
}

export function allParts(message: GoogleWorkspaceMessage) {
  const values: LocatedPart[] = [];
  const visit = (part: GoogleWorkspaceMessagePart, path: number[]) => {
    const stablePartId = mimePartId(part, path);
    values.push({ part, stablePartId });
    part.parts.forEach((child, index) => visit(child, [...path, index]));
  };
  if (message.payload) visit(message.payload, []);
  return values;
}

export function isAttachmentPart(part: GoogleWorkspaceMessagePart) {
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

export function attachmentMetadata(
  located: LocatedPart,
): OperatorGoogleWorkspaceThreadAttachment {
  const { part, stablePartId } = located;
  return {
    attachmentId: `part:${stablePartId}`,
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
  const visit = async (part: GoogleWorkspaceMessagePart, path: number[]) => {
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
          partId: mimePartId(part, path),
          attachmentId: `part:${mimePartId(part, path)}`,
          reason,
        });
    }
    for (const [index, child] of part.parts.entries())
      await visit(child, [...path, index]);
  };
  if (message.payload) await visit(message.payload, []);
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
  options: { maxBodyChars?: number } = {},
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
  const maxBodyChars = options.maxBodyChars ?? MAX_THREAD_BODY_CHARS_PER_PAGE;
  let remainingChars = maxBodyChars;
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
    maxBodyCharsPerPage: maxBodyChars,
  };
}

/** Reads up to ten exact threads; failures never fail the batch. */
export async function readCompanyEmailThreads(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceReadThreadsInput,
): Promise<OperatorGoogleWorkspaceReadThreadsResult> {
  const maxBodyChars = Math.max(
    10_000,
    Math.floor(BULK_THREAD_BODY_CHARS_BUDGET / input.threads.length),
  );
  const result: OperatorGoogleWorkspaceReadThreadsResult = {
    threads: [],
    notFound: [],
    errors: [],
    completeness: "complete",
  };
  type Outcome =
    | { kind: "thread"; thread: OperatorGoogleWorkspaceReadThreadsResult["threads"][number] }
    | { kind: "notFound"; reference: { mailbox: string; threadId: string } }
    | { kind: "error"; reference: { mailbox: string; threadId: string }; error: string };
  for (let offset = 0; offset < input.threads.length; offset += 3) {
    const batch = await Promise.all(
      input.threads.slice(offset, offset + 3).map(async (reference): Promise<Outcome> => {
        try {
          const { nextCursor, ...page } = await readCompanyEmailThread(
            dependencies,
            { ...reference, limit: input.limit },
            { maxBodyChars },
          );
          return { kind: "thread", thread: { ...page, truncated: nextCursor !== null } };
        } catch (error) {
          const message = sanitizeGoogleWorkspaceError(error);
          return /was not found/.test(message)
            ? { kind: "notFound", reference }
            : { kind: "error", reference, error: message };
        }
      }),
    );
    for (const outcome of batch) {
      if (outcome.kind === "thread") result.threads.push(outcome.thread);
      else if (outcome.kind === "notFound") result.notFound.push(outcome.reference);
      else result.errors.push({ ...outcome.reference, error: outcome.error });
    }
  }
  if (
    result.errors.length ||
    result.threads.some(
      (thread) => thread.truncated || thread.completeness === "partial",
    )
  ) {
    result.completeness = "partial";
  }
  return result;
}

function locatedAttachment(
  message: GoogleWorkspaceMessage,
  attachmentId: string,
) {
  const parts = allParts(message).filter(({ part }) => isAttachmentPart(part));
  if (attachmentId.startsWith("part:")) {
    const stablePartId = attachmentId.slice("part:".length);
    const matches = parts.filter(
      (located) => located.stablePartId === stablePartId,
    );
    const located = matches.length === 1 ? matches[0] : undefined;
    return located &&
      (located.part.body.attachmentId || located.part.body.data !== null)
      ? located
      : undefined;
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
    throw new NoWriteInputError(
      "invalid_attachment_reference",
      "Gmail attachment identity is invalid. Read the email thread again and use its exact messageId and attachmentId.",
    );
  const message = await provider.getMessageFull({ mailbox, messageId });
  if (message.id !== messageId)
    throw new NoWriteInputError(
      "source_changed",
      "Gmail message identity changed. Read the thread again before retrieving the attachment.",
    );
  const located = locatedAttachment(message, attachmentId);
  if (!located)
    throw new NoWriteInputError(
      "invalid_attachment_reference",
      "Attachment is not part of the requested Gmail message. Read the thread again and use its exact messageId and attachmentId.",
    );
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
    throw new NoWriteInputError(
      "source_unavailable",
      "Gmail attachment content is unavailable. Read the thread again to refresh the source.",
    );
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
