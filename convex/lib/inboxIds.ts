/**
 * Team inbox id formats. `google:<address>` is an operator's connected Gmail
 * (OAuth); `gmail:<address>` is the retired app-password mailbox; anything else
 * is a Resend inbox id.
 */
export const GMAIL_INBOX_PREFIX = "google:";
export const MAILBOX_PREFIX = "gmail:";
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export type InboxKind = "resend" | "gmail" | "legacy_google";

export function inboxKind(inboxId: string): InboxKind {
  if (inboxId.startsWith(GMAIL_INBOX_PREFIX)) return "gmail";
  if (inboxId.startsWith(MAILBOX_PREFIX)) return "legacy_google";
  return "resend";
}

export const normalizeGmailAddress = (address: string) => address.trim().toLowerCase();
export const gmailInboxId = (address: string) =>
  `${GMAIL_INBOX_PREFIX}${normalizeGmailAddress(address)}`;
export const gmailAddressOf = (inboxId: string) =>
  inboxId.slice(GMAIL_INBOX_PREFIX.length);
export const legacyAddressOf = (inboxId: string) =>
  inboxId.slice(MAILBOX_PREFIX.length);

export function allowedGmailDomains() {
  return (process.env.GOOGLE_MAILBOX_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}
