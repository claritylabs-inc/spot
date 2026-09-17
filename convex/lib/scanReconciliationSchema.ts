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
  operatorWorkspaceScanFindingSources: defineTable({
    findingId: v.id("operatorWorkspaceScanFindings"),
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    excerpt: v.string(),
  })
    .index("finding", ["findingId"])
    .index("source", ["sourceId"])
    .index("pair", ["findingId", "sourceId"]),
  operatorWorkspaceScanInventories: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    operationKey: v.string(),
    cursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
    startedAt: v.number(),
    organizationIds: v.array(v.id("organizations")),
    requestIds: v.array(v.id("procurementRequests")),
    orgId: v.optional(v.id("organizations")),
  }).index("operation", ["sourceId", "operationKey"]),
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
  }).index("source", ["sourceId"]),
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
  })
    .index("attachment", ["sourceId", "attachmentId"])
    .index("policy", ["policyId"]),
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
  })
    .index("source", ["sourceId"])
    .index("operation", ["operationKey"])
    .index("status", ["status", "createdAt"])
    .index("entity", ["entityId", "createdAt"])
    .index("entity_status", ["entityId", "status", "createdAt"])
    .index("record", ["recordId", "createdAt"])
    .index("record_status", ["recordId", "status", "createdAt"])
    .index("request", ["requestId", "createdAt"])
    .index("request_status", ["requestId", "status", "createdAt"])
    .index("broker", ["brokerId", "createdAt"])
    .index("broker_status", ["brokerId", "status", "createdAt"])
    .index("recent", ["createdAt"]),
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
  })
    .index("finding", ["findingId"])
    .index("entity", ["entityId", "appliedAt"]),
  operatorWorkspaceScanIdentities: defineTable({
    identityKey: v.string(),
    orgId: v.id("organizations"),
    createdAt: v.number(),
  })
    .index("identity", ["identityKey"])
    .index("organization", ["orgId"]),
};
