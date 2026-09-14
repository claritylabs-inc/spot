import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";

// Tables to wipe. Excludes Convex system tables (_storage, _scheduled_functions).
// Includes authTables from @convex-dev/auth so dev resets fully clear auth state.
const TABLES: TableNames[] = [
  "authAccounts",
  "authSessions",
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
  "users",
  "organizations",
  "orgMemberships",
  "brokerModelSettings",
  "orgInvitations",
  "connectedOrgRelationships",
  "connectedOrgInvitations",
  "connectedEmailAccounts",
  "connectedEmailScanStates",
  "connectedEmailAutomationItems",
  "policies",
  "policyFiles",
  "policyVersions",
  "certificateHolders",
  "certificateHolderPolicyLinks",
  "policyCertificates",
  "certificateVersions",
  "certificateWorkflowSettings",
  "certificateWorkflowJobs",
  "notifications",
  "notificationPreferences",
  "documentChunks",
  "sourceSpans",
  "sourceNodes",
  "policyAuditLog",
  "companyInformationExtractions",
  "proposalSourceNodes",
  "proposalSourceSpans",
  "procurementProposalExtractionArtifacts",
  "procurementProposalExtractionJobs",
  "procurementProposalReviews",
  "procurementProposalDocuments",
  "procurementProposals",
  "procurementFileItems",
  "procurementEmailMessages",
  "procurementEmailThreads",
  "procurementBrokerOutreaches",
  "procurementRequests",
  "brokerProfiles",
  "clientFileUploadIntents",
  "clientFiles",
  "threads",
  "threadMessages",
  "operatorAgentAttachments",
  "operatorAgentUploadIntents",
  "operatorAgentConfirmations",
  "operatorAgentRuns",
  "operatorAgentMessages",
  "operatorAgentThreads",
  "agentActionAuditEvents",
  "pendingEmails",
  "oauthClients",
  "oauthAuthCodes",
  "oauthTokens",
  "rateLimitCounters",
  "presence",
];

const BATCH_SIZE = 500;

function assertDev() {
  // Set via: `npx convex env set ALLOW_DEV_CLEAR true` on dev only.
  // Never set this on prod.
  if (process.env.ALLOW_DEV_CLEAR !== "true") {
    throw new Error(
      "devClear is disabled. Set ALLOW_DEV_CLEAR=true on the dev deployment only.",
    );
  }
}

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    assertDev();
    for (const table of TABLES) {
      await ctx.scheduler.runAfter(0, internal.devClear.clearTableBatch, {
        table,
      });
    }
    await ctx.scheduler.runAfter(0, internal.devClear.clearStorageBatch, {});
    return { scheduled: TABLES.length + 1 };
  },
});

export const clearStorageBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertDev();
    const files = await ctx.db.system.query("_storage").take(BATCH_SIZE);
    for (const file of files) {
      await ctx.storage.delete(file._id);
    }
    if (files.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.devClear.clearStorageBatch, {});
    }
  },
});

export const clearTableBatch = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    assertDev();
    const rows = await ctx.db.query(table as TableNames).take(BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.devClear.clearTableBatch, {
        table,
      });
    }
  },
});
