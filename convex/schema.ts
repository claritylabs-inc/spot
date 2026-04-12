import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    phone: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    state: v.optional(v.string()), // "awaiting_category" | "awaiting_policy" | "awaiting_email" | "awaiting_email_confirm" | "awaiting_insurance_slip" | "awaiting_merge_confirm" | "awaiting_app_questions" | "awaiting_app_confirm" | "active"
    preferredCategory: v.optional(v.string()),
    uploadToken: v.optional(v.string()),
    linqChatId: v.optional(v.string()), // Linq chat ID for ongoing conversation
    imessageSender: v.optional(v.string()), // iMessage bridge sender (phone or email)
    lastImageId: v.optional(v.id("_storage")), // most recent image for contextual vision Q&A
    autoSendEmails: v.optional(v.boolean()), // skip confirmation for email actions
    pendingMergePolicyId: v.optional(v.id("policies")), // existing policy to merge into
    pendingMergeStorageId: v.optional(v.id("_storage")), // new PDF waiting to be merged
    activeApplicationId: v.optional(v.id("applications")), // currently active application being filled
    autoFillApplications: v.optional(v.boolean()), // skip confirmation for application filling (/autofill on)
    portfolioAnalysis: v.optional(v.any()), // { overlaps[], gaps[], suggestions[], naturalSummary, generatedAt }
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
    insuranceSlipStorageId: v.optional(v.id("_storage")), // existing insurance slip (auto/home) uploaded by user
    analysis: v.optional(v.any()), // health check: { strengths[], gaps[], exclusionHighlights[], lowLimits[], naturalSummary, generatedAt }
    extractionReport: v.optional(v.any()), // CL SDK v0.10 ExtractionReviewReport — review rounds, form inventory, quality gate status
    extractionUsage: v.optional(v.any()), // CL SDK v0.10 { tokenUsage, usageReporting: { modelCalls, callsWithUsage, callsMissingUsage } }
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

  // Saved contacts — auto-learned from email sends
  contacts: defineTable({
    userId: v.id("users"),
    name: v.string(), // contact name (e.g. "John", "my landlord")
    email: v.string(), // contact email
    label: v.optional(v.string()), // optional role label (e.g. "landlord", "property manager", "agent")
    lastUsedAt: v.number(), // last time this contact was emailed
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_email", ["userId", "email"]),

  // Insurance applications — tracks uploaded applications being filled (SDK ApplicationState)
  applications: defineTable({
    userId: v.id("users"),
    pdfStorageId: v.id("_storage"), // original application PDF
    filledPdfStorageId: v.optional(v.id("_storage")), // filled application PDF
    status: v.string(), // SDK: "classifying"|"extracting"|"auto_filling"|"batching"|"collecting"|"confirming"|"mapping"|"complete"|"failed"
    fields: v.optional(v.any()), // ApplicationField[] from SDK
    answers: v.optional(v.any()), // Record<fieldId, { value, source }> — legacy compat for process.ts question handler
    batches: v.optional(v.any()), // string[][] — field ID batches from SDK batcher
    currentBatchIndex: v.optional(v.number()), // 0-indexed batch number (SDK field name)
    title: v.optional(v.string()), // application title
    applicationType: v.optional(v.string()), // detected application type
    carrier: v.optional(v.string()),
    reviewReport: v.optional(v.any()), // CL SDK v0.10 ApplicationQualityReport — quality issues, rounds, gate status
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // Per-user agent memory — persistent context that grows over time
  userMemory: defineTable({
    userId: v.id("users"),
    type: v.string(), // "fact" | "preference" | "risk_note" | "event" | "interaction"
    content: v.string(),
    source: v.string(), // "policy_extraction" | "analysis" | "conversation" | "email" | "system"
    policyId: v.optional(v.id("policies")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"]),

  // Proactive alerts — tracks what was sent to avoid duplicates
  proactiveAlerts: defineTable({
    userId: v.id("users"),
    alertType: v.string(), // "health_check" | "portfolio" | "renewal_comparison" | "seasonal" | "milestone" | "expiration_nudge"
    policyId: v.optional(v.id("policies")),
    relatedPolicyId: v.optional(v.id("policies")),
    summary: v.string(),
    metadata: v.optional(v.any()),
    status: v.string(), // "sent" | "suppressed"
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_type_user", ["alertType", "userId"]),

  // Document chunks — extraction chunks with embeddings for vector search
  documentChunks: defineTable({
    policyId: v.id("policies"),
    userId: v.id("users"),
    chunkId: v.string(), // SDK-generated deterministic ID e.g. "doc-123:coverage:2"
    documentId: v.string(), // SDK document ID
    type: v.string(), // "carrier_info" | "named_insured" | "coverage" | "endorsement" | "exclusion" | "condition" | "section" | "declaration" | "loss_history" | "premium" | "supplementary"
    text: v.string(), // Human-readable text for embedding/search
    metadata: v.optional(v.any()), // Structured metadata for filtering
    embedding: v.optional(v.array(v.float64())), // OpenAI text-embedding-3-small vector
    createdAt: v.number(),
  })
    .index("by_policy", ["policyId"])
    .index("by_user", ["userId"])
    .index("by_chunk_id", ["chunkId"])
    .index("by_user_type", ["userId", "type"]),

  // Conversation turns — for query agent context and history search
  conversationTurns: defineTable({
    userId: v.id("users"),
    conversationId: v.string(), // phone number or session ID
    role: v.string(), // "user" | "assistant" | "tool"
    content: v.string(),
    toolName: v.optional(v.string()),
    toolResult: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())), // for semantic history search
    timestamp: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"]),

  // Dedup lock table — prevents duplicate webhook processing
  webhookLocks: defineTable({
    openPhoneId: v.string(),
    processedAt: v.number(),
  }).index("by_openphone_id", ["openPhoneId"]),
});
