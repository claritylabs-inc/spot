"use node";

import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  searchConnectedEmail,
  readConnectedEmail,
  readConnectedEmailAttachment,
  importConnectedEmailPolicyAttachments,
  importConnectedEmailRequirementAttachments,
  saveConnectedEmailAttachmentsToThread,
  saveConnectedEmailMessageToThread,
  sendConnectedVendorInvite,
} from "./chatTools";
import { canAccessThread } from "./threadAccess";

type MailboxContext = {
  orgId: Id<"organizations">;
  userId: Id<"users">;
  canWrite?: boolean;
  accountIds?: Id<"connectedEmailAccounts">[];
  threadId?: Id<"threads">;
  onToolArtifact?: (artifact: {
    type: string;
    data: unknown;
  }) => void | Promise<void>;
};
type SearchInput = {
  query?: string;
  mailbox?: string;
  sinceDays?: number;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};
type EmailInput = { emailRef: string };
type MailboxRow = Record<string, unknown>;

function rows(value: unknown): MailboxRow[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (row): row is MailboxRow =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}

function emailEvidence(row: MailboxRow): MailboxRow {
  return Object.fromEntries(
    [
      "emailRef",
      "mailbox",
      "accountEmail",
      "subject",
      "from",
      "date",
      "attachmentCount",
      "attachments",
    ]
      .filter((key) => row[key] !== undefined)
      .map((key) => [key, row[key]]),
  );
}

function timestamp(row: MailboxRow): number {
  if (typeof row.date !== "string") return 0;
  const date = dayjs(row.date);
  return date.isValid() ? date.valueOf() : 0;
}

export async function searchAccessibleMailboxes(
  ctx: ActionCtx,
  context: MailboxContext,
  input: SearchInput,
): Promise<{
  results: MailboxRow[];
  searches: MailboxRow[];
  errors: MailboxRow[];
}> {
  const identity = { orgId: context.orgId, userId: context.userId };
  const selected = context.accountIds?.length
    ? await Promise.all(
        context.accountIds.map((accountId) =>
          ctx.runQuery(internal.connectedEmail.getAccessibleInternal, {
            ...identity,
            accountId,
          }),
        ),
      )
    : await ctx.runQuery(
        internal.connectedEmail.listAccessibleInternal,
        identity,
      );
  const accounts = selected.filter((account) => account !== null);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const searchLog = {
    mailbox: input.mailbox ?? "INBOX",
    query: input.query,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  };
  if (!accounts.length) {
    const error = {
      type: "mailbox_search_error",
      mailbox: searchLog.mailbox,
      message: "No connected email account is available",
      hint: "Connect a mailbox in Settings, or select an accessible mailbox before searching.",
    };
    return {
      results: [error],
      searches: [
        { ...searchLog, resultCount: 0, errorCount: 1, identified: [] },
      ],
      errors: [error],
    };
  }
  const batches = await Promise.all(
    accounts.map(async (account) => {
      let accountRows: MailboxRow[];
      try {
        accountRows = rows(
          await ctx.runAction(internal.actions.connectedEmail.searchInternal, {
            ...identity,
            ...input,
            accountId: account._id,
            limit,
          }),
        );
      } catch {
        accountRows = [
          {
            type: "mailbox_search_error",
            accountEmail: account.emailAddress,
            mailbox: searchLog.mailbox,
            message: "Connected mailbox search failed",
          },
        ];
      }
      const errors = accountRows.filter(
        (row) => row.type === "mailbox_search_error",
      );
      const matches = accountRows.filter(
        (row) => typeof row.emailRef === "string",
      );
      return {
        matches,
        errors,
        search: {
          ...searchLog,
          accountEmail: account.emailAddress,
          resultCount: matches.length,
          errorCount: errors.length,
          identified: matches.slice(0, 5).map(emailEvidence),
        },
      };
    }),
  );
  const errors = batches.flatMap((batch) => batch.errors);
  const matches = batches
    .flatMap((batch) => batch.matches)
    .sort((a, b) => timestamp(b) - timestamp(a))
    .slice(0, limit);
  return {
    results: [...matches, ...errors],
    searches: batches.map((batch) => batch.search),
    errors,
  };
}

export function buildMailboxTools(ctx: ActionCtx, context: MailboxContext) {
  const identity = { orgId: context.orgId, userId: context.userId };
  const searches: MailboxRow[] = [];
  const mailboxErrors: MailboxRow[] = [];
  const emails = new Map<string, MailboxRow>();
  const usedRefs = new Set<string>();
  const writeUnavailable = {
    status: "write_unavailable",
    message:
      "You do not have permission to change this organization's mailbox records.",
  };

  const remember = (value: unknown) => {
    for (const row of rows(value)) {
      if (typeof row.emailRef === "string") {
        const previous = emails.get(row.emailRef);
        const attachments = [
          ...new Map(
            [...rows(previous?.attachments), ...rows(row.attachments)]
              .filter((attachment) => typeof attachment.filename === "string")
              .map((attachment) => [attachment.filename, attachment]),
          ).values(),
        ];
        emails.set(row.emailRef, {
          ...previous,
          ...emailEvidence(row),
          ...(attachments.length ? { attachments } : {}),
        });
      }
    }
  };
  const publish = async (): Promise<void> => {
    await context.onToolArtifact?.({
      type: "mailbox_task",
      data: {
        searches: [...searches],
        mailboxErrors: [...mailboxErrors],
        evidence: {
          emails: [...emails]
            .filter(([ref]) => usedRefs.has(ref))
            .map(([, email]) => email),
        },
      },
    });
  };
  const used = async (emailRef: string, result: unknown): Promise<unknown> => {
    usedRefs.add(emailRef);
    remember(rows(result).map((row) => ({ ...row, emailRef })));
    if (!emails.has(emailRef)) emails.set(emailRef, { emailRef });
    await publish();
    return result;
  };
  const targetThread = async (
    requested?: string,
  ): Promise<Id<"threads"> | undefined> => {
    if (context.threadId) return context.threadId;
    if (!requested) return undefined;
    const threadId = requested as Id<"threads">;
    const thread = await ctx.runQuery(internal.threads.getInternal, {
      id: threadId,
    });
    if (
      !thread ||
      !canAccessThread({
        userId: context.userId,
        userOrgId: context.orgId,
        thread,
      })
    ) {
      throw new Error("Thread not found");
    }
    return threadId;
  };

  return {
    search_connected_email: {
      ...searchConnectedEmail,
      execute: async (input: SearchInput): Promise<unknown> => {
        const result = await searchAccessibleMailboxes(ctx, context, input);
        searches.push(...result.searches);
        mailboxErrors.push(...result.errors);
        remember(result.results);
        await publish();
        return result.results;
      },
    },
    read_connected_email: {
      ...readConnectedEmail,
      execute: async (input: EmailInput): Promise<unknown> =>
        used(
          input.emailRef,
          await ctx.runAction(internal.actions.connectedEmail.readInternal, {
            ...identity,
            ...input,
          }),
        ),
    },
    read_connected_email_attachment: {
      ...readConnectedEmailAttachment,
      execute: async (
        input: EmailInput & { filename: string },
      ): Promise<unknown> => {
        const result = await ctx.runAction(
          internal.actions.connectedEmail.readAttachmentInternal,
          { ...identity, ...input },
        );
        for (const row of rows(result)) {
          if (typeof row.filename === "string") {
            remember({
              emailRef: input.emailRef,
              attachments: [
                {
                  filename: row.filename,
                  contentType: row.contentType,
                  size: row.size,
                },
              ],
            });
          }
        }
        return used(input.emailRef, result);
      },
    },
    import_connected_email_policy_attachments: {
      ...importConnectedEmailPolicyAttachments,
      execute: async (
        input: EmailInput & { filenames?: string[] },
      ): Promise<unknown> => {
        if (context.canWrite === false) return writeUnavailable;
        return used(
          input.emailRef,
          await ctx.runAction(
            internal.actions.connectedEmail.importPolicyAttachmentsInternal,
            { ...identity, ...input },
          ),
        );
      },
    },
    import_connected_email_requirement_attachments: {
      ...importConnectedEmailRequirementAttachments,
      execute: async (
        input: EmailInput & {
          filenames?: string[];
          includeEmailBody?: boolean;
          sourceType?:
            | "lease_agreement"
            | "client_contract"
            | "vendor_requirements"
            | "other";
          scope?: "vendors" | "own_org";
        },
      ): Promise<unknown> => {
        if (context.canWrite === false) return writeUnavailable;
        return used(
          input.emailRef,
          await ctx.runAction(
            internal.actions.connectedEmail
              .importRequirementAttachmentsInternal,
            { ...identity, ...input },
          ),
        );
      },
    },
    save_connected_email_attachments_to_thread: {
      ...saveConnectedEmailAttachmentsToThread,
      execute: async (
        input: EmailInput & { filenames?: string[]; threadId?: string },
      ): Promise<unknown> => {
        if (context.canWrite === false) return writeUnavailable;
        const threadId = await targetThread(input.threadId);
        if (!threadId)
          return {
            status: "thread_unavailable",
            message: "Provide an accessible Spot thread to save attachments.",
          };
        return used(
          input.emailRef,
          await ctx.runAction(
            internal.actions.connectedEmail.saveAttachmentsToThreadInternal,
            { ...identity, ...input, threadId },
          ),
        );
      },
    },
    save_connected_email_message_to_thread: {
      ...saveConnectedEmailMessageToThread,
      execute: async (
        input: EmailInput & { filename?: string; threadId?: string },
      ): Promise<unknown> => {
        if (context.canWrite === false) return writeUnavailable;
        const threadId = await targetThread(input.threadId);
        if (!threadId)
          return {
            status: "thread_unavailable",
            message: "Provide an accessible Spot thread to save the email.",
          };
        return used(
          input.emailRef,
          await ctx.runAction(
            internal.actions.connectedEmail.saveMessageToThreadInternal,
            { ...identity, ...input, threadId },
          ),
        );
      },
    },
    send_connected_vendor_invite: {
      ...sendConnectedVendorInvite,
      execute: async (input: {
        vendorEmail: string;
        relationshipLabel?: string;
        note?: string;
      }): Promise<unknown> => {
        if (context.canWrite === false) return writeUnavailable;
        return ctx.runAction(
          internal.connectedOrgs.requestVendorAccessByEmailInternal,
          {
            clientOrgId: context.orgId,
            requestedByUserId: context.userId,
            ...input,
          },
        );
      },
    },
  };
}
