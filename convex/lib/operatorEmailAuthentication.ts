"use node";

import { simpleParser, type ParsedMail } from "mailparser";
import {
  MAX_DKIM_SIGNATURES,
  MIME_PARSE_OPTIONS,
  parseMimeHeaders,
  signedHeaderNames,
  verifyAlignedDkim,
} from "./dkim";
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
  const mime = await parseMimeHeaders(raw);
  if (mime.status !== "ok")
    throw invalid(
      mime.status === "no_separator"
        ? "Operator email has no header/body separator"
        : "Operator email could not be parsed",
    );
  const { parsed, counts: headers, body } = mime;
  if (
    REQUIRED_HEADERS.some((name) => headers.get(name) !== 1) ||
    [...headers].some(([name, count]) =>
      count > 1 && (PROTECTED_HEADERS.includes(name) || name.startsWith("content-")),
    ) ||
    (headers.get("dkim-signature") ?? 0) > MAX_DKIM_SIGNATURES
  ) {
    throw invalid("Operator email has missing or ambiguous authentication headers");
  }
  const sender = parsed.from?.value;
  const senderAddress = sender?.[0]?.address?.toLowerCase();
  const senderDomain = senderAddress?.split("@")[1];
  if (
    sender?.length !== 1 ||
    !senderAddress ||
    !senderDomain ||
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

  const protectedHeaders = PROTECTED_HEADERS.filter((name) =>
    headers.has(name) && !MIME_HEADERS.includes(name),
  );
  const dkim = await verifyAlignedDkim(raw, { senderDomain, protectedHeaders });
  if (dkim.status !== "pass") {
    // A DNS temperror is not a failed signature: report it so callers retry
    // instead of treating the message as unauthenticated.
    throw new OperatorEmailAuthenticationError(
      dkim.status === "temperror" ? "temporary" : "invalid",
      "Operator email requires an aligned DKIM signature covering its body and routing headers",
    );
  }
  const signedHeaders = signedHeaderNames(dkim.signature);
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
  ]), MIME_PARSE_OPTIONS);
}
