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

type FingerprintedDraft = Pick<
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
  | "orgId"
  | "senderUserId"
  | "fromHeader"
  | "transport"
  | "procurementRequestId"
  | "teamEmailThreadId"
  | "inReplyTo"
  | "references"
  | "renderedText"
  | "renderedHtml"
>;

/** Operator-agent drafts send only from the operator's own inbox, never as a client agent. */
export function isOperatorEmailDraft(
  draft: Pick<
    Doc<"pendingEmails">,
    "operatorThreadId" | "senderUserId" | "transport"
  >,
): boolean {
  return Boolean(
    draft.operatorThreadId || draft.senderUserId || draft.transport,
  );
}

/**
 * Binds an approval to the exact draft. Operator drafts also bind the signing
 * operator, From header, transport, link targets, threading headers and the
 * rendered payload; client fingerprints are unchanged.
 */
export async function pendingEmailDraftFingerprint(
  draft: FingerprintedDraft,
): Promise<string> {
  return actionConfirmationFingerprint({
    ...(isOperatorEmailDraft(draft)
      ? {
          operator: {
            senderUserId: draft.senderUserId ? String(draft.senderUserId) : null,
            fromHeader: draft.fromHeader ?? null,
            transport: draft.transport ?? null,
            orgId: draft.orgId ? String(draft.orgId) : null,
            procurementRequestId: draft.procurementRequestId
              ? String(draft.procurementRequestId)
              : null,
            teamEmailThreadId: draft.teamEmailThreadId
              ? String(draft.teamEmailThreadId)
              : null,
            replyTo: parseReplyToAddresses(draft.replyTo).map((a) =>
              a.toLowerCase(),
            ),
            inReplyTo: draft.inReplyTo ?? null,
            references: draft.references ?? null,
            renderedText: draft.renderedText ?? null,
            renderedHtml: draft.renderedHtml ?? null,
          },
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
