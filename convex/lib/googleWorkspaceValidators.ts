import { v } from "convex/values";

export const operatorGoogleWorkspaceMailboxModeValidator = v.union(
  v.literal("manual"),
  v.literal("directory"),
);

export const operatorGoogleWorkspaceMailboxDiagnosticValidator = v.object({
  mailbox: v.string(),
  status: v.union(v.literal("verified"), v.literal("failed")),
  error: v.union(v.string(), v.null()),
});

export const operatorGoogleWorkspaceDirectoryDiagnosticValidator = v.object({
  status: v.union(
    v.literal("not_required"),
    v.literal("verified"),
    v.literal("partial"),
    v.literal("failed"),
  ),
  adminEmail: v.union(v.string(), v.null()),
  discoveredMailboxCount: v.number(),
  totalMailboxCount: v.union(v.number(), v.null()),
  hasMore: v.boolean(),
  error: v.union(v.string(), v.null()),
});

export const operatorGoogleWorkspaceVerificationResultValidator = v.object({
  status: v.union(
    v.literal("verified"),
    v.literal("partial"),
    v.literal("failed"),
  ),
  completeness: v.union(v.literal("complete"), v.literal("partial")),
  verifiedAt: v.number(),
  configUpdatedAt: v.number(),
  checkedMailboxCount: v.number(),
  totalMailboxCount: v.union(v.number(), v.null()),
  maxMailboxChecks: v.number(),
  directory: operatorGoogleWorkspaceDirectoryDiagnosticValidator,
  mailboxes: v.array(operatorGoogleWorkspaceMailboxDiagnosticValidator),
});

export const storedOperatorGoogleWorkspaceVerificationValidator = v.object({
  result: operatorGoogleWorkspaceVerificationResultValidator,
  credentialRevision: v.string(),
});
