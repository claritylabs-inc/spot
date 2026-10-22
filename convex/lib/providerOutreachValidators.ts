import { v, type Infer } from "convex/values";
import { RESEND_IDEMPOTENCY_SAFE_RETRY_MS } from "./resendInbox";
import { emailContentValidator } from "./threadMessageValidators";

/**
 * Shared validators and constants for the provider-outreach durable state
 * owner (`convex/providerOutreach.ts`). The Node actions in
 * `convex/actions/providerOutreach.ts` consume these as their internal
 * query/mutation contracts; keep argument shapes here, not inline.
 */

export const STEP_LEASE_MS = 5 * 60 * 1000;
export const MAX_STEP_ATTEMPTS = 3;
/** Unknown-outcome retries reuse idempotency keys only inside this window. */
export const DELIVERY_RETRY_WINDOW_MS = RESEND_IDEMPOTENCY_SAFE_RETRY_MS;
export const REPLY_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
export const CADENCE_PENDING_TIMEOUT_MS = 5 * 60 * 1000;
/** How long a follow-up waits for the first email's thread id before failing. */
export const THREAD_WAIT_LIMIT_MS = 60 * 60 * 1000;
/** How long a webhook event may wait for its outbound email/thread mapping. */
export const INBOX_EVENT_MAPPING_WINDOW_MS = 10 * 60 * 1000;
export const INBOX_EVENT_RETRY_MS = 20 * 1000;
export const INBOX_EVENT_GIVE_UP_MS = 24 * 60 * 60 * 1000;
export const INBOX_EVENT_LEASE_MS = 5 * 60 * 1000;
export const IMPERSONATION_DEFER_MS = 5 * 60 * 1000;
export { MAX_LAUNCH_PROVIDERS } from "./providerOutreachSchedule";
export const MAX_PANEL_PROVIDERS = 500;
export const MAX_PANEL_SEQUENCES = 200;
export const MAX_CONTACTS_PER_PROVIDER = 20;
export const LAUNCH_STAGGER_MS = 2000;

export const outreachStyleValidator = v.union(
  v.literal("brief_nudge"),
  v.literal("concise_recap"),
  v.literal("detailed_recap"),
);
export const outreachCadenceValidator = v.object({
  followUpCount: v.number(),
  intervalBusinessDays: v.number(),
  style: outreachStyleValidator,
});
export type OutreachCadenceInput = Infer<typeof outreachCadenceValidator>;
const cadenceFieldSource = v.union(
  v.literal("jev"),
  v.literal("default"),
  v.literal("operator"),
);
export const outreachCadenceSourceValidator = v.object({
  followUpCount: cadenceFieldSource,
  intervalBusinessDays: cadenceFieldSource,
  style: cadenceFieldSource,
});
export type OutreachCadenceSource = Infer<typeof outreachCadenceSourceValidator>;

const pickSource = v.union(v.literal("jev"), v.literal("default"));
/** Mirrors `procurementOutreachCadences.picks`. */
export const cadencePicksValidator = v.object({
  followUpCount: v.object({
    value: v.number(),
    confidence: v.number(),
    source: pickSource,
  }),
  intervalBusinessDays: v.object({
    value: v.number(),
    confidence: v.number(),
    source: pickSource,
  }),
  style: v.object({
    value: outreachStyleValidator,
    confidence: v.number(),
    source: pickSource,
  }),
});

export const stepDraftValidator = v.object({
  subject: v.string(),
  text: v.string(),
  html: v.string(),
  source: v.union(v.literal("llm"), v.literal("template"), v.literal("operator")),
});
export type StepDraft = Infer<typeof stepDraftValidator>;

export const inboxRecordValidator = v.object({
  inboxId: v.string(),
  emailAddress: v.string(),
  fromName: v.string(),
  labelIds: v.object({ automated: v.string(), needsReply: v.string() }),
});
export type InboxRecord = Infer<typeof inboxRecordValidator>;

/** `captured` makes no Resend call; it never sets a real sent time. */
export const stepFinishOutcomeValidator = v.union(
  v.object({
    kind: v.literal("sent"),
    resendEmailId: v.string(),
    resendThreadId: v.optional(v.string()),
    resendDraftId: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("captured") }),
);
export type StepFinishOutcome = Infer<typeof stepFinishOutcomeValidator>;

export const stepFailureValidator = v.object({
  /** Mirrors `ResendInboxErrorOutcome`. */
  kind: v.union(
    v.literal("transient"),
    v.literal("unknown"),
    v.literal("permanent"),
    v.literal("blocked"),
  ),
  message: v.string(),
  retryAfterMs: v.optional(v.number()),
});
export type StepFailure = Infer<typeof stepFailureValidator>;

export const inboxEventTypeValidator = v.union(
  v.literal("inbox.email.received"),
  v.literal("inbox.email.sent"),
);

/** A thread email already fetched from Resend (`getThreadEmail`) by the action. */
export const inboxEmailValidator = v.object({
  resendInboxEmailId: v.string(),
  fromEmail: v.string(),
  fromName: v.optional(v.string()),
  toAddresses: v.array(v.string()),
  ccAddresses: v.array(v.string()),
  bccAddresses: v.array(v.string()),
  subject: v.string(),
  messageId: v.optional(v.string()),
  inReplyTo: v.optional(v.string()),
  references: v.array(v.string()),
  text: v.string(),
  forwarded: emailContentValidator.fields.forwarded,
  html: v.optional(v.string()),
  /** Epoch ms of the Resend `received_at`. */
  occurredAt: v.number(),
});
export type InboxEmail = Infer<typeof inboxEmailValidator>;

/** Attachment already uploaded to Convex storage by the action. */
export const inboxAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
});

export const replyClassificationValidator = v.union(
  /** Confident auto-reply and not unmonitored: resume follow-ups. */
  v.object({ kind: v.literal("resume") }),
  /** Confident unmonitored recipient: stop. */
  v.object({ kind: v.literal("unmonitored") }),
  /** Anything else, including router failure: hand to the operator. */
  v.object({ kind: v.literal("needs_reply") }),
);
