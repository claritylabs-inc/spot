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
  const envelope = envelopeSchema.parse(await envelopeResponse.json());
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
  /** Attachments not imported (limits, download failure, missing list). */
  omitted: Array<{ filename: string; reason: string }>;
};

/**
 * Best-effort bounded attachment download for `emailId`. `wanted` are the
 * attachment ids the inbox reported for this email; anything else the
 * Receiving API lists is ignored. Failures are reported in `omitted`, never
 * thrown, and file bytes stay untrusted data.
 */
export async function fetchReceivedEmailAttachments(
  emailId: string,
  wanted: ReadonlyArray<{ id: string; filename: string | null }>,
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number },
): Promise<ReceivedAttachmentResult> {
  const files: ReceivedAttachmentFile[] = [];
  const omitted: ReceivedAttachmentResult["omitted"] = [];
  if (wanted.length === 0) return { files, omitted };
  const displayName = (filename: string | null) => filename?.trim() || "attachment";
  const omitAll = (reason: string) => ({
    files,
    omitted: wanted.map((item) => ({ filename: displayName(item.filename), reason })),
  });

  let listed: ResendReceivedAttachment[];
  try {
    assertReceivedEmailId(emailId);
    const result = await listReceivedEmailAttachments(emailId);
    if (result.status !== "ok") return omitAll("attachments were not retrieved");
    listed = result.data;
  } catch {
    return omitAll("attachments could not be retrieved");
  }

  const wantedIds = new Set(wanted.map((item) => item.id));
  const candidates = listed.filter((item) => wantedIds.has(item.id));
  let totalBytes = 0;
  for (const [index, attachment] of candidates.entries()) {
    const filename = displayName(attachment.filename);
    if (index >= limits.maxFiles) {
      omitted.push({ filename, reason: "too many attachments" });
      continue;
    }
    if ((attachment.size ?? 0) > limits.maxFileBytes) {
      omitted.push({ filename, reason: "file is too large" });
      continue;
    }
    try {
      if (new URL(attachment.downloadUrl).protocol !== "https:") {
        omitted.push({ filename, reason: "download link is not https" });
        continue;
      }
      const response = await fetch(attachment.downloadUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        omitted.push({ filename, reason: "download failed" });
        continue;
      }
      const bytes = await readBounded(response, limits.maxFileBytes);
      if (totalBytes + bytes.length > limits.maxTotalBytes) {
        omitted.push({ filename, reason: "attachments exceed the total size limit" });
        continue;
      }
      totalBytes += bytes.length;
      files.push({
        filename,
        contentType: attachment.contentType || "application/octet-stream",
        size: bytes.length,
        bytes,
      });
    } catch (error) {
      omitted.push({
        filename,
        reason:
          error instanceof ReceivedEmailRejectedError
            ? "file is too large"
            : "download failed",
      });
    }
  }
  return { files, omitted };
}
