import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

type Node = {
  table: string;
  // Index whose first field is matched against the parent's id (or the scope id for roots).
  index: string;
  field: string;
  storage?: string[];
  children?: Node[];
};

const ROOT_BATCH = 25;
const CHILD_BATCH = 100;
const OP_BUDGET = 2500;

const child = (
  table: string,
  index: string,
  field: string,
  storage?: string[],
  children?: Node[],
): Node => ({ table, index, field, storage, children });

const policyChildren = [
  child("policyExtractionRuns", "policy", "policyId"),
  child("policyExtractionArtifacts", "policy", "policyId", ["storageId"]),
  child("policyExtractionTraceEvents", "policy_time", "policyId"),
  child("carrierIdentityBackfillResults", "policy", "policyId"),
];

const proposalChildren = [
  child("procurementProposalDocuments", "proposal", "proposalId", ["fileId"]),
  child("procurementProposalReviews", "proposal", "proposalId"),
  child("procurementProposalExtractionJobs", "proposal", "proposalId", [
    "completionPayloadStorageId",
  ]),
  child("procurementProposalExtractionArtifacts", "proposal", "proposalId", [
    "storageId",
  ]),
  child("proposalSourceSpans", "proposal", "proposalId"),
  child("proposalSourceNodes", "proposal", "proposalId"),
];

const requestChildren = [
  child("procurementOutreachSequences", "by_requestId_and_status", "requestId", undefined, [
    child("procurementOutreachSteps", "by_sequenceId_and_index", "sequenceId"),
  ]),
  child("procurementOutreachCadences", "by_requestId", "requestId"),
  child("requestIntakeUploadIntents", "request", "requestId", ["fileId"]),
  child("requestIntakeFiles", "request", "requestId", ["fileId"]),
  child("intakeSlackEvents", "request_event", "requestId"),
  child("procurementFileItems", "request", "requestId"),
  child("procurementBrokerOutreaches", "request", "requestId"),
  child("procurementPacketLinks", "request", "requestId", undefined, [
    child("procurementPacketViews", "link", "linkId"),
  ]),
  child(
    "procurementProposals",
    "request",
    "requestId",
    undefined,
    proposalChildren,
  ),
];

const messageChildren = [
  child("slackMessageRevisions", "message_edited", "threadMessageId"),
  child("slackOutboundSends", "message", "threadMessageId", ["fileId"]),
  child("chatPresentationEvidence", "message", "messageId"),
  child("slackMessagePresentations", "message", "threadMessageId", undefined, [
    child("slackInteractionEvents", "presentation_created", "presentationId"),
  ]),
];

const threadChildren = [
  child("threadMessages", "thread", "threadId", ["fileId"], messageChildren),
  child("threadContextStates", "thread", "threadId"),
  child("threadActionConfirmations", "thread_status", "threadId"),
  child("imessageOutboundSends", "thread", "threadId"),
  child("imessageInboundEvents", "thread", "threadId"),
  child("imessageAgentRunLeases", "thread", "threadId"),
  child("emailDeliveryAttempts", "thread", "threadId"),
  child("appCardAccessLinks", "thread", "sourceThreadId"),
  child("emailDraftReviewLinks", "thread", "sourceThreadId"),
  child("pendingEmails", "thread", "threadId", undefined, [
    child("emailDraftReviewLinks", "draft_channel", "pendingEmailId"),
  ]),
];

const connectionChildren = [
  child("slackChannelBindings", "connection_status", "connectionId"),
  child("slackChannelMemberships", "connection_status", "connectionId"),
  child("slackLifecycleEvents", "connection_received", "connectionId"),
  child("slackActors", "slack_identity", "connectionId"),
  child("slackInboundEvents", "slack_thread", "connectionId"),
  child("slackHandoffs", "source_thread", "connectionId"),
];

// Rows owned by the client organization, children before parents.
const ORG_ROOTS: Node[] = [
  child(
    "procurementRequests",
    "organization",
    "clientOrgId",
    undefined,
    requestChildren,
  ),
  child("teamEmailThreads", "by_clientOrgId_and_latestMessageAt", "clientOrgId", undefined, [
    child("teamEmailMessages", "by_threadId_and_receivedAt", "threadId"),
    child("teamEmailThreadLinks", "by_threadId", "threadId"),
    child("teamInboxReads", "by_threadId", "threadId"),
    child("pendingEmails", "by_teamEmailThreadId", "teamEmailThreadId", undefined, [
      child("emailDraftReviewLinks", "draft_channel", "pendingEmailId"),
    ]),
  ]),
  // Legacy copies stay until the tables are dropped after the cutover readback.
  child("procurementEmailThreads", "organization", "clientOrgId", undefined, [
    child("procurementEmailMessages", "thread", "threadId"),
  ]),
  child("procurementBrokerOutreaches", "organization", "clientOrgId"),
  child("threads", "organization", "orgId", undefined, threadChildren),
  child(
    "slackWorkspaceConnections",
    "client_status",
    "clientOrgId",
    undefined,
    connectionChildren,
  ),
  child("slackSetupStates", "client", "clientOrgId"),
  child("slackOAuthStates", "client_purpose", "clientOrgId"),
  child("agentChannelSettings", "client", "clientOrgId"),
  child("connectedOrgRelationships", "client", "clientOrgId"),
  child("connectedOrgInvitations", "client", "clientOrgId"),
  child("insuranceRequirements", "organization", "orgId", undefined, [
    child("complianceJudgments", "requirement_subject_policy", "requirementId"),
  ]),
  child("complianceChecks", "organization_subject", "orgId"),
  child("requirementSourceDocuments", "organization", "orgId", ["fileId"]),
  child("requirementExtractionRuns", "organization_started", "orgId"),
  child("connectedEmailAutomationItems", "organization_updated", "orgId"),
  child("connectedEmailScanStates", "organization", "orgId"),
  child("connectedEmailAccounts", "organization", "orgId"),
  child("companyInformationExtractions", "organization", "orgId"),
  child("companyResearchEvents", "organization", "orgId"),
  child("agentResponseFeedback", "organization_created", "orgId"),
  child("agentActionAuditEvents", "organization_created", "orgId"),
  child("emailDeliveryAttempts", "organization", "orgId"),
  child("imessageChats", "organization", "primaryOrgId"),
  child("notifications", "organization", "orgId"),
  child("appCardAccessLinks", "organization", "orgId"),
  child("certificateVersions", "organization", "orgId", ["fileId"]),
  child("certificates", "organization", "orgId", ["fileId"]),
  child("certificateRequestHolds", "organization", "orgId"),
  child("certificateHolderPolicyLinks", "organization", "orgId"),
  child("policyCertificates", "organization", "orgId"),
  child("certificateHolders", "organization", "orgId"),
  child("clientFiles", "organization", "orgId", ["fileId"]),
  child("routerAssets", "organization", "orgId", ["storageId"]),
  child("policyFiles", "organization", "orgId", ["fileId"]),
  child("policyVersions", "organization", "orgId"),
  child("policyDeclarationFacts", "organization", "orgId"),
  child("policyAuditLog", "organization", "orgId"),
  child("sourceSpans", "organization", "orgId"),
  child("sourceNodes", "organization", "orgId"),
  child("policyUploadFingerprints", "organization_hash", "orgId"),
  child("policyUploadFingerprintInventories", "organization", "orgId"),
  child("policyExtractionTraceSessions", "organization_started", "orgId"),
  child("policies", "organization", "orgId", ["fileId"], policyChildren),
  child("orgInvitations", "organization", "orgId"),
  child("orgMemberships", "organization", "orgId"),
];

// Rows owned by a deleted user.
const USER_ROOTS: Node[] = [
  child("notifications", "user", "userId"),
  child("notificationPreferences", "user_organization", "userId"),
  child("imessagePrivacyStates", "user", "userId"),
  child("imessageParticipants", "user", "userId"),
  child("mcpEventSubscriptions", "user", "userId"),
  child("oauthTokens", "user", "userId", undefined, [
    child("rateLimitCounters", "token", "tokenId"),
  ]),
  child("presence", "user", "userId"),
  child("userEmailChangeRequests", "target_status", "targetUserId"),
  child("connectedEmailAccounts", "user", "userId"),
  child("imessageHistoryDeletionJobs", "user_requested", "userId", undefined, [
    child("imessageHistoryDeletionTargets", "job_thread", "jobId"),
    child("imessageHistoryDeletionFiles", "job_file", "jobId", ["fileId"]),
  ]),
  child("threads", "private_history", "createdBy", undefined, threadChildren),
  child(
    "procurementRequests",
    "owner_updated",
    "ownerUserId",
    undefined,
    requestChildren,
  ),
  child("policies", "user", "userId", ["fileId"], policyChildren),
  child("orgMemberships", "user", "userId"),
];

type Budget = { ops: number };

function indexedRows(
  ctx: MutationCtx,
  node: Node,
  parentId: string,
  limit: number,
) {
  // Table and index names are data-driven here, so the typed builder is bypassed.
  return ctx.db
    .query(node.table as TableNames)
    .withIndex(
      node.index as never,
      ((q: { eq: (field: string, value: string) => unknown }) =>
        q.eq(node.field, parentId)) as never,
    )
    .take(limit);
}

async function deleteTree(
  ctx: MutationCtx,
  node: Node,
  doc: Record<string, unknown> & { _id: Id<TableNames> },
  budget: Budget,
): Promise<boolean> {
  for (const spec of node.children ?? []) {
    for (;;) {
      if (budget.ops > OP_BUDGET) return false;
      const rows = await indexedRows(ctx, spec, doc._id, CHILD_BATCH);
      budget.ops += rows.length + 1;
      for (const row of rows) {
        if (!(await deleteTree(ctx, spec, row, budget))) return false;
      }
      if (rows.length < CHILD_BATCH) break;
    }
  }
  for (const field of node.storage ?? []) {
    const storageId = doc[field];
    if (typeof storageId === "string")
      await ctx.storage.delete(storageId as Id<"_storage">).catch(() => {});
  }
  // Uploads an unlinked team message was still holding for a client.
  if (node.table === "teamEmailMessages" && Array.isArray(doc.unfiledAttachments)) {
    for (const file of doc.unfiledAttachments as { storageId: Id<"_storage"> }[])
      await ctx.storage.delete(file.storageId).catch(() => {});
  }
  await ctx.db.delete(doc._id);
  budget.ops += 1;
  return true;
}

function buildSteps(userIds: Id<"users">[], hasOrg: boolean) {
  return [
    ...(hasOrg ? ORG_ROOTS : []).map((node) => ({ node, scopeId: null })),
    ...userIds.flatMap((userId) =>
      USER_ROOTS.map((node) => ({ node, scopeId: userId as string })),
    ),
  ];
}

export const purgeClient = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    userIds: v.array(v.id("users")),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const steps = buildSteps(args.userIds, args.orgId !== undefined);
    const budget: Budget = { ops: 0 };
    let position = args.position;
    while (position < steps.length && budget.ops <= OP_BUDGET) {
      const step = steps[position];
      const rows = await indexedRows(
        ctx,
        step.node,
        (step.scopeId ?? args.orgId) as string,
        ROOT_BATCH,
      );
      budget.ops += rows.length + 1;
      let complete = true;
      for (const row of rows) {
        if (!(await deleteTree(ctx, step.node, row, budget))) {
          complete = false;
          break;
        }
      }
      if (complete && rows.length < ROOT_BATCH) position += 1;
    }
    if (position < steps.length) {
      await ctx.scheduler.runAfter(0, internal.clientDeletion.purgeClient, {
        orgId: args.orgId,
        userIds: args.userIds,
        position,
      });
      return;
    }
    for (const userId of args.userIds) {
      if (await ctx.db.get(userId)) await ctx.db.delete(userId);
    }
    const org = args.orgId ? await ctx.db.get(args.orgId) : null;
    if (org) {
      if (org.iconStorageId)
        await ctx.storage.delete(org.iconStorageId).catch(() => {});
      await ctx.db.delete(org._id);
    }
  },
});
