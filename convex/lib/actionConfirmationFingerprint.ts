import type { Doc } from "../_generated/dataModel";
import { countCoiAttachments } from "./coiAttachmentGuards";
import { parseReplyToAddresses } from "./emailAddress";

type PendingEmailConfirmationPayload = Extract<
  Doc<"threadActionConfirmations">["payload"],
  { kind: "email_send" | "coi_batch_delivery" }
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export async function actionConfirmationFingerprint(
  value: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function pendingEmailDraftFingerprint(
  draft: Pick<
    Doc<"pendingEmails">,
    | "recipientEmail"
    | "ccAddresses"
    | "bccAddresses"
    | "subject"
    | "emailBody"
    | "attachments"
    | "referencedPolicyIds"
    | "operatorThreadId"
    | "replyTo"
  >,
): Promise<string> {
  return actionConfirmationFingerprint({
    // Operator approvals cover where replies go; client fingerprints are unchanged.
    ...(draft.operatorThreadId
      ? {
          replyTo: parseReplyToAddresses(draft.replyTo).map((a) =>
            a.toLowerCase(),
          ),
        }
      : {}),
    recipientEmail: draft.recipientEmail.trim().toLowerCase(),
    ccAddresses: (draft.ccAddresses ?? []).map((value) =>
      value.trim().toLowerCase(),
    ),
    bccAddresses: (draft.bccAddresses ?? []).map((value) =>
      value.trim().toLowerCase(),
    ),
    subject: draft.subject,
    emailBody: draft.emailBody,
    attachments: (draft.attachments ?? []).map((attachment) => ({
      fileId: String(attachment.fileId),
      filename: attachment.filename,
      kind: attachment.kind,
    })),
    referencedPolicyIds: (draft.referencedPolicyIds ?? []).map(String),
  });
}

export async function buildPendingEmailConfirmation(
  draft: Doc<"pendingEmails">,
): Promise<{
  fingerprint: string;
  payload: PendingEmailConfirmationPayload;
}> {
  const fingerprint = await pendingEmailDraftFingerprint(draft);
  const payload: PendingEmailConfirmationPayload =
    countCoiAttachments(draft.attachments) > 1
      ? {
          kind: "coi_batch_delivery",
          pendingEmailId: draft._id,
          recipientEmail: draft.recipientEmail.trim().toLowerCase(),
          fileIds: (draft.attachments ?? []).map(({ fileId }) => fileId),
          draftFingerprint: fingerprint,
        }
      : {
          kind: "email_send",
          pendingEmailIds: [draft._id],
          draftFingerprints: [fingerprint],
        };
  return { fingerprint, payload };
}
