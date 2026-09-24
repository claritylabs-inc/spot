import { defineTable } from "convex/server";
import { v } from "convex/values";
export const scanActivityStatus = v.union(
  v.literal("updated"),
  v.literal("needs_attention"),
  v.literal("failed"),
);
export const scanInsuredAddressValidator = v.object({
  street1: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
});
export const scanReconciliationTables = {
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanFindingSources: defineTable({
    findingId: v.id("operatorWorkspaceScanFindings"),
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    excerpt: v.string(),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanInventories: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    operationKey: v.string(),
    cursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
    startedAt: v.number(),
    organizationIds: v.array(v.id("organizations")),
    requestIds: v.array(v.id("procurementRequests")),
    orgId: v.optional(v.id("organizations")),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanContexts: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    body: v.string(),
    participants: v.array(v.string()),
    messages: v.array(
      v.object({
        messageId: v.string(),
        sentAt: v.string(),
        excerpt: v.string(),
      }),
    ),
    createdAt: v.number(),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanImports: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    attachmentId: v.string(),
    clientOrgId: v.optional(v.id("organizations")),
    insuredName: v.optional(v.string()),
    insuredAddress: v.optional(scanInsuredAddressValidator),
    file: v.object({
      fileId: v.id("_storage"),
      fileName: v.string(),
      fileSha256: v.string(),
      size: v.number(),
    }),
    boundPolicy: v.boolean(),
    policyId: v.optional(v.id("policies")),
    createdAt: v.number(),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanFindings: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    operationKey: v.string(),
    status: scanActivityStatus,
    title: v.string(),
    explanation: v.string(),
    excerpt: v.string(),
    operationJson: v.optional(v.string()),
    entityId: v.optional(v.string()),
    recordId: v.optional(v.string()),
    requestId: v.optional(v.id("procurementRequests")),
    brokerId: v.optional(v.id("organizations")),
    selectedOrgId: v.optional(v.id("organizations")),
    selectedRequestId: v.optional(v.id("procurementRequests")),
    selectedByUserId: v.optional(v.id("users")),
    recordLinks: v.array(v.object({ label: v.string(), href: v.string() })),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolution: v.optional(v.string()),
    authorizingOperatorId: v.id("users"),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanChanges: defineTable({
    findingId: v.id("operatorWorkspaceScanFindings"),
    entityId: v.string(),
    table: v.union(
      v.literal("organizations"),
      v.literal("procurementRequests"),
      v.literal("brokerProfiles"),
      v.literal("orgWikiSections"),
      v.literal("markdownDocuments"),
      v.literal("procurementBrokerOutreaches"),
      v.literal("policies"),
    ),
    beforeJson: v.string(),
    afterJson: v.string(),
    fields: v.array(v.string()),
    created: v.boolean(),
    effectiveAt: v.number(),
    appliedAt: v.number(),
    correctedAt: v.optional(v.number()),
  }),
  // Deprecated: workspace scan removed; drop after data cleanup.
  operatorWorkspaceScanIdentities: defineTable({
    identityKey: v.string(),
    orgId: v.id("organizations"),
    createdAt: v.number(),
  }),
};
