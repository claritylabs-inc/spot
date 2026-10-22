import { z } from "zod";
import { extractEmailAddress } from "./emailAddress";
import {
  evaluateRecipientDeliveryPolicy,
  getEmailDeliveryMode,
  logLocalEmailCapture,
} from "./resend";

/**
 * Fetch transport for the Resend Inboxes API (https://resend.com/docs/api-reference/inboxes).
 *
 * Inbox sends never pass through `sendResendEmail`, so this module enforces
 * `EMAIL_DELIVERY_MODE` itself:
 * - `capture`: no outbound call of any kind (sends, reads, inbox/label setup).
 *   Every operation resolves to `{ status: "captured" }`.
 * - `restricted`: sends are blocked unless every actual recipient is in the
 *   allowlist (`EMAIL_ALLOWED_RECIPIENTS` / `EMAIL_ALLOWED_RECIPIENT_DOMAINS`).
 *   Inbox mail cannot be redirected, so it is never rewritten.
 * - `live`: pass through.
 *
 * Sends and draft creation require an `Idempotency-Key`. Resend keeps keys for
 * 24 hours, so callers must not replay a possibly-sent key after
 * `RESEND_IDEMPOTENCY_SAFE_RETRY_MS`.
 */

const RESEND_API_BASE = "https://api.resend.com";
const REQUEST_TIMEOUT_MS = 30_000;

/** Replay window with a safety margin below Resend's 24h key expiry. */
export const RESEND_IDEMPOTENCY_SAFE_RETRY_MS = 23 * 60 * 60 * 1000;

export const OUTREACH_INBOX_LABEL_NAMES = {
  automated: "Spot automated",
  needsReply: "Needs reply",
} as const;

// --- Errors -----------------------------------------------------------------

/**
 * - `transient`: Resend definitely did not accept the request (429, 503, lock
 *   contention). Retry later, with the same idempotency key for sends.
 * - `unknown`: the request may have been processed (no response, timeout,
 *   malformed 2xx body, 5xx on a write). Only retry with the same idempotency
 *   key and the same body, within `RESEND_IDEMPOTENCY_SAFE_RETRY_MS`.
 * - `permanent`: the request was rejected and will not succeed unchanged.
 * - `blocked`: refused locally by `EMAIL_DELIVERY_MODE=restricted`; nothing
 *   was sent.
 */
export type ResendInboxErrorOutcome =
  | "transient"
  | "unknown"
  | "permanent"
  | "blocked";

export class ResendInboxError extends Error {
  readonly outcome: ResendInboxErrorOutcome;
  readonly operation: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(
    outcome: ResendInboxErrorOutcome,
    operation: string,
    message: string,
    details: { status?: number; code?: string; retryAfterMs?: number } = {},
  ) {
    super(`Resend inbox ${operation}: ${message}`);
    this.name = "ResendInboxError";
    this.outcome = outcome;
    this.operation = operation;
    this.status = details.status;
    this.code = details.code;
    this.retryAfterMs = details.retryAfterMs;
  }

  /** Safe to retry (same idempotency key for sends). */
  get retryable(): boolean {
    return this.outcome === "transient" || this.outcome === "unknown";
  }
}

export function isResendInboxError(error: unknown): error is ResendInboxError {
  return error instanceof ResendInboxError;
}

// --- Results ----------------------------------------------------------------

export type ResendInboxOperation =
  | "createInbox"
  | "getInbox"
  | "ensureInbox"
  | "listLabels"
  | "createLabel"
  | "ensureLabels"
  | "createDraft"
  | "getDraft"
  | "sendDraft"
  | "replyToThreadEmail"
  | "getThreadEmail"
  | "listThreadEmails"
  | "addThreadLabels"
  | "setThreadLabels";

export type ResendInboxResult<T> =
  | {
      status: "ok";
      data: T;
      /** `idempotent-replayed: true` was returned: the first response was reused. */
      replayed: boolean;
    }
  | {
      status: "captured";
      operation: ResendInboxOperation;
      captureId: string;
    };

export function isCaptured<T>(
  result: ResendInboxResult<T>,
): result is Extract<ResendInboxResult<T>, { status: "captured" }> {
  return result.status === "captured";
}

const CAPTURED_ID_PREFIX = "captured:";

/** Synthetic, recognisable id for a resource that capture mode never created. */
export function capturedResourceId(kind: string, key: string): string {
  return `${CAPTURED_ID_PREFIX}${kind}:${key}`;
}

export function isCapturedResourceId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(CAPTURED_ID_PREFIX));
}

function captured(
  operation: ResendInboxOperation,
  key: string,
): Extract<ResendInboxResult<never>, { status: "captured" }> {
  console.log("[resend-inbox] Captured without calling Resend", { operation });
  return {
    status: "captured",
    operation,
    captureId: capturedResourceId(operation, key),
  };
}

// --- Domain types (camelCase projection of the wire shapes) ------------------

export type ResendInbox = {
  id: string;
  name: string | null;
  emailAddress: string;
  domainId: string | null;
  receivingAddress: string | null;
  fromName: string | null;
  unread: number;
  drafts: number;
  lastReceived: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResendInboxLabel = { id: string; name: string; color: string };

export type ResendInboxAttachment = {
  id: string;
  filename: string | null;
  size: number | null;
};

export type ResendThreadEmail = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subject: string | null;
  messageId: string | null;
  html: string | null;
  text: string | null;
  attachments: ResendInboxAttachment[];
  read: boolean;
  receivedAt: string;
};

type ResendInboxDraft = {
  id: string;
  type: "reply" | "standalone";
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  threadId: string | null;
  replyToEmailId: string | null;
  /** Null until the draft is sent. */
  emailId: string | null;
};

// --- Wire schemas -----------------------------------------------------------

const defaulted = <T extends z.ZodType, F>(schema: T, fallback: F) =>
  schema.nullish().transform((v) => v ?? fallback);
const nullableString = defaulted(z.string(), null);
const stringList = defaulted(z.array(z.string()), [] as string[]);

const labelWireSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

const idWireSchema = z.object({ id: z.string() });

const inboxWireSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    email_address: z.string(),
    domain_id: nullableString,
    receiving_address: nullableString,
    from_name: nullableString,
    unread: defaulted(z.number(), 0),
    drafts: defaulted(z.number(), 0),
    last_received: nullableString,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform(
    (w): ResendInbox => ({
      id: w.id,
      name: w.name,
      emailAddress: w.email_address,
      domainId: w.domain_id,
      receivingAddress: w.receiving_address,
      fromName: w.from_name,
      unread: w.unread,
      drafts: w.drafts,
      lastReceived: w.last_received,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }),
  );

const labelListWireSchema = z
  .object({ data: z.array(labelWireSchema) })
  .transform((w) => w.data);

const threadWireSchema = z.object({
  id: z.string(),
  subject: nullableString,
  folder: z.enum(["inbox", "archive", "spam", "trash", "sent"]),
  labels: defaulted(z.array(labelWireSchema), []),
  read: z.boolean(),
});

const attachmentWireSchema = z.object({
  id: z.string(),
  filename: nullableString,
  size: defaulted(z.number(), null),
});

const threadEmailBaseSchema = z.object({
  id: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  from: z.string(),
  to: stringList,
  cc: stringList,
  bcc: stringList,
  reply_to: stringList,
  subject: nullableString,
  message_id: nullableString,
  html: nullableString,
  text: nullableString,
  attachments: defaulted(z.array(attachmentWireSchema), []),
  read: defaulted(z.boolean(), false),
  received_at: z.string(),
});

function projectThreadEmail(
  w: z.output<typeof threadEmailBaseSchema>,
): ResendThreadEmail {
  return {
    id: w.id,
    direction: w.direction,
    from: w.from,
    to: w.to,
    cc: w.cc,
    bcc: w.bcc,
    replyTo: w.reply_to,
    subject: w.subject,
    messageId: w.message_id,
    html: w.html,
    text: w.text,
    attachments: w.attachments,
    read: w.read,
    receivedAt: w.received_at,
  };
}

const threadEmailWireSchema =
  threadEmailBaseSchema.transform(projectThreadEmail);

const threadEmailListWireSchema = z
  .object({
    has_more: defaulted(z.boolean(), false),
    data: z.array(threadEmailBaseSchema),
  })
  .transform((w) => ({
    hasMore: w.has_more,
    emails: w.data.map(projectThreadEmail),
  }));

const draftWireSchema = z
  .object({
    id: z.string(),
    type: z.enum(["reply", "standalone"]),
    to: stringList,
    cc: stringList,
    bcc: stringList,
    subject: nullableString,
    html: nullableString,
    text: nullableString,
    thread_id: nullableString,
    reply_to_email_id: nullableString,
    email_id: nullableString,
  })
  .transform(
    (w): ResendInboxDraft => ({
      id: w.id,
      type: w.type,
      to: w.to,
      cc: w.cc,
      bcc: w.bcc,
      subject: w.subject,
      html: w.html,
      text: w.text,
      threadId: w.thread_id,
      replyToEmailId: w.reply_to_email_id,
      emailId: w.email_id,
    }),
  );

// --- Request core -----------------------------------------------------------

type RequestOptions = {
  operation: ResendInboxOperation;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
};

function seg(value: string): string {
  return encodeURIComponent(value);
}

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function readErrorBody(
  res: Response,
): Promise<{ name?: string; message: string }> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const nested =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : parsed;
    const name = typeof nested.name === "string" ? nested.name : undefined;
    const message =
      typeof nested.message === "string" ? nested.message : text.slice(0, 500);
    return { name, message: message || res.statusText };
  } catch {
    return { message: text.slice(0, 500) || res.statusText };
  }
}

function classifyHttpError(
  options: RequestOptions,
  status: number,
  name: string | undefined,
  message: string,
  retryAfterMs: number | undefined,
): ResendInboxError {
  const details = { status, code: name, retryAfterMs };
  const isWrite = options.method !== "GET";
  if (status === 429) {
    // Monthly quota will not clear on its own within any retry horizon.
    return new ResendInboxError(
      name === "monthly_quota_exceeded" ? "permanent" : "transient",
      options.operation,
      message,
      details,
    );
  }
  if (
    status === 409 &&
    (name === "concurrent_idempotent_requests" || name === "resource_locked")
  ) {
    return new ResendInboxError("transient", options.operation, message, {
      ...details,
      retryAfterMs: retryAfterMs ?? 2_000,
    });
  }
  if (status === 408 || status === 425 || status === 503) {
    return new ResendInboxError(
      "transient",
      options.operation,
      message,
      details,
    );
  }
  if (status >= 500) {
    return new ResendInboxError(
      isWrite ? "unknown" : "transient",
      options.operation,
      message,
      details,
    );
  }
  return new ResendInboxError("permanent", options.operation, message, details);
}

async function request<T>(
  options: RequestOptions,
  schema: z.ZodType<T, unknown>,
): Promise<{ data: T; replayed: boolean }> {
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    throw new ResendInboxError(
      "permanent",
      options.operation,
      "AUTH_RESEND_KEY not set",
      { code: "not_configured" },
    );
  }

  const isWrite = options.method !== "GET";
  const url = new URL(`${RESEND_API_BASE}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // No response: a write may or may not have been processed.
    throw new ResendInboxError(
      isWrite ? "unknown" : "transient",
      options.operation,
      `no response (${error instanceof Error ? error.message : String(error)})`,
      { code: "no_response" },
    );
  }

  if (!res.ok) {
    const { name, message } = await readErrorBody(res);
    throw classifyHttpError(
      options,
      res.status,
      name,
      message,
      parseRetryAfterMs(res),
    );
  }

  const replayed = res.headers.get("idempotent-replayed") === "true";
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ResendInboxError(
      isWrite ? "unknown" : "transient",
      options.operation,
      "response body was not JSON",
      { status: res.status, code: "invalid_response" },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ResendInboxError(
      isWrite ? "unknown" : "permanent",
      options.operation,
      `unexpected response shape: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      { status: res.status, code: "invalid_response" },
    );
  }
  return { data: parsed.data, replayed };
}

async function call<T>(
  options: RequestOptions,
  schema: z.ZodType<T, unknown>,
  captureKey: string,
): Promise<ResendInboxResult<T>> {
  if (getEmailDeliveryMode() === "capture") {
    return captured(options.operation, captureKey);
  }
  const { data, replayed } = await request(options, schema);
  return { status: "ok", data, replayed };
}

// --- Input guards -----------------------------------------------------------

function invalid(
  operation: ResendInboxOperation,
  message: string,
): ResendInboxError {
  return new ResendInboxError("permanent", operation, message, {
    code: "validation_error",
  });
}

function requireIdempotencyKey(
  operation: ResendInboxOperation,
  key: string | undefined,
): string {
  if (!key || key.length < 1 || key.length > 256) {
    throw new ResendInboxError(
      "permanent",
      operation,
      "an Idempotency-Key of 1-256 characters is required",
      { code: "missing_idempotency_key" },
    );
  }
  return key;
}

function requireNonEmpty(
  operation: ResendInboxOperation,
  label: string,
  value: string,
): string {
  if (!value.trim()) throw invalid(operation, `${label} is required`);
  return value;
}

function assertRealResourceIds(
  operation: ResendInboxOperation,
  ...ids: string[]
): void {
  // Capture mode never calls Resend, so placeholder ids are expected there.
  if (getEmailDeliveryMode() === "capture") return;
  if (ids.some(isCapturedResourceId)) {
    throw new ResendInboxError(
      "permanent",
      operation,
      "refusing to use a captured placeholder id against the live API",
      { code: "captured_resource_id" },
    );
  }
}

function blockedError(
  operation: ResendInboxOperation,
  disallowed: string[],
): ResendInboxError {
  return new ResendInboxError(
    "blocked",
    operation,
    disallowed.length
      ? `restricted email delivery blocked ${disallowed.length} recipient(s)`
      : "restricted email delivery blocked a send with no recipients",
    { code: "restricted_recipient" },
  );
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// --- Inboxes ----------------------------------------------------------------

export type CreateInboxParams = {
  emailAddress: string;
  fromName?: string;
  name?: string;
};

/** `POST /inboxes`. A 409 means the address exists: `error.code === "address_in_use"`. */
export async function createInbox(
  params: CreateInboxParams,
): Promise<ResendInboxResult<{ id: string }>> {
  const operation = "createInbox";
  requireNonEmpty(operation, "emailAddress", params.emailAddress);
  try {
    return await call(
      {
        operation,
        method: "POST",
        path: "/inboxes",
        body: {
          email_address: params.emailAddress,
          ...(params.name ? { name: params.name } : {}),
          ...(params.fromName ? { from_name: params.fromName } : {}),
        },
      },
      idWireSchema,
      params.emailAddress,
    );
  } catch (error) {
    if (
      isResendInboxError(error) &&
      error.status === 409 &&
      error.outcome === "permanent"
    ) {
      throw new ResendInboxError(
        "permanent",
        operation,
        "address already exists",
        {
          status: 409,
          code: "address_in_use",
        },
      );
    }
    throw error;
  }
}

/** `GET /inboxes/{id or address}`. */
export async function getInbox(
  inboxIdOrAddress: string,
): Promise<ResendInboxResult<ResendInbox>> {
  requireNonEmpty("getInbox", "inbox", inboxIdOrAddress);
  assertRealResourceIds("getInbox", inboxIdOrAddress);
  return call(
    {
      operation: "getInbox",
      method: "GET",
      path: `/inboxes/${seg(inboxIdOrAddress)}`,
    },
    inboxWireSchema,
    inboxIdOrAddress,
  );
}

export type EnsuredInbox = {
  id: string;
  emailAddress: string;
  fromName: string | null;
  /** True when the address already existed (409) and was fetched instead of created. */
  adopted: boolean;
};

/** Create the inbox, or adopt the existing one when the address is taken. */
export async function ensureInbox(
  params: CreateInboxParams,
): Promise<ResendInboxResult<EnsuredInbox>> {
  try {
    const created = await createInbox(params);
    if (created.status === "captured") {
      return { ...created, operation: "ensureInbox" };
    }
    return {
      status: "ok",
      replayed: created.replayed,
      data: {
        id: created.data.id,
        emailAddress: params.emailAddress,
        fromName: params.fromName ?? null,
        adopted: false,
      },
    };
  } catch (error) {
    if (!isResendInboxError(error) || error.code !== "address_in_use") {
      throw error;
    }
  }
  const existing = await getInbox(params.emailAddress);
  if (existing.status === "captured") {
    return { ...existing, operation: "ensureInbox" };
  }
  return {
    status: "ok",
    replayed: false,
    data: {
      id: existing.data.id,
      emailAddress: existing.data.emailAddress,
      fromName: existing.data.fromName,
      adopted: true,
    },
  };
}

// --- Labels -----------------------------------------------------------------

/** `GET /inboxes/{id}/labels`. The API documents no pagination. */
export function listLabels(
  inboxId: string,
): Promise<ResendInboxResult<ResendInboxLabel[]>> {
  assertRealResourceIds("listLabels", inboxId);
  return call(
    {
      operation: "listLabels",
      method: "GET",
      path: `/inboxes/${seg(inboxId)}/labels`,
    },
    labelListWireSchema,
    inboxId,
  );
}

/** `POST /inboxes/{id}/labels`. A duplicate name (case-insensitive) is a 422. */
export function createLabel(
  inboxId: string,
  label: { name: string; color?: string },
): Promise<ResendInboxResult<{ id: string }>> {
  assertRealResourceIds("createLabel", inboxId);
  requireNonEmpty("createLabel", "name", label.name);
  return call(
    {
      operation: "createLabel",
      method: "POST",
      path: `/inboxes/${seg(inboxId)}/labels`,
      body: {
        name: label.name,
        ...(label.color ? { color: label.color } : {}),
      },
    },
    idWireSchema,
    `${inboxId}:${label.name}`,
  );
}

/**
 * Resolve label ids by name, creating the missing ones. Resend answers a
 * duplicate name with 422, so a lost race re-lists instead of failing.
 * Returns ids keyed by the names passed in.
 */
export async function ensureLabels(
  inboxId: string,
  names: readonly string[],
): Promise<ResendInboxResult<Record<string, string>>> {
  assertRealResourceIds("ensureLabels", inboxId);
  if (getEmailDeliveryMode() === "capture") {
    return captured("ensureLabels", `${inboxId}:${names.join("|")}`);
  }
  const findIn = (labels: ResendInboxLabel[], name: string) =>
    labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;

  const listed = await listLabels(inboxId);
  if (listed.status === "captured") {
    return { ...listed, operation: "ensureLabels" };
  }
  const ids: Record<string, string> = {};
  let current = listed.data;
  for (const name of names) {
    const existing = findIn(current, name);
    if (existing) {
      ids[name] = existing;
      continue;
    }
    try {
      const created = await createLabel(inboxId, { name });
      if (created.status === "ok") {
        ids[name] = created.data.id;
        current = [...current, { id: created.data.id, name, color: "" }];
      }
    } catch (error) {
      if (!isResendInboxError(error) || error.status !== 422) throw error;
      const relisted = await listLabels(inboxId);
      if (relisted.status !== "ok") throw error;
      current = relisted.data;
      const raced = findIn(current, name);
      if (!raced) throw error;
      ids[name] = raced;
    }
  }
  return { status: "ok", data: ids, replayed: false };
}

/** Ensure the "Spot automated" and "Needs reply" labels exist. */
export async function ensureOutreachInboxLabels(
  inboxId: string,
): Promise<ResendInboxResult<{ automated: string; needsReply: string }>> {
  const result = await ensureLabels(inboxId, [
    OUTREACH_INBOX_LABEL_NAMES.automated,
    OUTREACH_INBOX_LABEL_NAMES.needsReply,
  ]);
  if (result.status === "captured") return result;
  return {
    ...result,
    data: {
      automated: result.data[OUTREACH_INBOX_LABEL_NAMES.automated],
      needsReply: result.data[OUTREACH_INBOX_LABEL_NAMES.needsReply],
    },
  };
}

// --- Drafts and sends -------------------------------------------------------

export type CreateDraftParams = {
  inboxId: string;
  to: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Reply draft: both `threadId` and `replyToEmailId` are required together. */
  threadId?: string;
  replyToEmailId?: string;
  idempotencyKey: string;
};

/**
 * `POST /inboxes/{id}/drafts`. Nothing leaves Resend until `sendDraft`, but the
 * restricted allowlist is enforced here too so a blocked recipient never
 * produces a draft.
 */
export async function createDraft(
  params: CreateDraftParams,
): Promise<ResendInboxResult<{ id: string }>> {
  const operation = "createDraft";
  const idempotencyKey = requireIdempotencyKey(
    operation,
    params.idempotencyKey,
  );
  assertRealResourceIds(operation, params.inboxId);
  if (!params.text && !params.html) {
    throw invalid(operation, "text or html is required");
  }
  if (Boolean(params.threadId) !== Boolean(params.replyToEmailId)) {
    throw invalid(
      operation,
      "threadId and replyToEmailId must be provided together",
    );
  }

  const recipients = [
    ...asList(params.to),
    ...asList(params.cc),
    ...asList(params.bcc),
  ];
  const policy = evaluateRecipientDeliveryPolicy(recipients);
  if (policy.action === "blocked")
    throw blockedError(operation, policy.disallowed);
  if (policy.action === "capture") {
    logLocalEmailCapture({
      kind: "provider-outreach-draft",
      from: params.inboxId,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return captured(operation, idempotencyKey);
  }

  const { data, replayed } = await request(
    {
      operation,
      method: "POST",
      path: `/inboxes/${seg(params.inboxId)}/drafts`,
      idempotencyKey,
      body: {
        to: params.to,
        ...(params.cc ? { cc: params.cc } : {}),
        ...(params.bcc ? { bcc: params.bcc } : {}),
        ...(params.subject ? { subject: params.subject } : {}),
        ...(params.text ? { text: params.text } : {}),
        ...(params.html ? { html: params.html } : {}),
        ...(params.threadId
          ? {
              thread_id: params.threadId,
              reply_to_email_id: params.replyToEmailId,
            }
          : {}),
      },
    },
    idWireSchema,
  );
  return { status: "ok", data, replayed };
}

/** `GET /inboxes/{id}/drafts/{draftId}`. */
function getDraft(
  inboxId: string,
  draftId: string,
): Promise<ResendInboxResult<ResendInboxDraft>> {
  assertRealResourceIds("getDraft", inboxId, draftId);
  return call(
    {
      operation: "getDraft",
      method: "GET",
      path: `/inboxes/${seg(inboxId)}/drafts/${seg(draftId)}`,
    },
    draftWireSchema,
    `${inboxId}:${draftId}`,
  );
}

export type SendDraftParams = {
  inboxId: string;
  draftId: string;
  idempotencyKey: string;
  /** Custom headers; `In-Reply-To`, `References` and `Reply-To` are reserved. */
  headers?: Record<string, string>;
};

/**
 * `POST /inboxes/{id}/drafts/{draftId}/send`. Under `restricted` the stored
 * draft is read back and its actual recipients are checked before sending.
 * The response carries only the sent email id; the thread id arrives with the
 * `inbox.email.sent` webhook.
 */
export async function sendDraft(
  params: SendDraftParams,
): Promise<ResendInboxResult<{ emailId: string }>> {
  const operation = "sendDraft";
  const idempotencyKey = requireIdempotencyKey(
    operation,
    params.idempotencyKey,
  );
  if (getEmailDeliveryMode() === "capture") {
    return captured(operation, idempotencyKey);
  }
  assertRealResourceIds(operation, params.inboxId, params.draftId);

  if (getEmailDeliveryMode() === "restricted") {
    const draft = await getDraft(params.inboxId, params.draftId);
    if (draft.status !== "ok") return draft;
    const policy = evaluateRecipientDeliveryPolicy([
      ...draft.data.to,
      ...draft.data.cc,
      ...draft.data.bcc,
    ]);
    if (policy.action === "blocked")
      throw blockedError(operation, policy.disallowed);
  }

  const { data, replayed } = await request(
    {
      operation,
      method: "POST",
      path: `/inboxes/${seg(params.inboxId)}/drafts/${seg(params.draftId)}/send`,
      idempotencyKey,
      body: params.headers ? { headers: params.headers } : undefined,
    },
    idWireSchema,
  );
  return { status: "ok", data: { emailId: data.id }, replayed };
}

export type ReplyToThreadEmailParams = {
  inboxId: string;
  threadId: string;
  /** The message being replied to (usually the last outbound email). */
  emailId: string;
  text?: string;
  html?: string;
  subject?: string;
  cc?: string | string[];
  bcc?: string | string[];
  idempotencyKey: string;
  headers?: Record<string, string>;
};

/**
 * `POST /inboxes/{id}/threads/{threadId}/emails/{emailId}/reply`. Resend
 * addresses the reply (original `to` for an outbound message, otherwise
 * Reply-To / sender), so under `restricted` the target message is fetched and
 * the derived recipients plus cc/bcc are checked first. Reply-all is not
 * exposed: its parameter name is not documented.
 */
export async function replyToThreadEmail(
  params: ReplyToThreadEmailParams,
): Promise<ResendInboxResult<{ emailId: string }>> {
  const operation = "replyToThreadEmail";
  const idempotencyKey = requireIdempotencyKey(
    operation,
    params.idempotencyKey,
  );
  if (!params.text && !params.html) {
    throw invalid(operation, "text or html is required");
  }
  if (getEmailDeliveryMode() === "capture") {
    logLocalEmailCapture({
      kind: "provider-outreach-reply",
      from: params.inboxId,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    return captured(operation, idempotencyKey);
  }
  assertRealResourceIds(
    operation,
    params.inboxId,
    params.threadId,
    params.emailId,
  );

  const emailPath = `/inboxes/${seg(params.inboxId)}/threads/${seg(params.threadId)}/emails/${seg(params.emailId)}`;
  if (getEmailDeliveryMode() === "restricted") {
    const target = await request(
      { operation: "getThreadEmail", method: "GET", path: emailPath },
      threadEmailWireSchema,
    );
    const replyTargets =
      target.data.direction === "outbound"
        ? target.data.to
        : target.data.replyTo.length
          ? target.data.replyTo
          : [target.data.from];
    const policy = evaluateRecipientDeliveryPolicy([
      ...replyTargets,
      ...asList(params.cc),
      ...asList(params.bcc),
    ]);
    if (policy.action === "blocked")
      throw blockedError(operation, policy.disallowed);
  }

  const { data, replayed } = await request(
    {
      operation,
      method: "POST",
      path: `${emailPath}/reply`,
      idempotencyKey,
      body: {
        ...(params.text ? { text: params.text } : {}),
        ...(params.html ? { html: params.html } : {}),
        ...(params.subject ? { subject: params.subject } : {}),
        ...(params.cc ? { cc: params.cc } : {}),
        ...(params.bcc ? { bcc: params.bcc } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      },
    },
    idWireSchema,
  );
  return { status: "ok", data: { emailId: data.id }, replayed };
}

// --- Threads ----------------------------------------------------------------

/** `GET .../threads/{threadId}/emails/{emailId}`: body and attachment metadata (no headers or content types are documented). */
export function getThreadEmail(
  inboxId: string,
  threadId: string,
  emailId: string,
): Promise<ResendInboxResult<ResendThreadEmail>> {
  assertRealResourceIds("getThreadEmail", inboxId, threadId, emailId);
  return call(
    {
      operation: "getThreadEmail",
      method: "GET",
      path: `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}/emails/${seg(emailId)}`,
    },
    threadEmailWireSchema,
    `${inboxId}:${threadId}:${emailId}`,
  );
}

/** `GET .../threads/{threadId}/emails`, oldest first. `after` pages toward newer messages. */
export function listThreadEmails(
  inboxId: string,
  threadId: string,
  page: { limit?: number; after?: string; before?: string } = {},
): Promise<
  ResendInboxResult<{ emails: ResendThreadEmail[]; hasMore: boolean }>
> {
  assertRealResourceIds("listThreadEmails", inboxId, threadId);
  if (page.after && page.before) {
    throw invalid("listThreadEmails", "after and before cannot be combined");
  }
  return call(
    {
      operation: "listThreadEmails",
      method: "GET",
      path: `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}/emails`,
      query: {
        limit:
          page.limit === undefined
            ? undefined
            : Math.min(Math.max(page.limit, 1), 100),
        after: page.after,
        before: page.before,
      },
    },
    threadEmailListWireSchema,
    `${inboxId}:${threadId}`,
  );
}

/** `POST .../threads/{threadId}/labels`: add 1-10 label ids; returns every label on the thread. */
export function addThreadLabels(
  inboxId: string,
  threadId: string,
  labelIds: string[],
): Promise<ResendInboxResult<ResendInboxLabel[]>> {
  const operation = "addThreadLabels";
  assertRealResourceIds(operation, inboxId, threadId);
  if (labelIds.length < 1 || labelIds.length > 10) {
    throw invalid(operation, "1-10 label ids required");
  }
  return call(
    {
      operation,
      method: "POST",
      path: `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}/labels`,
      body: { labels: labelIds },
    },
    labelListWireSchema,
    `${inboxId}:${threadId}:${labelIds.join(",")}`,
  );
}

/** `PUT .../threads/{threadId}/labels`: replace the thread's labels (up to 100; `[]` clears). */
export function setThreadLabels(
  inboxId: string,
  threadId: string,
  labelIds: string[],
): Promise<ResendInboxResult<ResendInboxLabel[]>> {
  const operation = "setThreadLabels";
  assertRealResourceIds(operation, inboxId, threadId);
  if (labelIds.length > 100) {
    throw invalid(operation, "at most 100 label ids");
  }
  return call(
    {
      operation,
      method: "PUT",
      path: `/inboxes/${seg(inboxId)}/threads/${seg(threadId)}/labels`,
      body: { labels: labelIds },
    },
    labelListWireSchema,
    `${inboxId}:${threadId}:${labelIds.join(",")}`,
  );
}

// --- Operator inbox naming --------------------------------------------------

export function getProviderOutreachEmailDomain(): string {
  const domain = process.env.PROVIDER_OUTREACH_EMAIL_DOMAIN?.trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!domain) {
    throw new ResendInboxError(
      "permanent",
      "ensureInbox",
      "PROVIDER_OUTREACH_EMAIL_DOMAIN not set",
      { code: "not_configured" },
    );
  }
  return domain;
}

/**
 * The operator's email localpart on the outreach subdomain. Resend allows only
 * letters, numbers and `. _ % -` (max 64, no leading/trailing/double dots);
 * `+` tags are dropped and `%` is avoided so the address is safe in paths.
 */
export function operatorInboxAddress(
  operatorEmail: string,
  domain: string = getProviderOutreachEmailDomain(),
): string {
  const full =
    extractEmailAddress(operatorEmail) ?? operatorEmail.trim().toLowerCase();
  const raw = full.split("@")[0]?.split("+")[0] ?? "";
  const local = raw
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 64)
    .replace(/\.+$/g, "");
  if (!local) {
    throw invalid("ensureInbox", "operator email has no usable localpart");
  }
  return `${local}@${domain}`;
}

/** "{First} at Spot", without characters Resend rejects in `from_name`. */
export function operatorInboxFromName(
  operatorName: string | undefined,
): string {
  const first =
    (operatorName ?? "")
      .replace(/[:<>\r\n]/g, " ")
      .trim()
      .split(/\s+/)[0] ?? "";
  return (first ? `${first} at Spot` : "Spot").slice(0, 78);
}

// --- Webhooks ---------------------------------------------------------------

const inboxWebhookEmailSchema = threadEmailBaseSchema.omit({
  html: true,
  text: true,
});

const inboxWebhookEventSchema = z.object({
  type: z.enum(["inbox.email.received", "inbox.email.sent"]),
  created_at: z.string(),
  data: z.object({
    /** `inbox.email.sent` is always `system`, even for API and dashboard sends. */
    source: z.string().nullish(),
    inbox_id: z.string(),
    thread_id: z.string(),
    email_id: z.string(),
    thread: threadWireSchema.nullish(),
    email: inboxWebhookEmailSchema,
  }),
});

export type ResendInboxThread = z.output<typeof threadWireSchema>;
export type InboxWebhookEvent = z.output<typeof inboxWebhookEventSchema>;

/** Parse a verified `inbox.email.received` / `inbox.email.sent` payload; null for other events. */
export function parseInboxWebhookEvent(
  rawBody: string,
): InboxWebhookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = inboxWebhookEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Sender-only bounce check. The Inboxes API documents no headers or content
 * type on thread emails, so `multipart/report` and DSN headers cannot be read;
 * only the `from` address is available.
 */
export function isBounceSender(from: string): boolean {
  const address = extractEmailAddress(from) ?? from.trim().toLowerCase();
  return /^(?:mailer-daemon|postmaster)@/.test(address);
}
