"use node";

import { Resolver } from "node:dns/promises";
import { dkimVerify } from "mailauth";
import { simpleParser, type ParsedMail } from "mailparser";
import { OPERATOR_EMAIL_DOMAINS } from "./operatorIdentity";
import { isOperatorEmailRecipient } from "./operatorEmailAddress";

export const MAX_OPERATOR_EMAIL_RAW_BYTES = 32 * 1024 * 1024;

const REQUIRED_HEADERS = ["from", "to", "subject", "message-id"];
const PROTECTED_HEADERS = [
  ...REQUIRED_HEADERS,
  "cc",
  "reply-to",
  "in-reply-to",
  "references",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
];

/** Authenticate original MIME bytes, never a forwarded Authentication-Results header. */
export async function authenticateOperatorEmail(
  raw: Buffer,
): Promise<ParsedMail> {
  if (!raw.length || raw.length > MAX_OPERATOR_EMAIL_RAW_BYTES) {
    throw new Error("Operator email exceeds the raw message size limit");
  }
  const parsed = await simpleParser(raw, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  const headers = new Map<string, number>();
  for (const header of parsed.headerLines) {
    headers.set(header.key, (headers.get(header.key) ?? 0) + 1);
  }
  if (
    REQUIRED_HEADERS.some((name) => headers.get(name) !== 1) ||
    PROTECTED_HEADERS.some((name) => (headers.get(name) ?? 0) > 1) ||
    (headers.get("dkim-signature") ?? 0) > 8
  ) {
    throw new Error(
      "Operator email has missing or ambiguous authentication headers",
    );
  }
  const sender = parsed.from?.value;
  const senderAddress = sender?.[0]?.address?.toLowerCase();
  const senderDomain = senderAddress?.split("@")[1];
  if (
    sender?.length !== 1 ||
    !senderAddress ||
    !/^[^@\s]+@[^@\s]+$/.test(senderAddress) ||
    !OPERATOR_EMAIL_DOMAINS.some((domain) => domain === senderDomain)
  ) {
    throw new Error(
      "Operator email requires one sender from an operator domain",
    );
  }
  const recipients = [parsed.to, parsed.cc]
    .flatMap((addresses) =>
      addresses ? (Array.isArray(addresses) ? addresses : [addresses]) : [],
    )
    .flatMap((addresses) => addresses.value);
  if (
    !recipients.some((recipient) =>
      isOperatorEmailRecipient(recipient.address ?? ""),
    )
  ) {
    throw new Error("Operator email must address the operator inbox");
  }
  if (!parsed.messageId || !/^<[^<>\s]+>$/.test(parsed.messageId)) {
    throw new Error("Operator email requires a valid signed message ID");
  }

  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  try {
    const verified = await dkimVerify(raw, {
      resolver: (domain, rrtype) => {
        if (rrtype !== "TXT")
          throw new Error("Unexpected DKIM DNS record type");
        return resolver.resolveTxt(domain);
      },
    });
    const protectedHeaders = PROTECTED_HEADERS.filter((name) =>
      headers.has(name),
    );
    const authenticated = verified.results.some((signature) => {
      const signedHeaders = new Set(
        signature.signingHeaders?.keys
          .toLowerCase()
          .split(":")
          .map((name) => name.trim()),
      );
      return (
        signature.status.result === "pass" &&
        signature.signingDomain.toLowerCase() === senderDomain &&
        ["rsa-sha256", "ed25519-sha256"].includes(signature.algo ?? "") &&
        signature.canonBodyLengthLimited === false &&
        signature.signatureTimeValid === true &&
        protectedHeaders.every((name) => signedHeaders.has(name))
      );
    });
    if (!authenticated) {
      throw new Error(
        "Operator email requires an aligned DKIM signature covering its body and routing headers",
      );
    }
  } finally {
    resolver.cancel();
  }
  return parsed;
}
