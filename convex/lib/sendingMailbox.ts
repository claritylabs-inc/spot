export const SENDING_DOMAIN = "insurewithspot.com";
export const SENDING_ADDRESSES = [
  "zac",
  "terence",
  "terry",
  "dan",
  "adyan",
].map((name) => `${name}@${SENDING_DOMAIN}`);
export function mailboxConnectionsAllowed() {
  return (
    process.env.EMAIL_DELIVERY_MODE !== "capture" ||
    process.env.OPERATOR_MAILBOX_CONNECTIONS_ENABLED === "true"
  );
}
