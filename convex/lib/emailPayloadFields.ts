import type { Doc } from "../_generated/dataModel";

export type StoredEmailPayloadFields = Pick<
  Doc<"pendingEmails">,
  | "fromHeader"
  | "replyTo"
  | "inReplyTo"
  | "references"
  | "renderedText"
  | "renderedHtml"
  | "ccAddresses"
  | "bccAddresses"
>;

export function parseEmailPayloadRecord(
  emailPayload: string | undefined,
): Record<string, unknown> {
  if (!emailPayload) return {};
  try {
    const parsed: unknown = JSON.parse(emailPayload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function addressList(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value];
  if (!Array.isArray(value)) return undefined;
  const addresses = value.filter(
    (item): item is string => typeof item === "string" && !!item.trim(),
  );
  return addresses.length ? addresses : undefined;
}

// Retained only while existing serialized drafts are backfilled.
export function readStoredEmailFields(
  pending: StoredEmailPayloadFields & { emailPayload?: string },
): StoredEmailPayloadFields {
  const payload = parseEmailPayloadRecord(pending.emailPayload);
  const headers =
    payload.headers && typeof payload.headers === "object"
      ? (payload.headers as Record<string, unknown>)
      : {};

  return {
    fromHeader: pending.fromHeader ?? stringField(payload.from),
    replyTo: pending.replyTo ?? stringField(payload.reply_to),
    inReplyTo: pending.inReplyTo || stringField(headers["In-Reply-To"]),
    references: (pending.references ?? pending.inReplyTo) || stringField(headers.References) || "",
    renderedText: pending.renderedText ?? stringField(payload.text),
    renderedHtml: pending.renderedHtml ?? stringField(payload.html),
    ccAddresses: pending.ccAddresses ?? addressList(payload.cc),
    bccAddresses: pending.bccAddresses ?? addressList(payload.bcc),
  };
}

export function pendingEmailCanonicalPatch(
  pending: Doc<"pendingEmails">,
): (StoredEmailPayloadFields & { emailPayload: undefined }) | null {
  if (pending.emailPayload === undefined) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(pending.emailPayload);
  } catch {
    throw new Error("Cannot migrate an email with invalid serialized content.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Cannot migrate an email with invalid serialized content.");
  }
  const headers = "headers" in payload ? payload.headers : undefined;
  if (headers && typeof headers === "object") {
    const unsupported = Object.entries(headers).some(
      ([name, value]) =>
        typeof value === "string" && !!value.trim() &&
        !["In-Reply-To", "References", "Message-ID"].includes(name),
    );
    if (unsupported) {
      throw new Error("Review this email's unsupported delivery headers before migration.");
    }
  }
  const fields = readStoredEmailFields(pending);
  if ((pending.status === "draft" || pending.status === "pending") && !fields.fromHeader) {
    throw new Error("Review this email's missing sender before migration.");
  }
  return { ...fields, emailPayload: undefined };
}
