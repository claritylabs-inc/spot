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
  /** The operator it is signed and sent as. */
  senderUserId?: string;
  html?: string;
  text: string;
  /** The editable message, without signature or quoted history. */
  body: string;
  /** Operators can revise it by hand: an unsent draft that is not an approved inbox reply. */
  editable: boolean;
  attachments: Array<{ filename: string }>;
  /** Absent when the draft is not linked to a client. */
  organizationName?: string;
  /** Set once the sent message is in the team inbox. */
  teamEmailThreadId?: string;
  sendBlockedReason?: string;
  /** The exact content an operator approves by sending from the artifact. */
  fingerprint: string;
  /** Follow-ups sending starts; a null cadence lets Spot pick the schedule. */
  followUps: {
    cadence: { followUpCount: number; intervalBusinessDays: number } | null;
  } | null;
  /** Sending launches the request's client information request sequence. */
  clientRequest: boolean;
  updatedAt: number;
};
