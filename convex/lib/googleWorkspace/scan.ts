"use node";

import dayjs from "dayjs";
import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceScanCandidate,
  type OperatorGoogleWorkspaceScanMailboxInput,
  type OperatorGoogleWorkspaceScanMailboxResult,
  type OperatorGoogleWorkspaceThreadAttachment,
} from "../googleWorkspace";
import {
  sanitizeGoogleWorkspaceError,
  type GoogleWorkspaceMessage,
} from "../googleWorkspaceProvider";
import {
  assertScanCursorState,
  decodeCursor,
  encodeCursor,
  hashJson,
  type ScanCursorState,
} from "./cursors";
import { resolveMailbox } from "./mailboxes";
import {
  allParts,
  attachmentMetadata,
  isAttachmentPart,
  messageHeaders,
} from "./messages";
import {
  DAY_MS,
  TOOL_WORK_BUDGET_MS,
  type GoogleWorkspaceToolDependencies,
} from "./shared";

function scanDate(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayjs(`${value}T00:00:00Z`).valueOf()
    : Number.NaN;
  if (
    !Number.isFinite(time) ||
    dayjs(time).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} must be a YYYY-MM-DD date.`);
  }
  return time;
}

function scanRange(input: OperatorGoogleWorkspaceScanMailboxInput) {
  const maxDays = GOOGLE_WORKSPACE_LIMITS.maxScanDays;
  const today = Math.floor(dayjs().valueOf() / DAY_MS) * DAY_MS;
  const to = scanDate(input.dateTo, "Scan end date");
  const from = scanDate(input.dateFrom, "Scan start date");
  const end =
    to ??
    (from === undefined
      ? today
      : Math.min(today, from + (maxDays - 1) * DAY_MS));
  const start = from ?? end - (maxDays - 1) * DAY_MS;
  if (start > end) {
    throw new Error("Scan start date must be on or before its end date.");
  }
  if ((end - start) / DAY_MS + 1 > maxDays) {
    throw new Error(`Scan at most ${maxDays} days at a time.`);
  }
  return { start, end };
}

function isPdfAttachment(attachment: OperatorGoogleWorkspaceThreadAttachment) {
  return (
    attachment.contentType.toLowerCase() === "application/pdf" ||
    attachment.filename.toLowerCase().endsWith(".pdf")
  );
}

async function scanCandidate(
  mailbox: string,
  message: GoogleWorkspaceMessage,
): Promise<OperatorGoogleWorkspaceScanCandidate> {
  const headers = await messageHeaders(message);
  const attachments = allParts(message)
    .filter(
      ({ part }) =>
        isAttachmentPart(part) &&
        (part.body.attachmentId || part.body.data !== null),
    )
    .map(attachmentMetadata)
    .filter((attachment) => !attachment.inline);
  return {
    messageId: message.id,
    threadId: message.threadId,
    subject: headers.value("Subject"),
    from: headers.value("From"),
    date: headers.value("Date") ?? message.internalDate,
    snippet: message.snippet,
    attachments: attachments.map((attachment) => ({
      ...attachment,
      suggestedActions: [
        {
          tool: "get_company_email_attachment",
          input: {
            mailbox,
            messageId: message.id,
            attachmentId: attachment.attachmentId,
          },
          reason: "Retrieve the original file and its readable content.",
        },
        ...(isPdfAttachment(attachment)
          ? [
              {
                tool: "import_policy_files" as const,
                reason:
                  "If the retrieved PDF is a bound policy for a resolved client, import it with exact confirmation. Quotes belong in procurement.",
              },
            ]
          : []),
      ],
    })),
    suggestedActions: [
      {
        tool: "read_company_email_thread",
        input: { mailbox, threadId: message.threadId },
        reason: "Read the conversation to confirm current facts.",
      },
    ],
  };
}

/** Bounded, read-only scan of one mailbox; follow-up writes use their own confirmed tools. */
export async function scanWorkspaceMailbox(
  dependencies: GoogleWorkspaceToolDependencies,
  input: OperatorGoogleWorkspaceScanMailboxInput,
): Promise<OperatorGoogleWorkspaceScanMailboxResult> {
  const { config, provider } = dependencies;
  const terms = input.query.trim();
  if (!terms || terms.length > GOOGLE_WORKSPACE_LIMITS.maxScanQueryChars) {
    throw new Error(
      `Mailbox scan query must be 1 to ${GOOGLE_WORKSPACE_LIMITS.maxScanQueryChars} characters.`,
    );
  }
  const limit = input.limit ?? GOOGLE_WORKSPACE_LIMITS.defaultScanCandidates;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > GOOGLE_WORKSPACE_LIMITS.maxScanCandidates
  ) {
    throw new Error(
      `Mailbox scan limit must be between 1 and ${GOOGLE_WORKSPACE_LIMITS.maxScanCandidates}.`,
    );
  }
  const requested = input.mailbox ?? dependencies.operatorMailbox;
  if (!requested) throw new Error("Choose a company mailbox to scan.");
  const requestFingerprint = hashJson({
    terms,
    requested,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    limit,
  });
  const state = decodeCursor<ScanCursorState>(
    dependencies.cursorSecret,
    input.cursor,
    {
      tool: "scan_workspace_mailbox",
      configUpdatedAt: config.updatedAt,
      requestFingerprint,
    },
    {},
  );
  assertScanCursorState(state);
  const { start, end } =
    state.start !== undefined && state.end !== undefined
      ? { start: state.start, end: state.end }
      : scanRange(input);
  const mailbox = await resolveMailbox(provider, config, requested);
  const query = `(${terms}) -in:drafts after:${start / 1000} before:${(end + DAY_MS) / 1000}`;
  const page = await provider.listMessages({
    mailbox,
    query,
    pageToken: state.pageToken,
    maxResults: limit,
  });
  const deadline = dayjs().valueOf() + TOOL_WORK_BUDGET_MS;
  const candidates: OperatorGoogleWorkspaceScanCandidate[] = [];
  const errors: OperatorGoogleWorkspaceScanMailboxResult["errors"] = [];
  for (
    let offset = 0;
    offset < Math.min(page.messages.length, limit);
    offset += 5
  ) {
    const references = page.messages.slice(offset, Math.min(offset + 5, limit));
    const batch = await Promise.all(
      references.map(async (reference) => {
        if (dayjs().valueOf() >= deadline) {
          errors.push({
            messageId: reference.id,
            error: "Scan time budget reached. Narrow the query or date range.",
          });
          return null;
        }
        try {
          const message = await provider.getMessageFull({
            mailbox,
            messageId: reference.id,
          });
          const receivedAt = Number(message.internalDate);
          if (
            message.id !== reference.id ||
            message.threadId !== reference.threadId ||
            !Number.isFinite(receivedAt) ||
            receivedAt < start ||
            receivedAt >= end + DAY_MS ||
            message.labelIds?.some((label) =>
              ["DRAFT", "SPAM", "TRASH"].includes(label),
            )
          ) {
            errors.push({
              messageId: reference.id,
              error: "Message is outside the eligible scan window.",
            });
            return null;
          }
          return await scanCandidate(mailbox, message);
        } catch (error) {
          errors.push({
            messageId: reference.id,
            error: sanitizeGoogleWorkspaceError(error),
          });
          return null;
        }
      }),
    );
    candidates.push(...batch.filter((candidate) => candidate !== null));
  }
  return {
    mailbox,
    query,
    dateFrom: dayjs(start).toISOString().slice(0, 10),
    dateTo: dayjs(end).toISOString().slice(0, 10),
    candidates,
    errors,
    hasMoreMatches: Boolean(page.nextPageToken) || page.messages.length > limit,
    nextCursor: page.nextPageToken
      ? encodeCursor(
          dependencies.cursorSecret,
          "scan_workspace_mailbox",
          config.updatedAt,
          requestFingerprint,
          { start, end, pageToken: page.nextPageToken } satisfies ScanCursorState,
        )
      : null,
    completeness:
      page.nextPageToken || page.messages.length > limit || errors.length
        ? "partial"
        : "complete",
  };
}
