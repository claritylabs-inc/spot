import { defineTable } from "convex/server";
import { v } from "convex/values";

export const markdownDocumentKind = v.union(
  v.literal("packet"),
  v.literal("company_wiki"),
  v.literal("request_intake"),
  v.literal("outreach_log"),
  v.literal("requirement_notes"),
  v.literal("holder_notes"),
  v.literal("certificate_review_notes"),
  v.literal("certificate_delivery_notes"),
  v.literal("procurement_file_notes"),
);

export const markdownDocumentTables = {
  markdownDocuments: defineTable({
    orgId: v.id("organizations"),
    kind: markdownDocumentKind,
    requestId: v.optional(v.id("procurementRequests")),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
    requirementSourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    certificateHolderId: v.optional(v.id("certificateHolders")),
    certificateWorkflowJobId: v.optional(v.id("certificateWorkflowJobs")),
    fileItemId: v.optional(v.id("procurementFileItems")),
    filename: v.string(),
    markdown: v.string(),
    revision: v.number(),
    updatedAt: v.number(),
  })
    .index("kind", ["kind"])
    .index("organization_kind", ["orgId", "kind"])
    .index("request_kind", ["requestId", "kind"])
    .index("request_file", ["requestId", "kind", "filename"])
    .index("outreach_kind", ["outreachId", "kind"])
    .index("requirement_kind", ["requirementSourceDocumentId", "kind"])
    .index("holder_kind", ["certificateHolderId", "kind"])
    .index("workflow_kind", ["certificateWorkflowJobId", "kind"])
    .index("file_kind", ["fileItemId", "kind"]),
};
