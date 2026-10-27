"use node";

import { Resolver } from "node:dns/promises";
import { dkimVerify } from "mailauth";
import { simpleParser, type ParsedMail } from "mailparser";

/** Header-only parsing: bodies are never decoded while deciding who sent a message. */
export const MIME_PARSE_OPTIONS = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipImageLinks: true,
};

/** More DKIM-Signature headers than this are treated as an attempt to exhaust verification. */
export const MAX_DKIM_SIGNATURES = 8;

export type MimeHeaders =
  | { status: "ok"; parsed: ParsedMail; counts: Map<string, number>; body: Buffer }
  | { status: "no_separator" | "unparseable" };

/** Parses the header block of original MIME bytes and counts each header (duplicate From, Message-ID, …). */
export async function parseMimeHeaders(raw: Buffer): Promise<MimeHeaders> {
  const separator = /\r?\n\r?\n/.exec(raw.toString("latin1"));
  if (!separator) return { status: "no_separator" };
  const parsed = await simpleParser(raw.subarray(0, separator.index), MIME_PARSE_OPTIONS).catch(
    () => null,
  );
  if (!parsed) return { status: "unparseable" };
  const counts = new Map<string, number>();
  for (const header of parsed.headerLines) {
    counts.set(header.key, (counts.get(header.key) ?? 0) + 1);
  }
  return { status: "ok", parsed, counts, body: raw.subarray(separator.index + separator[0].length) };
}

type DkimSignature = Awaited<ReturnType<typeof dkimVerify>>["results"][number];

export type AlignedDkim =
  | { status: "pass"; signature: DkimSignature }
  | { status: "fail" | "temperror"; signature?: undefined };

/** Lower-cased header names a signature covers. */
export function signedHeaderNames(signature: DkimSignature) {
  return new Set(
    signature.signingHeaders?.keys
      .toLowerCase()
      .split(":")
      .map((name) => name.trim()),
  );
}

/**
 * Verifies the original MIME bytes (never a forwarded Authentication-Results
 * header). `pass` needs one signature that verifies, uses rsa-sha256 or
 * ed25519-sha256, covers the whole body, is within its validity window, is
 * signed by `senderDomain`, and signs every one of `protectedHeaders`.
 * `temperror` means no signature passed and a DNS lookup could not complete,
 * so the caller should retry rather than treat the message as unauthenticated.
 */
export async function verifyAlignedDkim(
  raw: Buffer,
  expected: { senderDomain: string; protectedHeaders: readonly string[] },
): Promise<AlignedDkim> {
  const resolver = new Resolver({ timeout: 3_000, tries: 1 });
  try {
    const verified = await dkimVerify(raw, {
      resolver: (name, rrtype) => {
        if (rrtype !== "TXT") throw new Error("Unexpected DKIM DNS record type");
        return resolver.resolveTxt(name);
      },
    });
    const signature = verified.results.find((candidate) => {
      const signed = signedHeaderNames(candidate);
      return (
        candidate.status.result === "pass" &&
        candidate.signingDomain.toLowerCase() === expected.senderDomain &&
        ["rsa-sha256", "ed25519-sha256"].includes(candidate.algo ?? "") &&
        candidate.canonBodyLengthLimited === false &&
        candidate.signatureTimeValid === true &&
        expected.protectedHeaders.every((name) => signed.has(name))
      );
    });
    if (signature) return { status: "pass", signature };
    return {
      status: verified.results.some((candidate) => candidate.status.result === "temperror")
        ? "temperror"
        : "fail",
    };
  } finally {
    resolver.cancel();
  }
}
