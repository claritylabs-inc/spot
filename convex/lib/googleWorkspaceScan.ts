/** Browser-safe scheduled Workspace reconciliation contracts. */
import type { Id } from "../_generated/dataModel";
import type { OperatorGoogleWorkspaceThreadAttachment } from "./googleWorkspace";

export const GOOGLE_WORKSPACE_SCAN_INTERVALS = [15, 30, 60, 360, 1440] as const;
export type GoogleWorkspaceScanInterval =
  (typeof GOOGLE_WORKSPACE_SCAN_INTERVALS)[number];
export type GoogleWorkspaceScanPhase =
  | "discovery"
  | "collection"
  | "reconciliation"
  | "completed"
  | "partial"
  | "paused";
export type GoogleWorkspaceScanActivityFilter =
  | "updated"
  | "needs_attention"
  | "failed";

export type GoogleWorkspaceScanConfig = {
  enabled: boolean;
  intervalMinutes: GoogleWorkspaceScanInterval;
  authorizationRevision: number;
  settingsUpdatedAt: number;
  authorizingOperatorId: Id<"users"> | null;
  pausedReason: string | null;
  authorizingOperatorLabel?: string | null;
};
export type GoogleWorkspaceScanCoverage = {
  windowStartAt: number | null;
  discoveredMailboxes: number;
  completedMailboxes: number;
  failedMailboxes: number;
  failedSources?: number;
  collectedMessages: number;
  pendingSources: number;
  reconciledSources: number;
  directoryComplete: boolean;
};
export type GoogleWorkspaceScanRun = {
  id: string;
  phase: GoogleWorkspaceScanPhase;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  coverage: GoogleWorkspaceScanCoverage;
};
export type GoogleWorkspaceScanStatus = {
  config: GoogleWorkspaceScanConfig;
  latestRun: GoogleWorkspaceScanRun | null;
  nextRunAt: number | null;
  lastSuccessAt: number | null;
};
export type GoogleWorkspaceScanSettingsInput = {
  expectedAuthorizationRevision?: number;
  expectedSettingsUpdatedAt?: number;
  enabled: boolean;
  intervalMinutes: GoogleWorkspaceScanInterval;
  /** Omission preserves the current sponsor; first enable uses the caller. */
  authorizingOperatorId?: Id<"users">;
};
export type GoogleWorkspaceScanStartResult = {
  runId: string;
  alreadyRunning: boolean;
};
export type GoogleWorkspaceScanMailbox = {
  id: string;
  mailbox: string;
  phase: "checkpoint" | "baseline" | "history" | "completed";
  status: "pending" | "running" | "failed" | "completed";
  collectedMessages: number;
  error: string | null;
  lastSuccessAt: number | null;
};

/** Source body is losslessly paged separately. Never infer from an incomplete body. */
export type GoogleWorkspaceScanSourceEvidence = {
  mailbox: string;
  messageId: string;
  threadId: string;
  internetMessageId: string | null;
  internalDate: number | null;
  sentAt: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  inReplyTo: string | null;
  references: string | null;
  contentFingerprint: string;
  bodyFingerprint: string;
  attachments: OperatorGoogleWorkspaceThreadAttachment[];
  bodyPartCount: number;
  bodyComplete: boolean;
};
export type GoogleWorkspaceScanSourcePart = { ordinal: number; text: string };
export type GoogleWorkspaceScanRecordLink = { label: string; href: string };
export type GoogleWorkspaceScanChange = {
  field: string;
  before: string | null;
  after: string | null;
};
export type GoogleWorkspaceScanActivity = {
  id: string;
  status: GoogleWorkspaceScanActivityFilter;
  title: string;
  explanation: string;
  createdAt: number;
  resolvedAt: number | null;
  changes: GoogleWorkspaceScanChange[];
  records: GoogleWorkspaceScanRecordLink[];
  sources: Array<{
    sourceId: string;
    mailbox: string;
    messageId: string;
    threadId: string;
    subject: string | null;
    sentAt: string | null;
    excerpt: string;
    href: string;
  }>;
  importState?: "queued" | "extracting" | "complete" | "error";
  availableActions: Array<"resolve" | "dismiss" | "retry" | "correct">;
};
export type GoogleWorkspaceScanActivityResolution = {
  activityId: string;
  note?: string;
};

/** Collection limits bound one invocation, never the eventual roster or scan. */
export const GOOGLE_WORKSPACE_SCAN_LIMITS = {
  initialLookbackDays: 90,
  directoryPageSize: 100,
  messagePageSize: 25,
  activeMailboxes: 4,
  sourceBatchSize: 8,
  bodyPartChars: 48_000,
  leaseMs: 5 * 60_000,
  maxBackoffMs: 6 * 60 * 60_000,
} as const;

export type GoogleWorkspaceScanActivityActionResult = {
  status: "resolved" | "dismissed" | "retrying" | "corrected" | "conflict";
  message: string;
};

export async function googleWorkspaceScanBodyFingerprint(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function googleWorkspaceScanContentFingerprint(evidence: Pick<GoogleWorkspaceScanSourceEvidence, "from" | "to" | "cc" | "sentAt" | "subject" | "internetMessageId" | "inReplyTo" | "references" | "attachments">, body: string): Promise<string> {
  return googleWorkspaceScanBodyFingerprint(JSON.stringify({from:evidence.from,to:evidence.to,cc:evidence.cc,sentAt:evidence.sentAt,subject:evidence.subject,
    internetMessageId:evidence.internetMessageId,inReplyTo:evidence.inReplyTo,references:evidence.references,body,
    attachments:evidence.attachments.map(item=>({filename:item.filename,size:item.size,contentType:item.contentType}))}));
}
