const PROCUREMENT_LOCAL_PREFIX = "procurement+";

export type ProcurementEmailCategory =
  | "broker"
  | "client"
  | "internal"
  | "mixed"
  | "other";

export function createProcurementInboxToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function procurementForwardingAddress(token: string, domain: string) {
  return `${PROCUREMENT_LOCAL_PREFIX}${token}@${domain}`;
}

export function procurementInboxTokenFromAddresses(
  addresses: string[],
  acceptedDomains: string[],
) {
  const domains = new Set(
    acceptedDomains.map((domain) => domain.toLowerCase()),
  );
  for (const address of addresses) {
    const normalized = address.trim().toLowerCase();
    const separator = normalized.lastIndexOf("@");
    if (separator <= 0 || !domains.has(normalized.slice(separator + 1))) {
      continue;
    }
    const localPart = normalized.slice(0, separator);
    if (!localPart.startsWith(PROCUREMENT_LOCAL_PREFIX)) continue;
    const token = localPart.slice(PROCUREMENT_LOCAL_PREFIX.length);
    if (/^[a-f0-9]{32}$/.test(token)) return token;
  }
  return null;
}

export function normalizeProcurementSubject(subject: string) {
  let normalized = subject.trim().toLowerCase();
  while (/^(?:re|fw|fwd):\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(?:re|fw|fwd):\s*/i, "").trim();
  }
  return normalized.replace(/\s+/g, " ").slice(0, 300);
}

/** Free mailbox providers: their domain never identifies a company. */
export const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
]);

export function normalizeProcurementEmail(value: string) {
  return value.trim().toLowerCase();
}

export function uniqueProcurementEmails(values: string[], limit = 100) {
  return Array.from(
    new Set(values.map(normalizeProcurementEmail).filter(Boolean)),
  ).slice(0, limit);
}

export function inferProcurementEmailCategory(args: {
  participantEmails: string[];
  brokerEmails: string[];
  clientEmails: string[];
  operatorEmails: string[];
}): { category: ProcurementEmailCategory; reason: string } {
  const participants = new Set(uniqueProcurementEmails(args.participantEmails));
  const matches = {
    broker: uniqueProcurementEmails(args.brokerEmails).some((email) =>
      participants.has(email),
    ),
    client: uniqueProcurementEmails(args.clientEmails).some((email) =>
      participants.has(email),
    ),
    internal: uniqueProcurementEmails(args.operatorEmails).some((email) =>
      participants.has(email),
    ),
  };
  const matched = Object.entries(matches)
    .filter(([, value]) => value)
    .map(([key]) => key);

  if (matched.length > 1) {
    return {
      category: "mixed",
      reason: `Recipients match ${matched.join(" and ")} contacts`,
    };
  }
  if (matches.broker) {
    return { category: "broker", reason: "Recipient matches a provider contact" };
  }
  if (matches.client) {
    return { category: "client", reason: "Recipient matches a client member" };
  }
  if (matches.internal) {
    return {
      category: "internal",
      reason: "Recipient matches an internal operator",
    };
  }
  return { category: "other", reason: "No known recipient match" };
}

export function procurementParticipantsOverlap(
  left: string[],
  right: string[],
) {
  const leftSet = new Set(uniqueProcurementEmails(left));
  return uniqueProcurementEmails(right).some((email) => leftSet.has(email));
}
