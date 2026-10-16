import { extractEmailAddress, normalizeEmailAddress } from "./emailAddress";

export type EmailAttachmentLike = {
  filename: string;
  kind?: "coi" | "original_policy" | "uploaded_file" | "generated_document";
};

export type RequestedEmailAttachment = {
  kind: "original_policy" | "coi" | "uploaded_file";
  policyId?: string;
  fileId?: string;
  filename?: string;
  certificateHolder?: string;
  holderContactName?: string;
  holderEmail?: string;
  holderPhone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  requestText?: string;
  requestedEndorsements?: string[];
  requirementSourceDocumentId?: string;
  requirementId?: string;
  explicitArtifactRequest?: "original_policy_document";
  intentEvidence?: string;
};

export const MULTIPLE_COI_SINGLE_RECIPIENT_WARNING =
  "This draft contains multiple COIs for one recipient. Confirm the exact recipient and attachment list before sending.";

/**
 * Fallback for attachments without a `kind`. `\b` treats `_` as a word
 * character, so "ACME_COI.pdf" needs explicit alphanumeric boundaries.
 */
export function isCoiAttachmentFilename(
  filename: string | undefined,
): boolean {
  return /(?<![a-z0-9])(coi|certificate[-_\s]?of[-_\s]?insurance)(?![a-z0-9])/i.test(
    filename ?? "",
  );
}

export function normalizeAttachmentText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function countCoiAttachments(
  attachments: EmailAttachmentLike[] | undefined,
): number {
  return (attachments ?? []).filter(
    (attachment) =>
      attachment.kind === "coi" ||
      (!attachment.kind && isCoiAttachmentFilename(attachment.filename)),
  ).length;
}

export function resolveRequestedCoiAttachmentsForRecipient(input: {
  to?: string;
  defaultTo?: string;
  attachments?: RequestedEmailAttachment[];
}): {
  attachments: RequestedEmailAttachment[];
  requiresCoiBatchConfirmation: boolean;
} {
  const recipient = normalizeEmailAddress(
    extractEmailAddress(input.to) ?? extractEmailAddress(input.defaultTo) ?? "",
  );
  const attachments = (input.attachments ?? []).filter((attachment) => {
    if (attachment.kind !== "original_policy") return true;
    return (
      attachment.explicitArtifactRequest === "original_policy_document" &&
      Boolean(attachment.policyId) &&
      Boolean(attachment.intentEvidence?.trim()) &&
      Boolean(recipient)
    );
  });
  const coiAttachments = attachments.filter(
    (attachment) => attachment.kind === "coi",
  );
  const requiresCoiBatchConfirmation = coiAttachments.length > 1;
  return {
    attachments,
    requiresCoiBatchConfirmation,
  };
}
