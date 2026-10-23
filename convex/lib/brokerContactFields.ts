import { v } from "convex/values";

export const brokerContactRole = v.union(
  v.literal("general"),
  v.literal("submissions"),
  v.literal("underwriting"),
  v.literal("claims"),
  v.literal("billing"),
  v.literal("other"),
);
export const BROKER_CONTACT_ROLE_LABELS = {
  general: "General inquiries",
  submissions: "Submissions",
  underwriting: "Underwriting",
  claims: "Claims",
  billing: "Billing",
  other: "Other",
} as const;
export const brokerContactFields = {
  name: v.string(),
  title: v.optional(v.string()),
  role: brokerContactRole,
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  contactUrl: v.optional(v.string()),
  lineOfBusinessCodes: v.array(v.string()),
  notes: v.optional(v.string()),
  sources: v.array(v.string()),
  sourceQuote: v.optional(v.string()),
  sourceKind: v.union(v.literal("manual"), v.literal("research")),
};
