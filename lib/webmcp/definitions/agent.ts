import { fileParams, imperative, param, schema } from "@/lib/webmcp/types";

const AGENT_PAGES = ["/agent"];
const threadId = param.string("Thread ID from list_agent_threads or start_spot_agent_thread.");
const messageId = param.string("Agent message ID from get_agent_thread.");
const draftId = param.string("Email draft ID (pending_email_id on a get_agent_thread message).");
const emailRef = param.string("Mailbox email reference from the thread's mailbox review items.");

/** Agent conversations, drafted emails, and mailbox review items. */
export const agentTools = {
  get_agent_thread: imperative({
    title: "Get agent thread",
    description:
      "Read one Spot agent conversation: every message with role, status, attachments, and linked email draft (pending_email_id), plus pending mailbox review items.",
    readOnly: true,
    untrustedContent: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ thread_id: threadId }, ["thread_id"]),
  }),
  send_thread_message: imperative({
    title: "Send thread message",
    description:
      "Send a message (optionally with file attachments or policy, requirement, and mailbox references) in an existing agent thread. The Spot agent replies in the thread and may draft emails, generate certificates, or run other client tools.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema(
      {
        thread_id: threadId,
        message: param.string("Message text."),
        attachments: param.array(
          "Optional files to attach.",
          param.object("File.", fileParams, ["file_name", "content_type", "content_base64"]),
        ),
        policy_ids: param.stringArray("Optional policies to reference."),
        requirement_ids: param.stringArray("Optional requirements to reference."),
        mailbox_ids: param.stringArray("Optional connected mailboxes to reference."),
      },
      ["thread_id", "message"],
    ),
  }),
  list_agent_reference_targets: imperative({
    title: "List agent reference targets",
    description:
      "List the policies, requirements, and connected mailboxes that can be referenced in send_thread_message.",
    readOnly: true,
    pages: AGENT_PAGES,
    inputSchema: schema(),
  }),
  rename_thread: imperative({
    title: "Rename thread",
    description: "Rename an agent thread.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ thread_id: threadId, title: param.string("New title.") }, ["thread_id", "title"]),
  }),
  archive_thread: imperative({
    title: "Archive thread",
    description: "Archive an agent thread. Restore with unarchive_thread.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ thread_id: threadId }, ["thread_id"]),
  }),
  unarchive_thread: imperative({
    title: "Unarchive thread",
    description: "Restore an archived agent thread.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ thread_id: threadId }, ["thread_id"]),
  }),
  stop_agent_response: imperative({
    title: "Stop agent response",
    description: "Stop an in-progress agent reply.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ message_id: messageId }, ["message_id"]),
  }),
  retry_agent_response: imperative({
    title: "Retry agent response",
    description: "Delete an agent reply and generate it again.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ message_id: messageId }, ["message_id"]),
  }),
  get_thread_attachment_urls: imperative({
    title: "Get thread attachment links",
    description: "Get temporary download links for files attached to messages in a thread.",
    readOnly: true,
    pages: AGENT_PAGES,
    inputSchema: schema(
      { thread_id: threadId, file_ids: param.stringArray("Attachment file IDs from get_agent_thread.") },
      ["thread_id", "file_ids"],
    ),
  }),
  get_email_draft: imperative({
    title: "Get email draft",
    description:
      "Read an agent-drafted or scheduled email: recipients, subject, body, attachments, and status (draft, pending, sent, cancelled).",
    readOnly: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ draft_id: draftId }, ["draft_id"]),
  }),
  send_email_draft: imperative({
    title: "Send email draft",
    description:
      "Send an agent-drafted email now, exactly as drafted, to its recipients (for example a broker, insurer, vendor, or certificate holder). Sending cannot be undone.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ draft_id: draftId }, ["draft_id"]),
  }),
  send_email_drafts: imperative({
    title: "Send email drafts",
    description: "Send several agent-drafted emails at once. Reports which were sent and which failed.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ draft_ids: param.stringArray("Email draft IDs.") }, ["draft_ids"]),
  }),
  cancel_email_draft: imperative({
    title: "Cancel email",
    description:
      "Cancel an email draft, or stop a scheduled send during its countdown. Restore it with restore_email_draft.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ draft_id: draftId }, ["draft_id"]),
  }),
  restore_email_draft: imperative({
    title: "Restore email draft",
    description: "Turn a cancelled email back into a draft.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema({ draft_id: draftId }, ["draft_id"]),
  }),
  get_mailbox_email: imperative({
    title: "Read mailbox email",
    description: "Read a connected-mailbox email flagged for review in a thread, including attachment names.",
    readOnly: true,
    untrustedContent: true,
    pages: AGENT_PAGES,
    inputSchema: schema({ email_ref: emailRef }, ["email_ref"]),
  }),
  get_mailbox_attachment_url: imperative({
    title: "Preview mailbox attachment",
    description: "Get a temporary link to one attachment on a connected-mailbox email.",
    readOnly: true,
    pages: AGENT_PAGES,
    inputSchema: schema(
      {
        email_ref: emailRef,
        filename: param.string("Attachment file name."),
        attachment_index: param.integer("Optional attachment position when names repeat."),
      },
      ["email_ref", "filename"],
    ),
  }),
  import_mailbox_policy_attachments: imperative({
    title: "Import policies from email",
    description: "Import policy PDFs attached to a mailbox email into Spot and start extraction. Uses AI extraction time.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema(
      { email_ref: emailRef, filenames: param.stringArray("Optional attachment names; default all PDFs.") },
      ["email_ref"],
    ),
  }),
  import_mailbox_requirement_attachments: imperative({
    title: "Import requirements from email",
    description:
      "Extract insurance requirements from a mailbox email's attachments or body and save them. Uses AI extraction time.",
    readOnly: false,
    consequential: true,
    pages: AGENT_PAGES,
    inputSchema: schema(
      {
        email_ref: emailRef,
        filenames: param.stringArray("Optional attachment names."),
        include_email_body: param.boolean("Also read the email body."),
        source_name: param.string("Optional source title."),
        source_type: param.enum(
          ["lease_agreement", "client_contract", "vendor_requirements", "other"],
          "Optional kind of document.",
        ),
        scope: param.enum(["vendors", "own_org"], "Whose insurance the requirements apply to."),
        holder_name: param.string("Optional holder name."),
        holder_email: param.string("Optional holder email."),
      },
      ["email_ref"],
    ),
  }),
  save_mailbox_attachments_to_thread: imperative({
    title: "Save email attachments to thread",
    description: "Copy a mailbox email's attachments into the agent thread.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema(
      { thread_id: threadId, email_ref: emailRef, filenames: param.stringArray("Optional attachment names.") },
      ["thread_id", "email_ref"],
    ),
  }),
  resolve_mailbox_review: imperative({
    title: "Resolve mailbox review item",
    description: "Mark a mailbox review item in a thread as handled.",
    readOnly: false,
    pages: AGENT_PAGES,
    inputSchema: schema(
      {
        thread_id: threadId,
        email_ref: emailRef,
        resolution: param.enum(
          ["not_relevant", "policy_imported", "requirements_imported"],
          "How it was handled.",
        ),
      },
      ["thread_id", "email_ref", "resolution"],
    ),
  }),
};
