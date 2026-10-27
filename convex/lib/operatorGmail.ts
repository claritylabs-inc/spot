/** Connected operator Gmail (OAuth): inbox ids, scopes and domain policy. */
export const GMAIL_INBOX_PREFIX = "google:";
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
export const normalizeGmailAddress = (address: string) => address.trim().toLowerCase();
export const gmailInboxId = (address: string) =>
  `${GMAIL_INBOX_PREFIX}${normalizeGmailAddress(address)}`;
export const isOperatorGmailInbox = (inboxId: string) =>
  inboxId.startsWith(GMAIL_INBOX_PREFIX);
export const gmailAddressOf = (inboxId: string) =>
  inboxId.slice(GMAIL_INBOX_PREFIX.length);
export function allowedGmailDomains() {
  return (process.env.GOOGLE_MAILBOX_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}
