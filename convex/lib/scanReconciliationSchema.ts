import { defineTable } from "convex/server";
import { v } from "convex/values";
export const scanActivityStatus = v.union(
  v.literal("updated"),
  v.literal("needs_attention"),
  v.literal("failed"),
);
export const scanReconciliationTables = {
  operatorWorkspaceScanImports: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    attachmentId: v.string(),
    clientOrgId: v.id("organizations"),
    file: v.object({
      fileId: v.id("_storage"),
      fileName: v.string(),
      fileSha256: v.string(),
      size: v.number(),
    }),
    boundPolicy: v.boolean(),
    policyId: v.optional(v.id("policies")),
    createdAt: v.number(),
  }).index("attachment", ["sourceId", "attachmentId"]),
  operatorWorkspaceScanFindings: defineTable({
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    operationKey: v.string(),
    status: scanActivityStatus,
    title: v.string(),
    explanation: v.string(),
    excerpt: v.string(),
    operationJson: v.optional(v.string()),
    entityId: v.optional(v.string()),
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
    .index("recent", ["createdAt"]),
  operatorWorkspaceScanChanges: defineTable({
    findingId: v.id("operatorWorkspaceScanFindings"),
    entityId: v.string(),
    table: v.union(
      v.literal("organizations"),
      v.literal("procurementRequests"),
      v.literal("brokerProfiles"),
      v.literal("orgWikiSections"),
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
  }).index("identity", ["identityKey"]),
};
