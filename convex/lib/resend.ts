import { extractEmailAddress } from "./emailAddress";
import {
  canonicalAgentDomain,
  DEFAULT_AGENT_DOMAIN,
  LEGACY_AGENT_DOMAINS,
} from "./agentEmailDomains";

const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_NOTIFICATION_EMAIL_DOMAIN = "notifications.spot.insure";
const DEFAULT_AUTH_EMAIL_DOMAIN = "auth.spot.insure";
const DEFAULT_AUTH_EMAIL_FROM_NAME = "Spot";

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, "");
}

function uniqueDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
}

export function getAgentDomain(): string {
  const configured = process.env.AGENT_EMAIL_DOMAIN ?? process.env.AGENT_DOMAIN;
  return canonicalAgentDomain(configured);
}

export function getLegacyAgentDomains(): string[] {
  const configured = process.env.LEGACY_AGENT_DOMAINS;
  if (!configured) return LEGACY_AGENT_DOMAINS;
  return uniqueDomains([...LEGACY_AGENT_DOMAINS, ...configured.split(",")]);
}

export function getAgentDomains(): string[] {
  return uniqueDomains([DEFAULT_AGENT_DOMAIN, getAgentDomain(), ...getLegacyAgentDomains()]);
}

export function getAgentRecipientAddresses(
  handle: string,
  threadSuffix?: string,
): string[] {
  return getAgentDomains().flatMap((domain) => [
    `${handle}@${domain}`,
    ...(threadSuffix ? [`${handle}+${threadSuffix}@${domain}`] : []),
  ]);
}

export function getNotificationEmailDomain(): string {
  return process.env.NOTIFICATION_EMAIL_DOMAIN ?? DEFAULT_NOTIFICATION_EMAIL_DOMAIN;
}

export function getAuthEmailDomain(): string {
  return process.env.AUTH_EMAIL_DOMAIN ?? DEFAULT_AUTH_EMAIL_DOMAIN;
}

export function isSpotOutboundAddress(address: string): boolean {
  const domain = normalizeDomain(address.split("@").pop() ?? "");
  return uniqueDomains([
    ...getAgentDomains(),
    getNotificationEmailDomain(),
    getAuthEmailDomain(),
  ]).includes(domain);
}

export function getNotificationFromAddress(fromName: string): string {
  return `${fromName} <notifications@${getNotificationEmailDomain()}>`;
}

function sanitizeFromName(value: string): string {
  return value.replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
}

export function getAuthFromAddress(fromName?: string): string {
  const fallback = `${DEFAULT_AUTH_EMAIL_FROM_NAME} <noreply@${getAuthEmailDomain()}>`;
  const configured = process.env.AUTH_EMAIL_FROM;
  const address =
    extractEmailAddress(configured ?? fallback) ??
    `noreply@${getAuthEmailDomain()}`;
  const displayName = sanitizeFromName(fromName ?? DEFAULT_AUTH_EMAIL_FROM_NAME);
  return `${displayName} <${address}>`;
}

export type ResendPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  attachments?: unknown;
  [key: string]: unknown;
};

export type ResendResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

type EmailDeliveryMode = "live" | "restricted" | "capture";

type RecipientField = "to" | "cc" | "bcc";

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEmail(value: string): string {
  return extractEmailAddress(value) ?? "";
}

function normalizeRecipients(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(normalizeEmail).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractSixDigitCodeCandidates(...values: Array<string | undefined>): string[] {
  const candidates = values.flatMap((value) => value?.match(/\b\d{6}\b/g) ?? []);
  return uniqueStrings(candidates);
}

function extractVisibleHtmlText(html: string | undefined): string | undefined {
  return html
    ?.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactMetadata(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function summarizeAttachment(attachment: unknown): Record<string, unknown> {
  if (!attachment || typeof attachment !== "object") {
    return { type: typeof attachment };
  }

  const record = attachment as Record<string, unknown>;
  return compactMetadata({
    filename: stringValue(record.filename),
    name: stringValue(record.name),
    contentType:
      stringValue(record.contentType) ??
      stringValue(record.content_type) ??
      stringValue(record.mimeType) ??
      stringValue(record.mime_type),
    size: numberValue(record.size),
  });
}

function summarizeAttachments(attachments: unknown): {
  count: number;
  items: Array<Record<string, unknown>>;
} {
  const list = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
  return {
    count: list.length,
    items: list.map(summarizeAttachment),
  };
}

export type LocalEmailCaptureLog = {
  kind?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  attachments?: unknown;
  codeCandidates?: string[];
};

function formatRecipientList(value: string | string[] | undefined): string {
  return normalizeRecipients(value).join(", ") || "(none)";
}

export function isLocalEmailCaptureEnabled(): boolean {
  return process.env.SPOT_ENV?.trim().toLowerCase() === "local" && getEmailDeliveryMode() === "capture";
}

export function logLocalEmailCapture(details: LocalEmailCaptureLog): boolean {
  if (!isLocalEmailCaptureEnabled()) return false;

  const attachments = summarizeAttachments(details.attachments);
  const codeCandidates = uniqueStrings([
    ...(details.codeCandidates ?? []),
    ...extractSixDigitCodeCandidates(
      details.subject,
      details.text,
      extractVisibleHtmlText(details.html),
    ),
  ]);

  console.log(
    [
      "[spot:local-email-capture]",
      `kind: ${details.kind ?? "email"}`,
      `from: ${details.from ?? "(none)"}`,
      `to: ${formatRecipientList(details.to)}`,
      `cc: ${formatRecipientList(details.cc)}`,
      `bcc: ${formatRecipientList(details.bcc)}`,
      `subject: ${details.subject ?? ""}`,
      `codeCandidates: ${codeCandidates.length ? codeCandidates.join(", ") : "(none)"}`,
      `attachmentCount: ${attachments.count}`,
      `attachments: ${JSON.stringify(attachments.items)}`,
      "text:",
      details.text ?? "",
      "html:",
      details.html ?? "",
    ].join("\n"),
  );

  return true;
}

function getSubjectPrefix(): string {
  const configured = process.env.EMAIL_SUBJECT_PREFIX;
  return configured?.trim() ?? "";
}

function prefixSubject(subject: string): string {
  const prefix = getSubjectPrefix();
  if (!prefix || subject.startsWith(prefix)) return subject;
  return `${prefix} ${subject}`;
}

export function getEmailDeliveryMode(): EmailDeliveryMode {
  const configured = process.env.EMAIL_DELIVERY_MODE?.trim().toLowerCase();
  if (configured === "restricted" || configured === "capture") return configured;
  return "live";
}

function recipientAllowed(email: string): boolean {
  const allowedEmails = new Set(
    splitCsv(process.env.EMAIL_ALLOWED_RECIPIENTS).map((item) =>
      normalizeEmail(item),
    ),
  );
  const allowedDomains = new Set(
    splitCsv(process.env.EMAIL_ALLOWED_RECIPIENT_DOMAINS).map(normalizeDomain),
  );
  if (allowedEmails.has(email)) return true;
  const domain = email.split("@").pop();
  return Boolean(domain && allowedDomains.has(normalizeDomain(domain)));
}

function withOriginalRecipientHeaders(
  payload: ResendPayload,
  recipients: Record<RecipientField, string[]>,
): ResendPayload {
  return {
    ...payload,
    headers: {
      ...payload.headers,
      "X-Spot-Original-To": recipients.to.join(", "),
      ...(recipients.cc.length
        ? { "X-Spot-Original-Cc": recipients.cc.join(", ") }
        : {}),
      ...(recipients.bcc.length
        ? { "X-Spot-Original-Bcc": recipients.bcc.join(", ") }
        : {}),
      ...(process.env.SPOT_ENV ? { "X-Spot-Environment": process.env.SPOT_ENV } : {}),
    },
  };
}

function preparePayloadForDelivery(
  payload: ResendPayload,
): { payload?: ResendPayload; captured?: boolean; error?: string } {
  const mode = getEmailDeliveryMode();
  if (mode === "live") return { payload };

  const recipients = {
    to: normalizeRecipients(payload.to),
    cc: normalizeRecipients(payload.cc),
    bcc: normalizeRecipients(payload.bcc),
  };
  const allRecipients = [...recipients.to, ...recipients.cc, ...recipients.bcc];

  if (mode === "capture") {
    if (!logLocalEmailCapture({ ...payload, kind: "email" })) {
      console.log("[resend] Captured email without sending", {
        subject: payload.subject,
        toCount: recipients.to.length,
        ccCount: recipients.cc.length,
        bccCount: recipients.bcc.length,
      });
    }
    return { captured: true };
  }

  const disallowed = allRecipients.filter((email) => !recipientAllowed(email));
  if (disallowed.length === 0) {
    return {
      payload: {
        ...payload,
        subject: prefixSubject(payload.subject),
        headers: {
          ...payload.headers,
          ...(process.env.SPOT_ENV ? { "X-Spot-Environment": process.env.SPOT_ENV } : {}),
        },
      },
    };
  }

  const redirectTo = splitCsv(process.env.EMAIL_REDIRECT_TO);
  if (redirectTo.length === 0) {
    return {
      error: `restricted email delivery blocked ${disallowed.length} recipient(s); set EMAIL_REDIRECT_TO to redirect restricted mail`,
    };
  }

  const redirected = withOriginalRecipientHeaders(
    {
      ...payload,
      to: redirectTo.length === 1 ? redirectTo[0] : redirectTo,
      subject: prefixSubject(payload.subject),
    },
    recipients,
  );
  const { cc: _cc, bcc: _bcc, ...payloadWithoutCopyRecipients } = redirected;
  return {
    payload: payloadWithoutCopyRecipients,
  };
}

export async function sendResendEmail(
  payload: ResendPayload,
  opts: { retries?: number; idempotencyKey?: string } = {},
): Promise<ResendResult> {
  const prepared = preparePayloadForDelivery(payload);
  if (prepared.captured) return { ok: true, id: "captured" };
  if (prepared.error) return { ok: false, error: prepared.error };
  if (!prepared.payload) return { ok: false, error: "Email payload was not prepared" };

  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) return { ok: false, error: "AUTH_RESEND_KEY not set" };

  const maxAttempts = (opts.retries ?? 0) + 1;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(prepared.payload),
    });
    const body = await res.text();
    if (res.ok) {
      try {
        return { ok: true, id: JSON.parse(body).id };
      } catch {
        return { ok: true };
      }
    }
    lastError = body;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastError };
}
