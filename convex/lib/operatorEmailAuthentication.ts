"use node";

import { Resolver } from "node:dns/promises";
import { dkimVerify } from "mailauth";
import { simpleParser, type ParsedMail } from "mailparser";
import { OPERATOR_EMAIL_DOMAINS } from "./operatorIdentity";
import { isOperatorEmailRecipient } from "./operatorEmailAddress";
import { getAgentDomains } from "./resend";

export const MAX_OPERATOR_EMAIL_RAW_BYTES = 32 * 1024 * 1024;

/**
 * `invalid`: the message itself fails authentication (explicit DKIM failure,
 * malformed MIME, wrong sender or recipient); retrying cannot help and the
 * caller must never fall back to unauthenticated handling.
 * `temporary`: DKIM verification could not complete (DNS temperror); retry later.
 */
export class OperatorEmailAuthenticationError extends Error {
  readonly kind: "invalid" | "temporary";

  constructor(kind: "invalid" | "temporary", message: string) {
    super(message);
    this.name = "OperatorEmailAuthenticationError";
    this.kind = kind;
  }
}

export type OperatorEmailAuthenticationOptions = {
  /**
   * The exact recorded command inbox address (`agent@team…`). It is accepted
   * as the signed recipient in addition to the legacy `operator(+t)@` aliases.
   */
  commandInboxAddress?: string;
  /** Agent domains that host legacy operator aliases; defaults to `getAgentDomains()`. */
  agentDomains?: readonly string[];
};

function invalid(message: string) {
  return new OperatorEmailAuthenticationError("invalid", message);
}

async function parseMime(source: Buffer, options: Parameters<typeof simpleParser>[1]) {
  try {
    return await simpleParser(source, options);
  } catch {
    throw invalid("Operator email could not be parsed");
  }
}

const REQUIRED_HEADERS = ["from", "to", "subject", "message-id"];
const MIME_HEADERS = [
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
];
const PROTECTED_HEADERS = [
  ...REQUIRED_HEADERS,
  "cc",
  "reply-to",
  "in-reply-to",
  "references",
  "mime-version",
  ...MIME_HEADERS,
];

function bodyContentType(body: Buffer) {
  // Gmail can omit outer MIME headers from DKIM. Derive this wrapper only from
  // the authenticated body; each nested part's MIME headers are body-signed.
  const text = body.toString("latin1");
  const boundary = /^--([A-Za-z0-9'()+_,./:=?-]{1,70})[ \t]*\r?\n/.exec(text)?.[1];
  return boundary && text.trimEnd().endsWith(`\n--${boundary}--`)
    ? `multipart/mixed; boundary="${boundary}"`
    : "text/plain; charset=utf-8";
}

/** Authenticate original MIME bytes, never a forwarded Authentication-Results header. */
export async function authenticateOperatorEmail(
  raw: Buffer,
  options: OperatorEmailAuthenticationOptions = {},
): Promise<ParsedMail> {
  if (!raw.length || raw.length > MAX_OPERATOR_EMAIL_RAW_BYTES) {
    throw invalid("Operator email exceeds the raw message size limit");
  }
  const separator = /\r?\n\r?\n/.exec(raw.toString("latin1"));
  if (!separator) throw invalid("Operator email has no header/body separator");
  const body = raw.subarray(separator.index + separator[0].length);
  const parseOptions = {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  };
  const parsed = await parseMime(raw.subarray(0, separator.index), parseOptions);
  const headers = new Map<string, number>();
  for (const header of parsed.headerLines) {
    headers.set(header.key, (headers.get(header.key) ?? 0) + 1);
  }
  if (
    REQUIRED_HEADERS.some((name) => headers.get(name) !== 1) ||
    [...headers].some(([name, count]) =>
      count > 1 && (PROTECTED_HEADERS.includes(name) || name.startsWith("content-")),
    ) ||
    (headers.get("dkim-signature") ?? 0) > 8
  ) {
    throw invalid("Operator email has missing or ambiguous authentication headers");
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
    throw invalid("Operator email requires one sender from an operator domain");
  }
  const recipients = [parsed.to, parsed.cc]
    .flatMap((addresses) =>
      addresses ? (Array.isArray(addresses) ? addresses : [addresses]) : [],
    )
    .flatMap((addresses) => addresses.value);
  const agentDomains = options.agentDomains ?? getAgentDomains();
  const commandInboxAddress = options.commandInboxAddress?.trim().toLowerCase();
  if (
    !recipients.some((recipient) => {
      const address = (recipient.address ?? "").trim().toLowerCase();
      return (
        isOperatorEmailRecipient(address, agentDomains) ||
        (commandInboxAddress !== undefined && address === commandInboxAddress)
      );
    })
  ) {
    throw invalid("Operator email must address the operator inbox");
  }
  if (!parsed.messageId || !/^<[^<>\s]+>$/.test(parsed.messageId)) {
    throw invalid("Operator email requires a valid signed message ID");
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
      headers.has(name) && !MIME_HEADERS.includes(name),
    );
    const authenticated = verified.results.find((signature) => {
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
      // A DNS temperror is not a failed signature: report it so callers retry
      // instead of treating the message as unauthenticated.
      throw new OperatorEmailAuthenticationError(
        verified.results.some((signature) => signature.status.result === "temperror")
          ? "temporary"
          : "invalid",
        "Operator email requires an aligned DKIM signature covering its body and routing headers",
      );
    }
    const signedHeaders = new Set(
      authenticated.signingHeaders?.keys.toLowerCase().split(":").map((name) => name.trim()),
    );
    const safeHeaders = parsed.headerLines
      .filter(({ key }) => !key.startsWith("content-") || signedHeaders.has(key))
      .map(({ line }) => line);
    if (!signedHeaders.has("content-type")) {
      safeHeaders.push(`Content-Type: ${bodyContentType(body)}`);
    }
    // Unsigned outer encodings/dispositions never control decoding. Preserve
    // their original body bytes as text instead of guessing an encoding.
    return await parseMime(Buffer.concat([
      Buffer.from(`${safeHeaders.join("\r\n")}\r\n\r\n`, "latin1"),
      body,
    ]), parseOptions);
  } finally {
    resolver.cancel();
  }
}
