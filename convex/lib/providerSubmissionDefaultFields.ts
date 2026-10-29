import { v } from "convex/values";

export const providerSubmissionRequirementValidator = v.object({
  question: v.string(),
  guidance: v.string(),
});

export const providerSubmissionFormValidator = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  sourceStorageId: v.id("_storage"),
  sourceThreadId: v.id("teamEmailThreads"),
  sourceMessageId: v.id("teamEmailMessages"),
  sourceClientFileId: v.optional(v.id("clientFiles")),
  addedAt: v.number(),
});

export const providerSubmissionSaveArgs = {
  brokerOrgId: v.id("organizations"),
  coverageCode: v.string(),
  expectedRevision: v.optional(v.number()),
  instructions: v.string(),
  requirements: v.array(providerSubmissionRequirementValidator),
  sourceThreadId: v.optional(v.id("teamEmailThreads")),
  sourceMessageId: v.optional(v.id("teamEmailMessages")),
};

export const providerSubmissionAttachmentValidator = v.object({
  threadId: v.id("teamEmailThreads"),
  messageId: v.id("teamEmailMessages"),
  clientFileId: v.optional(v.id("clientFiles")),
  storageId: v.optional(v.id("_storage")),
});
