"use node";

import { z } from "zod";
import {
  listReceivedEmailAttachments,
  type ResendReceivedAttachment,
} from "./resendInbox";
import { readResponseBytesWithinLimit } from "./websiteBrand";

/**
 * Bounded reads of received mail through Resend's Receiving API
 * (`GET /emails/receiving/{id}`). Inbox mail ids resolve here too.
 *
 * Outcomes are deliberately three-way so callers can tell "this mail has no raw
 * copy" from "we could not ask":
 * - a returned `unavailable` means Resend confirmed there is no raw MIME
 *   (unknown received id, no `raw.download_url`, or the raw object is gone);
 * - `ReceivedEmailRejectedError` means the data exists but must not be used
 *   (oversized, or it belongs to a different email id);
 * - any other throw (network, timeout, 429/5xx, auth/config) is unknown and
 *   retryable. It never means "raw is unavailable".
 */

const RECEIVING_API = "https://api.resend.com/emails/receiving";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ENVELOPE_BYTES = 256 * 1024;
const MAX_OMISSIONS = 20;
const RECEIVED_EMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ReceivedEmailRejection = "too_large" | "mismatch";

export class ReceivedEmailRejectedError extends Error {
  readonly code: ReceivedEmailRejection;

  constructor(code: ReceivedEmailRejection, message: string) {
    super(message);
    this.name = "ReceivedEmailRejectedError";
    this.code = code;
  }
}

export type ReceivedEmailRaw =
  | { status: "available"; raw: Buffer }
  | { status: "unavailable"; reason: "not_found" | "no_raw_url" | "raw_gone" };

const envelopeSchema = z.object({
  id: z.string().nullish(),
  raw: z.object({ download_url: z.string().nullish() }).nullish(),
});

function assertReceivedEmailId(emailId: string) {
  if (!RECEIVED_EMAIL_ID.test(emailId)) {
    throw new ReceivedEmailRejectedError("mismatch", "Invalid received email ID");
  }
}

function requireApiKey() {
  const key = process.env.AUTH_RESEND_KEY;
  if (!key) throw new Error("AUTH_RESEND_KEY not set");
  return key;
}

// readResponseBytesWithinLimit reports an oversized stream as a plain error.
function isLimitError(error: unknown) {
  return error instanceof Error && /exceeded \d+ bytes/.test(error.message);
}

async function readBounded(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ReceivedEmailRejectedError("too_large", "Received email is too large");
  }
  try {
    return Buffer.from(await readResponseBytesWithinLimit(response, maxBytes));
  } catch (error) {
    if (isLimitError(error)) {
      throw new ReceivedEmailRejectedError("too_large", "Received email is too large");
    }
    throw error;
  }
}

/** Downloads the original MIME of a received email, never more than `maxBytes`. */
export async function fetchReceivedEmailRaw(
  emailId: string,
  maxBytes: number,
): Promise<ReceivedEmailRaw> {
  assertReceivedEmailId(emailId);
  const envelopeResponse = await fetch(`${RECEIVING_API}/${emailId}`, {
    headers: { Authorization: `Bearer ${requireApiKey()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (envelopeResponse.status === 404) {
    await envelopeResponse.body?.cancel().catch(() => undefined);
    return { status: "unavailable", reason: "not_found" };
  }
  if (!envelopeResponse.ok) {
    await envelopeResponse.body?.cancel().catch(() => undefined);
    throw new Error(`Could not retrieve received email (${envelopeResponse.status})`);
  }
  // Only the raw URL is needed, so the JSON envelope is read under a small cap.
  const envelope = envelopeSchema.parse(
    JSON.parse(
      (await readBounded(envelopeResponse, MAX_ENVELOPE_BYTES)).toString("utf8"),
    ),
  );
  if (envelope.id && envelope.id !== emailId) {
    throw new ReceivedEmailRejectedError(
      "mismatch",
      "Received email does not match the requested id",
    );
  }
  const downloadUrl = envelope.raw?.download_url;
  if (!downloadUrl) return { status: "unavailable", reason: "no_raw_url" };
  if (new URL(downloadUrl).protocol !== "https:") {
    throw new Error("Received email raw download URL is not https");
  }

  const rawResponse = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (rawResponse.status === 404 || rawResponse.status === 410) {
    await rawResponse.body?.cancel().catch(() => undefined);
    return { status: "unavailable", reason: "raw_gone" };
  }
  if (!rawResponse.ok) {
    await rawResponse.body?.cancel().catch(() => undefined);
    throw new Error(`Could not download received email (${rawResponse.status})`);
  }
  return { status: "available", raw: await readBounded(rawResponse, maxBytes) };
}

export type ReceivedAttachmentFile = {
  filename: string;
  contentType: string;
  size: number;
  bytes: Buffer;
};

export type ReceivedAttachmentResult = {
  files: ReceivedAttachmentFile[];
  /** Wanted attachments not imported (limits, download failure, missing); at most 20. */
  omitted: Array<{ filename: string; reason: string }>;
  /** Omissions beyond the 20 listed. */
  omittedMore: number;
};

/**
 * Best-effort bounded attachment download for `emailId`. `wanted` are the
 * attachments the inbox reported for this email; anything else the Receiving
 * API lists is ignored, and every wanted attachment is either returned or
 * named in `omitted` (bounded; the rest are counted in `omittedMore`).
 * Failures are reported, never thrown, and file bytes stay untrusted data.
 */
export async function fetchReceivedEmailAttachments(
  emailId: string,
  wanted: ReadonlyArray<{ id: string; filename: string | null }>,
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number },
): Promise<ReceivedAttachmentResult> {
  const files: ReceivedAttachmentFile[] = [];
  const omissions: ReceivedAttachmentResult["omitted"] = [];
  const result = (): ReceivedAttachmentResult => ({
    files,
    omitted: omissions.slice(0, MAX_OMISSIONS),
    omittedMore: Math.max(0, omissions.length - MAX_OMISSIONS),
  });
  if (wanted.length === 0) return result();
  const displayName = (filename: string | null) => filename?.trim() || "attachment";
  const omit = (filename: string | null, reason: string) =>
    omissions.push({ filename: displayName(filename), reason });

  let listed: ResendReceivedAttachment[];
  try {
    assertReceivedEmailId(emailId);
    const listing = await listReceivedEmailAttachments(emailId);
    if (listing.status !== "ok") {
      for (const item of wanted) omit(item.filename, "attachments were not retrieved");
      return result();
    }
    listed = listing.data;
  } catch {
    for (const item of wanted) omit(item.filename, "attachments could not be retrieved");
    return result();
  }

  const byId = new Map(listed.map((item) => [item.id, item]));
  let totalBytes = 0;
  for (const [index, item] of wanted.entries()) {
    if (index >= limits.maxFiles) {
      omit(item.filename, "too many attachments");
      continue;
    }
    const attachment = byId.get(item.id);
    if (!attachment) {
      omit(item.filename, "not available from Resend");
      continue;
    }
    const filename = attachment.filename ?? item.filename;
    if ((attachment.size ?? 0) > limits.maxFileBytes) {
      omit(filename, "file is too large");
      continue;
    }
    try {
      if (new URL(attachment.downloadUrl).protocol !== "https:") {
        omit(filename, "download link is not https");
        continue;
      }
      const response = await fetch(attachment.downloadUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        omit(filename, "download failed");
        continue;
      }
      const bytes = await readBounded(response, limits.maxFileBytes);
      if (totalBytes + bytes.length > limits.maxTotalBytes) {
        omit(filename, "attachments exceed the total size limit");
        continue;
      }
      totalBytes += bytes.length;
      files.push({
        filename: displayName(filename),
        contentType: attachment.contentType || "application/octet-stream",
        size: bytes.length,
        bytes,
      });
    } catch (error) {
      omit(
        filename,
        error instanceof ReceivedEmailRejectedError
          ? "file is too large"
          : "download failed",
      );
    }
  }
  return result();
}
