import { z } from "zod";
import type { DecideResponse } from "../../contracts/cl-router/policy";
import { JEV_PROCEED_THRESHOLD } from "./jevThreshold";

export type ConnectedEmailAutomation = {
  policyImports: boolean;
  requirementImports: boolean;
  companyMemory: boolean;
};

export function effectiveConnectedEmailAutomation(
  automation?: Partial<ConnectedEmailAutomation> | null,
): ConnectedEmailAutomation {
  return {
    policyImports: automation?.policyImports ?? false,
    requirementImports: automation?.requirementImports ?? false,
    companyMemory: automation?.companyMemory ?? false,
  };
}

export function hasConnectedEmailAutomation(
  automation?: Partial<ConnectedEmailAutomation> | null,
) {
  const effective = effectiveConnectedEmailAutomation(automation);
  return (
    effective.policyImports ||
    effective.requirementImports ||
    effective.companyMemory
  );
}

export type MailboxAutomationPolicy = {
  automation: ConnectedEmailAutomation;
  /** Legacy mailbox connected before automation settings existed: never auto-execute, alert only. */
  alertOnly: boolean;
  eligible: boolean;
};

export function resolveMailboxAutomationPolicy(account: {
  scope: "user" | "org";
  automation?: Partial<ConnectedEmailAutomation>;
}): MailboxAutomationPolicy {
  const alertOnly = account.automation === undefined;
  const automation = effectiveConnectedEmailAutomation(account.automation);
  return {
    automation,
    alertOnly,
    eligible: alertOnly
      ? account.scope === "org"
      : hasConnectedEmailAutomation(automation),
  };
}

export const MAILBOX_AUTOMATION_CONFIDENCE_THRESHOLD = JEV_PROCEED_THRESHOLD;

export const mailboxAutomationClassificationSchema = z.enum([
  "ignore",
  "policy_document",
  "insurance_requirements",
  "company_context",
  "multiple",
  "review_needed",
]);

const policyGroupSchema = z.object({
  filenames: z.array(z.string().min(1)).min(1).max(8),
});

export const mailboxAutomationDecisionSchema = z.object({
  emailRef: z.string().min(1),
  classification: mailboxAutomationClassificationSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
  policyGroups: z.array(policyGroupSchema).max(6),
  requirementFilenames: z.array(z.string().min(1)).max(12),
  includeEmailBodyAsRequirements: z.boolean(),
  requirementSourceType: z
    .enum([
      "lease_agreement",
      "client_contract",
      "vendor_requirements",
      "other",
    ])
    .nullable(),
  requirementScope: z.enum(["vendors", "own_org"]).nullable(),
  extractCompanyMemory: z.boolean(),
  attentionTitle: z.string().max(160).nullable(),
  attentionBody: z.string().max(1200).nullable(),
});

export const mailboxAutomationBatchSchema = z.object({
  decisions: z.array(mailboxAutomationDecisionSchema).max(50),
});

export type MailboxAutomationClassification = z.infer<
  typeof mailboxAutomationClassificationSchema
>;
export type MailboxAutomationDecision = z.infer<
  typeof mailboxAutomationDecisionSchema
>;

type MailboxAutomationExtraction = Omit<
  MailboxAutomationDecision,
  | "classification"
  | "confidence"
  | "includeEmailBodyAsRequirements"
  | "requirementSourceType"
  | "requirementScope"
  | "extractCompanyMemory"
>;

export function applyMailboxAutomationJudgments(
  extracted: MailboxAutomationExtraction,
  answers: DecideResponse["answers"],
  attachments: MailboxAttachmentSummary[],
): MailboxAutomationDecision | null {
  const category = answers[`${extracted.emailRef}_classification`];
  const body = answers[`${extracted.emailRef}_body`];
  const memory = answers[`${extracted.emailRef}_memory`];
  const source = answers[`${extracted.emailRef}_source`];
  const scope = answers[`${extracted.emailRef}_scope`];
  if (
    category?.type !== "choice" ||
    body?.type !== "noul" ||
    memory?.type !== "noul" ||
    source?.type !== "choice" ||
    scope?.type !== "choice"
  )
    return null;

  const classification = mailboxAutomationClassificationSchema.parse(
    category.choice,
  );
  const policyCategory =
    classification === "policy_document" || classification === "multiple";
  const requirementCategory =
    classification === "insurance_requirements" ||
    classification === "multiple";
  const memoryCategory =
    classification === "company_context" || classification === "multiple";
  const requirementSourceType = requirementCategory
    ? mailboxAutomationDecisionSchema.shape.requirementSourceType.parse(
        source.choice === "none" ? null : source.choice,
      )
    : null;
  const requirementScope = requirementCategory
    ? mailboxAutomationDecisionSchema.shape.requirementScope.parse(
        scope.choice === "none" ? null : scope.choice,
      )
    : null;
  return sanitizeMailboxAutomationDecision(
    {
      ...extracted,
      classification,
      confidence: Math.min(
        category.confidence,
        ...(requirementCategory
          ? [
              source.confidence,
              scope.confidence,
              requirementSourceType && requirementScope ? 1 : 0,
            ]
          : []),
      ),
      policyGroups: policyCategory ? extracted.policyGroups : [],
      requirementFilenames: requirementCategory
        ? extracted.requirementFilenames
        : [],
      includeEmailBodyAsRequirements:
        requirementCategory &&
        body.noul >= MAILBOX_AUTOMATION_CONFIDENCE_THRESHOLD,
      extractCompanyMemory:
        memoryCategory &&
        memory.noul >= MAILBOX_AUTOMATION_CONFIDENCE_THRESHOLD,
      requirementSourceType,
      requirementScope,
    },
    attachments,
  );
}

export type MailboxAttachmentSummary = {
  filename?: string | null;
  contentType: string;
};

function normalizedFilename(value: string) {
  return value.trim().toLowerCase();
}

export function isSupportedRequirementAttachment(
  attachment: MailboxAttachmentSummary,
) {
  const filename = normalizedFilename(attachment.filename ?? "");
  const contentType = attachment.contentType.toLowerCase();
  return (
    contentType.includes("pdf") ||
    contentType.includes("wordprocessingml") ||
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("csv") ||
    [".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".json"].some(
      (suffix) => filename.endsWith(suffix),
    )
  );
}

export function isPdfMailboxAttachment(attachment: MailboxAttachmentSummary) {
  const filename = normalizedFilename(attachment.filename ?? "");
  return (
    attachment.contentType.toLowerCase().includes("pdf") ||
    filename.endsWith(".pdf")
  );
}

export function sanitizeMailboxAutomationDecision(
  decision: MailboxAutomationDecision,
  attachments: MailboxAttachmentSummary[],
): MailboxAutomationDecision {
  const attachmentByName = new Map(
    attachments.flatMap((attachment) => {
      const filename = attachment.filename?.trim();
      return filename ? [[normalizedFilename(filename), attachment] as const] : [];
    }),
  );
  const seenPolicyFiles = new Set<string>();
  const policyGroups = decision.policyGroups.flatMap((group) => {
    const filenames = group.filenames.filter((filename) => {
      const key = normalizedFilename(filename);
      const attachment = attachmentByName.get(key);
      if (!attachment || seenPolicyFiles.has(key)) return false;
      if (!isPdfMailboxAttachment(attachment)) return false;
      seenPolicyFiles.add(key);
      return true;
    });
    return filenames.length > 0 ? [{ filenames }] : [];
  });
  const requirementFilenames = decision.requirementFilenames.filter((filename) => {
    const attachment = attachmentByName.get(normalizedFilename(filename));
    return attachment ? isSupportedRequirementAttachment(attachment) : false;
  });

  const sanitized = {
    ...decision,
    policyGroups,
    requirementFilenames: [...new Set(requirementFilenames)],
  };
  if (
    sanitized.classification === "ignore" &&
    sanitized.confidence < MAILBOX_AUTOMATION_CONFIDENCE_THRESHOLD
  ) {
    return {
      ...sanitized,
      classification: "review_needed" as const,
      reason: `Low-confidence ignore decision: ${sanitized.reason}`,
    };
  }
  return sanitized;
}

export function canAutoExecuteMailboxDecision(
  decision: MailboxAutomationDecision,
) {
  return (
    decision.classification !== "review_needed" &&
    decision.confidence >= MAILBOX_AUTOMATION_CONFIDENCE_THRESHOLD
  );
}

export function mailboxMessageIdentity(args: {
  accountId: string;
  mailbox: string;
  uidValidity?: string;
  uid: number;
  messageId?: string;
}) {
  const messageId = args.messageId
    ?.trim()
    .replace(/^<|>$/g, "")
    .trim()
    .toLowerCase();
  if (messageId) return `message-id:${messageId}`;
  return [args.accountId, args.mailbox, args.uidValidity ?? "unknown", args.uid].join(":");
}
