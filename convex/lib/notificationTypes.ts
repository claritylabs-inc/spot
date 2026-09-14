// convex/lib/notificationTypes.ts

import dayjs from "dayjs";
import { v, type Infer } from "convex/values";

export const notificationActionTypeValidator = v.union(
  v.literal("view_policy"),
  v.literal("view_thread"),
  v.literal("view_vendor_compliance"),
);

export const notificationActionPayloadValidator = v.union(
  v.object({ policyId: v.id("policies"), tab: v.optional(v.string()) }),
  v.object({
    threadId: v.id("threads"),
    draftId: v.optional(v.id("pendingEmails")),
    vendorOrgId: v.optional(v.id("organizations")),
  }),
  v.object({
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
  }),
);

export const notificationSourceRefValidator = v.union(
  v.object({ policyId: v.id("policies"), kind: v.literal("extraction_review") }),
  v.object({
    accountId: v.id("connectedEmailAccounts"),
    messageKeys: v.array(v.string()),
  }),
  v.object({ orgId: v.id("organizations"), source: v.literal("mailbox_compliance") }),
  v.object({
    threadId: v.id("threads"),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
  }),
  v.object({
    relationshipId: v.id("connectedOrgRelationships"),
    vendorOrgId: v.id("organizations"),
  }),
);

export type NotificationActionType = Infer<typeof notificationActionTypeValidator>;
export type NotificationActionPayload = Infer<
  typeof notificationActionPayloadValidator
>;
export type NotificationSourceRef = Infer<typeof notificationSourceRefValidator>;

export function notificationActionHref(
  actionType: NotificationActionType | undefined,
  payload: NotificationActionPayload | undefined,
): string | undefined {
  if (!payload) return undefined;
  if (actionType === "view_policy" && "policyId" in payload) {
    return `/policies/${payload.policyId}${payload.tab ? `?tab=${encodeURIComponent(payload.tab)}` : ""}`;
  }
  if (actionType === "view_thread" && "threadId" in payload) {
    return `/agent/thread/${payload.threadId}`;
  }
  if (actionType === "view_vendor_compliance" && "relationshipId" in payload) {
    return "/connect/vendors";
  }
  return undefined;
}

export const ACTIVE_NOTIFICATION_TYPES = [
  "broker_action",
  "incomplete_extraction",
  "mailbox_attention",
  "own_compliance_gap",
  "own_compliance_resolved",
  "client_invitation_accepted",
  "client_onboarding_completed",
  "vendor_compliance_met",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
] as const;

// Kept out of settings and active notify contracts. The schema still accepts
// these values so older notification rows remain readable.
export const RETIRED_NOTIFICATION_TYPES = [
  "merge_suggestion",
  "policy_declaration_discrepancy",
  "coverage_gap",
  "renewal_reminder",
  "policy_lapsed",
  "coverage_limit_concern",
  "missing_coverage",
  "carrier_rating_change",
  "extraction_complete",
  "extraction_error",
  "stale_data",
  "premium_anomaly",
  "client_document_uploaded",
  "policy_delivered_by_broker",
  "policy_change_needs_info",
  "policy_change_completed",
] as const;

export const ALL_NOTIFICATION_TYPES = [
  ...ACTIVE_NOTIFICATION_TYPES,
  ...RETIRED_NOTIFICATION_TYPES,
] as const;

export const activeNotificationTypeValidator = v.union(
  ...ACTIVE_NOTIFICATION_TYPES.map((type) => v.literal(type)),
);
export const storedNotificationTypeValidator = v.union(
  ...ALL_NOTIFICATION_TYPES.map((type) => v.literal(type)),
);

export type NotificationType = (typeof ACTIVE_NOTIFICATION_TYPES)[number];
export type StoredNotificationType = (typeof ALL_NOTIFICATION_TYPES)[number];

export type NotificationSeverity = "info" | "warning" | "critical";

export const PROACTIVE_PREFERENCE_TYPE = "__proactive__";

export const PROACTIVE_NOTIFICATION_TYPES = [
  "mailbox_attention",
  "own_compliance_gap",
  "own_compliance_resolved",
  "vendor_compliance_met",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
] as const satisfies readonly NotificationType[];

const PROACTIVE_NOTIFICATION_TYPE_SET = new Set<NotificationType>(
  PROACTIVE_NOTIFICATION_TYPES,
);

export function isProactiveNotificationType(
  type: string,
): type is (typeof PROACTIVE_NOTIFICATION_TYPES)[number] {
  return PROACTIVE_NOTIFICATION_TYPE_SET.has(type as NotificationType);
}

const SLACK_SAFE_NOTIFICATION_TYPES = new Set<NotificationType>([
  "own_compliance_gap",
  "own_compliance_resolved",
]);

const SLACK_VENDOR_NOTIFICATION_TYPES = new Set<NotificationType>([
  "vendor_compliance_met",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
]);

export function slackNotificationCategory(
  type: NotificationType,
): "safe" | "vendor" | null {
  if (SLACK_SAFE_NOTIFICATION_TYPES.has(type)) return "safe";
  if (SLACK_VENDOR_NOTIFICATION_TYPES.has(type)) return "vendor";
  return null;
}

export const NOTIFICATION_SEVERITY: Record<StoredNotificationType, NotificationSeverity> = {
  merge_suggestion: "info",
  policy_declaration_discrepancy: "warning",
  broker_action: "info",
  incomplete_extraction: "warning",
  mailbox_attention: "warning",
  own_compliance_gap: "warning",
  own_compliance_resolved: "info",
  client_invitation_accepted: "info",
  client_onboarding_completed: "info",
  vendor_compliance_met: "info",
  vendor_compliance_gap: "warning",
  vendor_policy_expiring: "warning",
  vendor_policy_expired: "critical",
  coverage_gap: "warning",
  renewal_reminder: "warning",
  policy_lapsed: "critical",
  coverage_limit_concern: "warning",
  missing_coverage: "warning",
  carrier_rating_change: "warning",
  extraction_complete: "info",
  extraction_error: "warning",
  stale_data: "info",
  premium_anomaly: "warning",
  client_document_uploaded: "info",
  policy_delivered_by_broker: "info",
  policy_change_needs_info: "info",
  policy_change_completed: "info",
};

/** Active notification types that coalesce. Value is window in ms. */
export const COALESCE_WINDOW_MS: Partial<Record<NotificationType, number>> = {
  mailbox_attention: 24 * 60 * 60 * 1000,
  own_compliance_gap: 24 * 60 * 60 * 1000,
  own_compliance_resolved: 24 * 60 * 60 * 1000,
  vendor_compliance_met: 24 * 60 * 60 * 1000,
  vendor_compliance_gap: 24 * 60 * 60 * 1000,
  vendor_policy_expiring: 24 * 60 * 60 * 1000,
  vendor_policy_expired: 24 * 60 * 60 * 1000,
};

/**
 * Build a stable coalesce key from an array of parts and the configured time bucket.
 * @param parts   e.g. ["vendor_compliance_gap", clientOrgId, relationshipId]
 * @param windowMs  the coalesce window in ms (from COALESCE_WINDOW_MS)
 * @param nowMs   current timestamp in ms (injectable for tests)
 */
export function buildCoalesceKey(
  parts: string[],
  windowMs: number,
  nowMs: number = dayjs().valueOf(),
): string {
  const bucket = Math.floor(nowMs / windowMs);
  return [...parts, String(bucket)].join(":");
}

/** Returns true when the type's severity triggers email by default. */
export function getEffectiveEmailDefault(severity: NotificationSeverity): boolean {
  return severity === "warning" || severity === "critical";
}

export type NotificationChannel = "email" | "imessage";

export function getEffectiveChannelDefault(
  channel: NotificationChannel,
  severity: NotificationSeverity,
): boolean {
  if (channel === "email") return getEffectiveEmailDefault(severity);
  return false;
}

export type NotificationSettingsAudience = "broker" | "client";

export interface NotificationSettingsRow {
  type: NotificationType;
  label: string;
  group: string;
  audiences: readonly NotificationSettingsAudience[];
}

export const NOTIFICATION_SETTINGS_ROWS: readonly NotificationSettingsRow[] = [
  {
    type: "mailbox_attention",
    label: "Mailbox items need attention",
    group: "Mailbox",
    audiences: ["broker", "client"],
  },
  {
    type: "own_compliance_gap",
    label: "Your insurance has a compliance gap",
    group: "Your insurance",
    audiences: ["broker", "client"],
  },
  {
    type: "own_compliance_resolved",
    label: "Your insurance becomes compliant",
    group: "Your insurance",
    audiences: ["broker", "client"],
  },
  {
    type: "client_invitation_accepted",
    label: "Client accepted invitation",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "client_onboarding_completed",
    label: "Client completed onboarding",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "broker_action",
    label: "Broker action needed",
    group: "Client activity",
    audiences: ["broker"],
  },
  {
    type: "incomplete_extraction",
    label: "Policy extraction needs review",
    group: "Policies",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_compliance_gap",
    label: "Vendor compliance gaps",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_policy_expiring",
    label: "Vendor policy expiring",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_policy_expired",
    label: "Vendor policy expired",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
  {
    type: "vendor_compliance_met",
    label: "Vendor becomes compliant",
    group: "Vendor compliance",
    audiences: ["broker", "client"],
  },
];

export function getNotificationSettingsRows(
  audience: NotificationSettingsAudience,
): NotificationSettingsRow[] {
  return NOTIFICATION_SETTINGS_ROWS.filter((row) =>
    row.audiences.includes(audience),
  );
}
