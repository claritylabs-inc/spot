import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getPublicAgentDomain } from "@/lib/domains";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { webMcpError } from "@/lib/webmcp/runtime";
import {
  bool,
  compact,
  id,
  isoTime,
  num,
  requiredText,
  stringList,
  text,
  uploadBase64File,
  type ClientToolContext,
  type ToolInput,
  type ToolMap,
} from "@/components/webmcp/tools/helpers";

const AGENT_DOMAIN = getPublicAgentDomain();

type PendingEmail = {
  _id: string;
  status: string;
  recipientEmail?: string;
  ccAddresses?: string[];
  bccAddresses?: string[];
  subject?: string;
  emailBody?: string;
  attachments?: Array<{ filename: string; contentType?: string; size?: number }>;
  sentAt?: number;
};

function emailDraftResult(email: PendingEmail) {
  return {
    draft_id: email._id,
    status: email.status,
    to: email.recipientEmail ?? null,
    cc: email.ccAddresses ?? [],
    bcc: email.bccAddresses ?? [],
    subject: email.subject ?? null,
    body: email.emailBody ?? null,
    attachments: (email.attachments ?? []).map((attachment) => ({
      file_name: attachment.filename,
      content_type: attachment.contentType ?? null,
      size: attachment.size ?? null,
    })),
  };
}

type ThreadRow = {
  _id: string;
  title?: string;
  displayTitle?: string;
  channel?: string;
  archived?: boolean;
  lastMessageAt?: number;
  _creationTime: number;
};

export function threadRow(thread: ThreadRow) {
  return {
    thread_id: thread._id,
    title: thread.displayTitle ?? thread.title ?? null,
    channel: thread.channel ?? null,
    last_message_at: isoTime(thread.lastMessageAt ?? thread._creationTime),
    url: `/agent/thread/${thread._id}`,
  };
}

export function agentToolImplementations(ctx: ClientToolContext): ToolMap {
  const { convex, orgId } = ctx;

  async function sendMessage(threadId: Id<"threads">, input: ToolInput) {
    const files = Array.isArray(input.attachments) ? (input.attachments as ToolInput[]) : [];
    const attachments = [];
    for (const file of files) {
      const uploaded = await uploadBase64File(file, () =>
        convex.mutation(api.threads.generateUploadUrl, {}),
      );
      attachments.push({
        filename: uploaded.fileName,
        contentType: uploaded.contentType,
        size: uploaded.size,
        fileId: uploaded.storageId,
      });
    }
    return await convex.mutation(
      api.threads.sendMessage,
      compact({
        threadId,
        content: requiredText(input, "message"),
        attachments: attachments.length > 0 ? attachments : undefined,
        referencedPolicyIds: stringList(input, "policy_ids") as Id<"policies">[] | undefined,
        referencedRequirementIds: stringList(input, "requirement_ids") as
          | Id<"insuranceRequirements">[]
          | undefined,
        referencedMailboxIds: stringList(input, "mailbox_ids") as
          | Id<"connectedEmailAccounts">[]
          | undefined,
        clientMutationId: createClientMutationId("message"),
      }),
    );
  }

  return {
    start_spot_agent_thread: async (input) => {
      const threadId = await convex.mutation(api.threads.create, {
        agentDomain: AGENT_DOMAIN,
        clientMutationId: createClientMutationId("thread"),
      });
      await sendMessage(threadId, input);
      const url = `/agent/thread/${threadId}`;
      ctx.router.push(url);
      return {
        status: "started",
        thread_id: threadId,
        url,
        message: "The Spot agent is replying. Read it with get_agent_thread once it finishes.",
      };
    },
    list_agent_threads: async (input) => {
      const threads = await convex.query(api.threads.list, { archived: bool(input, "archived") });
      return { status: "ok", threads: threads.map(threadRow) };
    },
    get_agent_thread: async (input) => {
      const threadId = id<"threads">(input, "thread_id");
      const [thread, messages, review] = await Promise.all([
        convex.query(api.threads.get, { id: threadId }),
        convex.query(api.threads.messages, { threadId }),
        convex.query(api.connectedEmailAutomation.reviewForThread, { threadId }),
      ]);
      if (!thread) return webMcpError("Thread not found or not accessible.");
      return {
        status: "ok",
        thread: { ...threadRow(thread), archived: Boolean(thread.archivedAt) },
        messages: messages.map((message) => ({
          message_id: message._id,
          role: message.role,
          status: message.status ?? null,
          author: message.userName ?? message.fromName ?? null,
          content: message.content,
          created_at: isoTime(message._creationTime),
          attachments: (message.attachments ?? []).map((attachment) => ({
            file_id: attachment.fileId ?? null,
            file_name: attachment.filename,
            content_type: attachment.contentType,
          })),
          pending_email_id: message.pendingEmailId ?? null,
          tools_used: message.usedTools ?? [],
        })),
        mailbox_review: review ?? null,
      };
    },
    send_thread_message: async (input) => {
      const messageId = await sendMessage(id<"threads">(input, "thread_id"), input);
      return {
        status: "sent",
        message_id: messageId,
        message: "The Spot agent is replying. Read it with get_agent_thread.",
      };
    },
    list_agent_reference_targets: async () => {
      const targets = await convex.query(api.agentTargets.list, { orgId });
      return { status: "ok", ...targets };
    },
    rename_thread: async (input) => {
      await convex.mutation(api.threads.updateTitle, {
        id: id<"threads">(input, "thread_id"),
        title: requiredText(input, "title"),
      });
      return { status: "renamed" };
    },
    archive_thread: async (input) => {
      await convex.mutation(api.threads.archive, { id: id<"threads">(input, "thread_id") });
      return { status: "archived" };
    },
    unarchive_thread: async (input) => {
      await convex.mutation(api.threads.unarchive, { id: id<"threads">(input, "thread_id") });
      return { status: "active" };
    },
    stop_agent_response: async (input) => {
      await convex.mutation(api.threads.cancelProcessing, {
        messageId: id<"threadMessages">(input, "message_id"),
      });
      return { status: "stopped" };
    },
    retry_agent_response: async (input) => {
      await convex.mutation(api.threads.retryAgentResponse, {
        messageId: id<"threadMessages">(input, "message_id"),
      });
      return { status: "retrying" };
    },
    rate_agent_response: async (input) => {
      const result = await convex.action(
        api.actions.agentResponseFeedback.submit,
        compact({
          messageId: id<"threadMessages">(input, "message_id"),
          rating: requiredText(input, "rating") as "positive" | "negative",
          comment: text(input, "comment"),
        }),
      );
      return { status: "recorded", rating: result.rating };
    },
    get_thread_attachment_urls: async (input) => {
      const fileIds = stringList(input, "file_ids");
      if (!fileIds) return webMcpError("file_ids is required.");
      const urls = await convex.query(api.threads.getAttachmentUrls, {
        threadId: id<"threads">(input, "thread_id"),
        fileIds: fileIds as Id<"_storage">[],
      });
      return {
        status: "ok",
        files: urls.map((entry) => ({ file_id: entry.fileId, url: entry.url })),
      };
    },
    get_email_draft: async (input) => {
      const email = await convex.query(api.pendingEmails.get, {
        id: id<"pendingEmails">(input, "draft_id"),
      });
      return email ? { status: "ok", email: emailDraftResult(email) } : webMcpError("Email not found.");
    },
    send_email_draft: async (input) => {
      const result = await convex.action(api.actions.sendPendingEmail.sendDraftNow, {
        id: id<"pendingEmails">(input, "draft_id"),
      });
      return { status: "sent", recipient: result.recipientEmail };
    },
    send_email_drafts: async (input) => {
      const ids = stringList(input, "draft_ids");
      if (!ids) return webMcpError("draft_ids is required.");
      const result = await convex.action(api.actions.sendPendingEmail.sendDraftsNow, {
        ids: ids as Id<"pendingEmails">[],
      });
      return {
        status: result.failed.length === 0 ? "sent" : result.sent.length > 0 ? "partial" : "failed",
        sent: result.sent.map((entry) => ({ draft_id: entry.id, recipient: entry.recipientEmail })),
        failed: result.failed.map((entry) => ({ draft_id: entry.id, error: entry.error })),
      };
    },
    cancel_email_draft: async (input) => {
      await convex.mutation(api.pendingEmails.cancel, { id: id<"pendingEmails">(input, "draft_id") });
      return { status: "cancelled" };
    },
    restore_email_draft: async (input) => {
      await convex.mutation(api.pendingEmails.restoreAsDraft, {
        id: id<"pendingEmails">(input, "draft_id"),
      });
      return { status: "draft" };
    },
    get_mailbox_email: async (input) => ({
      status: "ok",
      email: await convex.action(api.actions.connectedEmail.readEmail, {
        orgId,
        emailRef: requiredText(input, "email_ref"),
      }),
    }),
    get_mailbox_attachment_url: async (input) => {
      const result = await convex.action(
        api.actions.connectedEmail.previewAttachment,
        compact({
          orgId,
          emailRef: requiredText(input, "email_ref"),
          filename: requiredText(input, "filename"),
          attachmentIndex: num(input, "attachment_index"),
        }),
      );
      return {
        status: "ok",
        url: result.url,
        file_name: result.filename,
        content_type: result.contentType,
        size: result.size,
      };
    },
    import_mailbox_policy_attachments: async (input) => ({
      status: "ok",
      result: await convex.action(
        api.actions.connectedEmail.importPolicyAttachments,
        compact({
          orgId,
          emailRef: requiredText(input, "email_ref"),
          filenames: stringList(input, "filenames"),
        }),
      ),
    }),
    import_mailbox_requirement_attachments: async (input) => {
      const holderName = text(input, "holder_name");
      return {
        status: "ok",
        result: await convex.action(
          api.actions.connectedEmail.importRequirementAttachments,
          compact({
            orgId,
            emailRef: requiredText(input, "email_ref"),
            filenames: stringList(input, "filenames"),
            includeEmailBody: bool(input, "include_email_body"),
            sourceName: text(input, "source_name"),
            sourceType: text(input, "source_type") as
              | "lease_agreement"
              | "client_contract"
              | "vendor_requirements"
              | "other"
              | undefined,
            scope: text(input, "scope") as "vendors" | "own_org" | undefined,
            holder: holderName
              ? compact({ displayName: holderName, email: text(input, "holder_email") })
              : undefined,
          }),
        ),
      };
    },
    save_mailbox_attachments_to_thread: async (input) => ({
      status: "ok",
      result: await convex.action(
        api.actions.connectedEmail.saveAttachmentsToThread,
        compact({
          orgId,
          threadId: id<"threads">(input, "thread_id"),
          emailRef: requiredText(input, "email_ref"),
          filenames: stringList(input, "filenames"),
        }),
      ),
    }),
    resolve_mailbox_review: async (input) => ({
      status: "resolved",
      result: await convex.mutation(api.connectedEmailAutomation.resolveReview, {
        threadId: id<"threads">(input, "thread_id"),
        emailRef: requiredText(input, "email_ref"),
        resolution: requiredText(input, "resolution") as
          | "not_relevant"
          | "policy_imported"
          | "requirements_imported",
      }),
    }),
  };
}
