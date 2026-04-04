import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    state: v.optional(v.string()), // "awaiting_category" | "awaiting_policy" | "awaiting_email" | "awaiting_email_confirm" | "active"
    preferredCategory: v.optional(v.string()),
    uploadToken: v.optional(v.string()),
    linqChatId: v.optional(v.string()), // Linq chat ID for ongoing conversation
    imessageSender: v.optional(v.string()), // iMessage bridge sender (phone or email)
    lastImageId: v.optional(v.id("_storage")), // most recent image for contextual vision Q&A
    autoSendEmails: v.optional(v.boolean()), // skip confirmation for email actions
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_phone", ["phone"])
    .index("by_upload_token", ["uploadToken"])
    .index("by_linq_chat_id", ["linqChatId"])
    .index("by_imessage_sender", ["imessageSender"]),

  policies: defineTable({
    userId: v.id("users"),
    category: v.string(), // "auto", "renters", "homeowners", "flood", "umbrella", "pet", "travel", "earthquake", "recreational", "farm", "commercial", "other"
    policyTypes: v.optional(v.array(v.string())), // SDK granular types e.g. ["homeowners_ho3"], ["personal_auto"]
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
    channel: v.optional(v.string()), // "openphone" | "linq" | "email"
    imageStorageId: v.optional(v.id("_storage")), // image attachment stored for vision context
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_openphone_id", ["openPhoneId"]),

  // Pending emails awaiting user confirmation or undo window
  pendingEmails: defineTable({
    userId: v.id("users"),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    htmlBody: v.string(),
    ccEmail: v.optional(v.string()), // user's email for CC
    purpose: v.string(), // "proof_of_insurance" | "coverage_details" | "coi" | "general_info"
    coiPdfStorageId: v.optional(v.id("_storage")), // generated COI PDF attachment
    status: v.string(), // "awaiting_confirmation" | "scheduled" | "sent" | "cancelled" | "undone"
    scheduledFunctionId: v.optional(v.string()), // Convex scheduler ID for delayed send (stored as string)
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Expiration reminders
  reminders: defineTable({
    userId: v.id("users"),
    policyId: v.id("policies"),
    triggerDate: v.number(), // timestamp when to send reminder
    daysBefore: v.number(), // how many days before expiration
    status: v.string(), // "pending" | "sent" | "cancelled"
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status_trigger", ["status", "triggerDate"]),

  // Email thread tracking — maps outbound emails to users so inbound replies route correctly
  emailThreads: defineTable({
    userId: v.id("users"),
    pendingEmailId: v.id("pendingEmails"),
    outboundMessageId: v.string(), // Resend message_id from the sent email (e.g. "<abc123@resend.dev>")
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    fromAddress: v.string(), // e.g. "spot+abc123@spot.claritylabs.inc"
    status: v.string(), // "active" | "closed"
    lastActivityAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_from_address", ["fromAddress"])
    .index("by_user", ["userId"])
    .index("by_outbound_message_id", ["outboundMessageId"]),

  // Dedup lock table — prevents duplicate webhook processing
  webhookLocks: defineTable({
    openPhoneId: v.string(),
    processedAt: v.number(),
  }).index("by_openphone_id", ["openPhoneId"]),
});
