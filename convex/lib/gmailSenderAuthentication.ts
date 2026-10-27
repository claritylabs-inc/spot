"use node";

import { Resolver } from "node:dns/promises";
import { dkimVerify } from "mailauth";
import { simpleParser } from "mailparser";
import { normalizeGmailAddress } from "./operatorGmail";

const MESSAGE_HEADERS = ["from", "to", "cc", "subject", "in-reply-to", "references"];

const bare = (value: string | undefined | null) =>
  value?.trim().replace(/^<|>$/g, "").toLowerCase() || null;

/**
 * Whether the original MIME of a received email carries a DKIM signature
 * aligned with its From domain, covering From, Message-ID and the other routing
 * headers it has, and whether that signed From is `address` and that signed
 * Message-ID the one the inbox reported. Same acceptance rules as
 * `authenticateOperatorEmail` (the signature must cover the whole body), but
 * for any sender domain: that function only admits operator-domain senders
 * addressing the command inbox. A DNS temperror throws so the caller retries.
 */
export async function hasAlignedSenderDkim(
  raw: Buffer,
  expected: { address: string; messageId?: string },
): Promise<boolean> {
  const separator = /\r?\n\r?\n/.exec(raw.toString("latin1"));
  if (!separator) return false;
  const parsed = await simpleParser(raw.subarray(0, separator.index), {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  }).catch(() => null);
  if (!parsed) return false;
  const counts = new Map<string, number>();
  for (const header of parsed.headerLines) {
    counts.set(header.key, (counts.get(header.key) ?? 0) + 1);
  }
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
    (counts.get("dkim-signature") ?? 0) > 8 ||
    sender?.length !== 1 ||
    !address ||
    !domain ||
    address !== normalizeGmailAddress(expected.address) ||
    (expected.messageId !== undefined && bare(parsed.messageId) !== bare(expected.messageId))
  )
    return false;

  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  try {
    const verified = await dkimVerify(raw, {
      resolver: (name, rrtype) => {
        if (rrtype !== "TXT") throw new Error("Unexpected DKIM DNS record type");
        return resolver.resolveTxt(name);
      },
    });
    const aligned = verified.results.some((signature) => {
      const signed = new Set(
        signature.signingHeaders?.keys
          .toLowerCase()
          .split(":")
          .map((name) => name.trim()),
      );
      return (
        signature.status.result === "pass" &&
        signature.signingDomain.toLowerCase() === domain &&
        ["rsa-sha256", "ed25519-sha256"].includes(signature.algo ?? "") &&
        signature.canonBodyLengthLimited === false &&
        signature.signatureTimeValid === true &&
        protectedHeaders.every((name) => signed.has(name))
      );
    });
    if (!aligned && verified.results.some((signature) => signature.status.result === "temperror"))
      throw new Error("DKIM verification could not complete");
    return aligned;
  } finally {
    resolver.cancel();
  }
}
