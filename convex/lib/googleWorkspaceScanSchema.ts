import { defineTable } from "convex/server";
import { v } from "convex/values";

export const scanIntervalValidator = v.union(
  v.literal(15),
  v.literal(30),
  v.literal(60),
  v.literal(360),
  v.literal(1440),
);
export const scanAttachmentValidator = v.object({
  attachmentId: v.string(),
  partId: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  inline: v.boolean(),
  contentId: v.union(v.string(), v.null()),
});
export const scanEvidenceValidator = v.object({
  mailbox: v.string(),
  messageId: v.string(),
  threadId: v.string(),
  internetMessageId: v.union(v.string(), v.null()),
  internalDate: v.union(v.number(), v.null()),
  sentAt: v.union(v.string(), v.null()),
  from: v.union(v.string(), v.null()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  subject: v.union(v.string(), v.null()),
  inReplyTo: v.union(v.string(), v.null()),
  references: v.union(v.string(), v.null()),
  contentFingerprint: v.string(),
  bodyFingerprint: v.string(),
  attachments: v.array(scanAttachmentValidator),
  bodyPartCount: v.number(),
  bodyComplete: v.boolean(),
});
export const scanSourceStatusValidator = v.union(
  v.literal("collecting"),
  v.literal("ready"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("needs_attention"),
  v.literal("failed"),
  v.literal("excluded"),
);
export const googleWorkspaceScanTables = {
  operatorGoogleWorkspaceScanConfig: defineTable({
    key: v.literal("default"),
    enabled: v.boolean(),
    intervalMinutes: scanIntervalValidator,
    authorizationRevision: v.number(),
    authorizingOperatorId: v.id("users"),
    connectorRevision: v.number(),
    credentialRevision: v.string(),
    windowStartAt: v.optional(v.number()),
    nextRunAt: v.number(),
    lastSuccessAt: v.optional(v.number()),
    currentRunId: v.optional(v.id("operatorGoogleWorkspaceScanRuns")),
    pausedReason: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("key", ["key"]),
  operatorGoogleWorkspaceScanRuns: defineTable({
    authorizationRevision: v.number(),
    phase: v.union(
      v.literal("discovery"),
      v.literal("collection"),
      v.literal("reconciliation"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("paused"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    windowStartAt: v.number(),
    directoryPageToken: v.optional(v.string()),
    directoryComplete: v.boolean(),
    discoveredMailboxes: v.number(),
    completedMailboxes: v.number(),
    failedMailboxes: v.number(),
    collectedMessages: v.number(),
    failedSources: v.number(),
    pendingSources: v.number(),
    reconciledSources: v.number(),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    nextAttemptAt: v.number(),
    attempts: v.number(),
    error: v.optional(v.string()),
  }).index("started", ["startedAt"]),
  operatorGoogleWorkspaceScanMailboxes: defineTable({
    mailbox: v.string(),
    runId: v.id("operatorGoogleWorkspaceScanRuns"),
    authorizationRevision: v.number(),
    phase: v.union(
      v.literal("checkpoint"),
      v.literal("baseline"),
      v.literal("history"),
      v.literal("completed"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("completed"),
    ),
    windowStartAt: v.number(),
    historyCheckpoint: v.optional(v.string()),
    pageToken: v.optional(v.string()),
    collectedMessages: v.number(),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    nextAttemptAt: v.number(),
    attempts: v.number(),
    error: v.optional(v.string()),
    lastSuccessAt: v.optional(v.number()),
  })
    .index("mailbox", ["mailbox"])
    .index("run_status", ["runId", "status", "nextAttemptAt"])
    .index("run_leases", ["runId", "status", "leaseUntil"]),
  operatorGoogleWorkspaceScanSources: defineTable({
    mailbox: v.string(),
    messageId: v.string(),
    threadId: v.string(),
    mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes"),
    runId: v.id("operatorGoogleWorkspaceScanRuns"),
    authorizationRevision: v.number(),
    status: scanSourceStatusValidator,
    evidence: v.optional(scanEvidenceValidator),
    active: v.optional(v.boolean()),
    hasError: v.optional(v.boolean()),
    stagedPartCount: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    nextAttemptAt: v.number(),
    attempts: v.number(),
    error: v.optional(v.string()),
    collectedAt: v.optional(v.number()),
    reconciledAt: v.optional(v.number()),
  })
    .index("message", ["mailbox", "messageId"])
    .index("status_due", ["authorizationRevision", "status", "nextAttemptAt"])
    .index("active", ["authorizationRevision", "active", "leaseUntil"])
    .index("mailbox_errors", ["mailboxId", "hasError"])
    .index("run_status", ["runId", "status"])
    .index("fingerprint", ["evidence.contentFingerprint"]),
  operatorGoogleWorkspaceScanSourceParts: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    ordinal: v.number(),
    text: v.string(),
  }).index("source_ordinal", ["sourceId", "ordinal"]),
};
