/**
 * Operator chat view of an outbound email draft created by the operator
 * agent's email tools. Returned by `api.operatorEmailDrafts.listForMessages`
 * and rendered under the agent turn that created or last updated the draft.
 */
export type OperatorEmailDraftStatus = "draft" | "pending" | "sent" | "cancelled";

export type OperatorEmailDraftView = {
  id: string;
  messageId: string;
  status: OperatorEmailDraftStatus;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  from?: string;
  html?: string;
  text: string;
  attachments: Array<{ filename: string }>;
  /** Absent when the draft is not linked to a client. */
  organizationName?: string;
  /** Set once the sent message is in the team inbox. */
  teamEmailThreadId?: string;
  sendBlockedReason?: string;
  updatedAt: number;
};
