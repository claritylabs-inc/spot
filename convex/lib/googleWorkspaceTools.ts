"use node";

import {
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceToolName,
} from "./googleWorkspace";
import {
  getCompanyEmailAttachment,
  readCompanyEmailThread,
  readCompanyEmailThreads,
} from "./googleWorkspace/messages";
import { listCompanyMailboxes } from "./googleWorkspace/mailboxes";
import { scanWorkspaceMailbox } from "./googleWorkspace/scan";
import { searchCompanyEmail } from "./googleWorkspace/search";
import type { GoogleWorkspaceToolDependencies } from "./googleWorkspace/shared";

export type { GoogleWorkspaceToolDependencies };
export {
  getCompanyEmailAttachment,
  listCompanyMailboxes,
  readCompanyEmailThread,
  readCompanyEmailThreads,
  scanWorkspaceMailbox,
  searchCompanyEmail,
};
export { messageBody } from "./googleWorkspace/messages";

const MAX_BULK_THREADS = 10;

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

function optionalString(value: unknown, label: string) {
  return value === undefined ? undefined : requiredString(value, label);
}

function optionalParticipants(value: unknown) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error("Search participants are invalid.");
  }
  return value as string[];
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
        query: optionalString(input.query, "Gmail search query") ?? "",
        mailboxes,
        participants: optionalParticipants(input.participants),
        since: optionalString(input.since, "Search start date"),
        until: optionalString(input.until, "Search end date"),
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
  if (toolName === "read_company_email_threads") {
    if (
      !Array.isArray(input.threads) ||
      input.threads.length < 1 ||
      input.threads.length > MAX_BULK_THREADS
    ) {
      throw new Error(
        `Provide 1 to ${MAX_BULK_THREADS} Gmail threads to read.`,
      );
    }
    return {
      toolName: "read_company_email_threads" as const,
      input: {
        threads: input.threads.map((thread) => {
          const reference = inputRecord(thread);
          return {
            mailbox: requiredString(reference.mailbox, "Company mailbox"),
            threadId: requiredString(reference.threadId, "Gmail thread ID"),
          };
        }),
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
  if (toolName === "scan_workspace_mailbox") {
    return {
      toolName: "scan_workspace_mailbox" as const,
      input: {
        mailbox: optionalString(input.mailbox, "Company mailbox"),
        query: requiredString(input.query, "Gmail search query"),
        dateFrom: optionalString(input.dateFrom, "Scan start date"),
        dateTo: optionalString(input.dateTo, "Scan end date"),
        limit: optionalLimit(input.limit),
        cursor: optionalCursor(input.cursor),
      },
    };
  }
  throw new Error(`Unsupported Google Workspace tool: ${String(toolName)}`);
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
    case "read_company_email_threads":
      return {
        result: await readCompanyEmailThreads(dependencies, parsed.input),
      };
    case "get_company_email_attachment": {
      const output = await getCompanyEmailAttachment(
        dependencies,
        parsed.input,
      );
      return { result: output.result, attachments: [output.attachment] };
    }
    case "scan_workspace_mailbox":
      return { result: await scanWorkspaceMailbox(dependencies, parsed.input) };
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
