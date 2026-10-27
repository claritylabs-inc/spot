"use node";

import { MAX_DKIM_SIGNATURES, parseMimeHeaders, verifyAlignedDkim } from "./dkim";
import { normalizeGmailAddress } from "./inboxIds";
import { comparableRfcId } from "./messageId";

const MESSAGE_HEADERS = ["from", "to", "cc", "subject", "in-reply-to", "references"];

/**
 * Whether the original MIME of a received email carries a DKIM signature
 * aligned with its From domain, covering From, Message-ID and the other routing
 * headers it has, and whether that signed From is `address` and that signed
 * Message-ID the one the inbox reported. Signatures are checked by the same
 * `verifyAlignedDkim` as `authenticateOperatorEmail` (the signature must cover
 * the whole body), but for any sender domain: that function only admits
 * operator-domain senders addressing the command inbox. A DNS temperror throws
 * so the caller retries.
 */
export async function hasAlignedSenderDkim(
  raw: Buffer,
  expected: { address: string; messageId?: string },
): Promise<boolean> {
  const headers = await parseMimeHeaders(raw);
  if (headers.status !== "ok") return false;
  const { parsed, counts } = headers;
  const protectedHeaders = ["from", "message-id", ...MESSAGE_HEADERS].filter((name) =>
    counts.has(name),
  );
  const sender = parsed.from?.value;
  const address = sender?.[0]?.address?.toLowerCase();
  const domain = address?.split("@")[1];
  if (
    counts.get("from") !== 1 ||
    counts.get("message-id") !== 1 ||
    protectedHeaders.some((name) => (counts.get(name) ?? 0) > 1) ||
    (counts.get("dkim-signature") ?? 0) > MAX_DKIM_SIGNATURES ||
    sender?.length !== 1 ||
    !address ||
    !domain ||
    address !== normalizeGmailAddress(expected.address) ||
    (expected.messageId !== undefined && comparableRfcId(parsed.messageId) !== comparableRfcId(expected.messageId))
  )
    return false;

  const dkim = await verifyAlignedDkim(raw, { senderDomain: domain, protectedHeaders });
  if (dkim.status === "temperror") throw new Error("DKIM verification could not complete");
  return dkim.status === "pass";
}
