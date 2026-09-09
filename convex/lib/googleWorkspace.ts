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
