import type { Doc } from "../_generated/dataModel";
import {
  formatEmailDraftBlockers,
  getEmailDraftBlockers,
} from "./emailWorkflow";

type DraftLike = Pick<
  Doc<"pendingEmails">,
  | "_id"
  | "recipientEmail"
  | "subject"
  | "emailBody"
  | "attachments"
  | "ccAddresses"
  | "bccAddresses"
  | "sendBlockedReason"
>;

function truncate(value: string | undefined, max: number) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function formatAttachmentSummary(draft: DraftLike) {
  const count = draft.attachments?.length ?? 0;
  if (count === 0) return "no attachments";
  if (count === 1) return draft.attachments?.[0]?.filename ?? "1 attachment";
  return `${count} attachments`;
}

export function buildEmailDraftTextSummary(
  drafts: DraftLike[],
  options?: {
    sampleSize?: number;
    includeIds?: boolean;
    includeBodyPreview?: boolean;
    commands?: "chat" | "mcp" | "none";
  },
) {
  const sampleSize = Math.max(1, options?.sampleSize ?? 3);
  const sample = drafts.slice(0, sampleSize);
  const hiddenCount = Math.max(0, drafts.length - sample.length);
  const lines: string[] = [
    drafts.length === 1
      ? "I have 1 email draft ready."
      : `I have ${drafts.length} email drafts ready.`,
  ];

  if (sample.length > 0) {
    lines.push("", drafts.length === sample.length ? "Drafts:" : "Sample:");
  }

  for (const [index, draft] of sample.entries()) {
    const idLine = options?.includeIds ? ` (${draft._id})` : "";
    lines.push(
      `${index + 1}. ${draft.recipientEmail}${idLine}`,
      `   Subject: ${truncate(draft.subject, 80) || "(no subject)"}`,
      `   Attachments: ${formatAttachmentSummary(draft)}`,
    );
    if (draft.ccAddresses?.length) {
      lines.push(`   Cc: ${draft.ccAddresses.join(", ")}`);
    }
    const blockers = getEmailDraftBlockers(draft);
    if (blockers.length > 0) {
      lines.push(
        `   Needs confirmation: ${truncate(formatEmailDraftBlockers(blockers), 120)}`,
      );
    }
    if (options?.includeBodyPreview) {
      lines.push(`   Preview: ${truncate(draft.emailBody, 180) || "(empty body)"}`);
    }
  }

  if (hiddenCount > 0) {
    lines.push("", `${hiddenCount} more not shown.`);
  }

  if (options?.commands === "mcp") {
    lines.push(
      "",
      "Use send_email_drafts with these draft IDs to send a batch, send_email_draft for one draft, or list_email_drafts with showAll=true to see every draft.",
    );
  } else if (options?.commands === "chat") {
    const blockedCount = drafts.filter(
      (draft) => getEmailDraftBlockers(draft).length > 0,
    ).length;
    lines.push(
      "",
      blockedCount > 0
        ? blockedCount === 1
          ? 'Reply with the correct email address to update it, or "cancel drafts" to cancel.'
          : 'Some drafts need confirmation. Reply "show more" to review them, or "cancel drafts" to cancel.'
        : drafts.length > sample.length
        ? 'Reply "show more" to see all drafts, "send all" to send them, or "cancel drafts" to cancel.'
        : 'Reply "send all" to send, or "cancel drafts" to cancel.',
    );
  }

  return lines.join("\n");
}
