/**
 * Team inbox id formats. `gmail:<address>` is the retired app-password mailbox;
 * anything else is a Resend inbox id.
 */
export const MAILBOX_PREFIX = "gmail:";

export type InboxKind = "resend" | "legacy_google";

export function inboxKind(inboxId: string): InboxKind {
  if (inboxId.startsWith(MAILBOX_PREFIX)) return "legacy_google";
  return "resend";
}

export const legacyAddressOf = (inboxId: string) =>
  inboxId.slice(MAILBOX_PREFIX.length);
