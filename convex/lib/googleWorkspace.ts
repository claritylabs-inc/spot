/** Browser-safe contracts for the operator Google Workspace integration. */

export const GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly" as const;
export const GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE =
  "https://www.googleapis.com/auth/admin.directory.user.readonly" as const;

export const GOOGLE_WORKSPACE_LIMITS = {
  maxConfiguredMailboxes: 100,
  maxRequestedMailboxes: 100,
  defaultPageSize: 20,
  maxPageSize: 50,
  maxCursorChars: 16_000,
  maxQueryChars: 2_000,
  maxMailboxChars: 320,
  maxMessageIdChars: 200,
  maxThreadIdChars: 200,
  maxAttachmentIdChars: 4_000,
  maxVerificationMailboxes: 100,
  maxAttachmentBytes: 15 * 1024 * 1024,
} as const;

export type OperatorGoogleWorkspaceMailboxMode = "manual" | "directory";

export type OperatorGoogleWorkspaceSettingsInput = {
  enabled: boolean;
  mailboxMode: OperatorGoogleWorkspaceMailboxMode;
  mailboxes: string[];
  directoryAdminEmail?: string;
};

export type OperatorGoogleWorkspaceConfig = {
  enabled: boolean;
  mailboxMode: OperatorGoogleWorkspaceMailboxMode;
  mailboxes: string[];
  directoryAdminEmail: string | null;
  /** Unix epoch milliseconds. */
  updatedAt: number;
};

export type OperatorGoogleWorkspaceCredentialStatus = {
  present: boolean;
  serviceAccountEmail: string | null;
  clientId: string | null;
};

export type OperatorGoogleWorkspaceScope =
  | typeof GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE
  | typeof GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE;

export type OperatorGoogleWorkspaceMailboxDiagnostic = {
  mailbox: string;
  status: "verified" | "failed";
  /** Sanitized provider failure. Null on success. */
  error: string | null;
};

export type OperatorGoogleWorkspaceDirectoryDiagnostic = {
  status: "not_required" | "verified" | "partial" | "failed";
  adminEmail: string | null;
  /** Number of eligible mailboxes discovered inside this bounded verification. */
  discoveredMailboxCount: number;
  /** Null when enumeration did not finish and the organization-wide count is unknown. */
  totalMailboxCount: number | null;
  hasMore: boolean;
  /** Sanitized provider failure. Null when Directory access did not fail. */
  error: string | null;
};

export type OperatorGoogleWorkspaceVerificationResult = {
  status: "verified" | "partial" | "failed";
  completeness: "complete" | "partial";
  /** Unix epoch milliseconds. */
  verifiedAt: number;
  /** Binds this result to the settings revision that was verified. */
  configUpdatedAt: number;
  checkedMailboxCount: number;
  /** Exact only after complete enumeration; otherwise null. */
  totalMailboxCount: number | null;
  maxMailboxChecks: number;
  directory: OperatorGoogleWorkspaceDirectoryDiagnostic;
  mailboxes: OperatorGoogleWorkspaceMailboxDiagnostic[];
};

export type OperatorGoogleWorkspaceStatus = {
  config: OperatorGoogleWorkspaceConfig | null;
  credentials: OperatorGoogleWorkspaceCredentialStatus;
  /** Exact scopes to grant through domain-wide delegation for the selected mode. */
  requiredScopes: OperatorGoogleWorkspaceScope[];
  savedVerification: OperatorGoogleWorkspaceVerificationResult | null;
};

export type OperatorGoogleWorkspaceUpdateResult =
  OperatorGoogleWorkspaceConfig | null;

export type OperatorGoogleWorkspaceToolName =
  | "list_company_mailboxes"
  | "search_company_email"
  | "read_company_email_thread"
  | "get_company_email_attachment";

export type OperatorGoogleWorkspaceToolChannel =
  | "chat"
  | "slack"
  | "imessage"
  | "mcp";

export type OperatorGoogleWorkspaceListMailboxesInput = {
  cursor?: string;
  limit?: number;
};

export type OperatorGoogleWorkspaceSearchEmailInput = {
  query: string;
  mailboxes?: string[];
  cursor?: string;
  limit?: number;
};

export type OperatorGoogleWorkspaceReadThreadInput = {
  mailbox: string;
  threadId: string;
  cursor?: string;
  limit?: number;
};

export type OperatorGoogleWorkspaceGetAttachmentInput = {
  mailbox: string;
  messageId: string;
  attachmentId: string;
};

export type OperatorGoogleWorkspaceMailbox = {
  mailbox: string;
  displayName: string | null;
  aliases: string[];
  source: "manual" | "directory";
};

export type OperatorGoogleWorkspaceListMailboxesResult = {
  mailboxMode: OperatorGoogleWorkspaceMailboxMode;
  mailboxes: OperatorGoogleWorkspaceMailbox[];
  nextCursor: string | null;
  completeness: "complete" | "partial";
  error: string | null;
};

export type OperatorGoogleWorkspaceSearchMessage = {
  mailbox: string;
  messageId: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  date: string | null;
  snippet: string | null;
  metadataComplete: boolean;
};

export type OperatorGoogleWorkspaceMailboxError = {
  mailbox: string;
  error: string;
};

export type OperatorGoogleWorkspaceSearchEmailResult = {
  query: string;
  messages: OperatorGoogleWorkspaceSearchMessage[];
  searchedMailboxes: string[];
  errors: OperatorGoogleWorkspaceMailboxError[];
  directoryError: string | null;
  encounteredErrorCount: number;
  nextCursor: string | null;
  completeness: "complete" | "partial";
  ordering: "mailbox_then_gmail";
  querySemantics: "gmail_api_no_alias_expansion";
};

export type OperatorGoogleWorkspaceThreadAttachment = {
  attachmentId: string;
  partId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  contentId: string | null;
};

export type OperatorGoogleWorkspaceThreadMessage = {
  mailbox: string;
  messageId: string;
  threadId: string;
  from: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string | null;
  date: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  body: string;
  bodyFormat: "plain" | "html_fallback" | "unavailable";
  bodyOffset: number;
  bodyComplete: boolean;
  bodySourceComplete: boolean;
  bodyUnavailableParts: Array<{
    partId: string;
    attachmentId: string;
    reason: string;
  }>;
  attachments: OperatorGoogleWorkspaceThreadAttachment[];
};

export type OperatorGoogleWorkspaceReadThreadResult = {
  mailbox: string;
  threadId: string;
  messages: OperatorGoogleWorkspaceThreadMessage[];
  nextCursor: string | null;
  completeness: "complete" | "partial";
  maxBodyCharsPerPage: number;
};

export type OperatorGoogleWorkspaceAttachmentSource = {
  mailbox: string;
  messageId: string;
  threadId: string;
  attachmentId: string;
  partId: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  contentId: string | null;
};

export type OperatorGoogleWorkspaceGetAttachmentResult = {
  status: "attached";
  source: OperatorGoogleWorkspaceAttachmentSource;
  extracted: unknown;
};
