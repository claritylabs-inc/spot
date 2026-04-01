import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    state: v.optional(v.string()), // "new" | "awaiting_category" | "awaiting_policy" | "active"
    preferredCategory: v.optional(v.string()),
    uploadToken: v.optional(v.string()),
    linqChatId: v.optional(v.string()), // Linq chat ID for ongoing conversation
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_phone", ["phone"])
    .index("by_upload_token", ["uploadToken"])
    .index("by_linq_chat_id", ["linqChatId"]),

  policies: defineTable({
    userId: v.id("users"),
    category: v.union(
      v.literal("auto"),
      v.literal("tenant"),
      v.literal("other")
    ),
    documentType: v.union(v.literal("policy"), v.literal("quote")),
    carrier: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    premium: v.optional(v.string()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    coverages: v.optional(v.any()),
    rawExtracted: v.optional(v.any()),
    pdfStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  messages: defineTable({
    userId: v.id("users"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    body: v.string(),
    hasAttachment: v.boolean(),
    openPhoneId: v.optional(v.string()),
    channel: v.optional(v.string()), // "openphone" | "linq"
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_openphone_id", ["openPhoneId"]),
  // Dedup lock table — prevents duplicate webhook processing
  webhookLocks: defineTable({
    openPhoneId: v.string(),
    processedAt: v.number(),
  }).index("by_openphone_id", ["openPhoneId"]),
});
