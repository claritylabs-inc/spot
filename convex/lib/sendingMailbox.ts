export const SENDING_DOMAIN = "insurewithspot.com";
export const SENDING_ADDRESSES = [
  "zac",
  "terence",
  "terry",
  "dan",
  "adyan",
].map((name) => `${name}@${SENDING_DOMAIN}`);
export const MAILBOX_PREFIX = "gmail:";
export function mailboxConnectionsAllowed() {
  return (
    process.env.EMAIL_DELIVERY_MODE !== "capture" ||
    process.env.OPERATOR_MAILBOX_CONNECTIONS_ENABLED === "true"
  );
}
export function isGoogleMailbox(id: string) {
  return id.startsWith(MAILBOX_PREFIX);
}
