"use node";

import { z } from "zod";
import { decideWithFallback, type DecisionQuestion } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "./models";
import type { RequirementScope } from "./complianceTypes";
import type { WorkflowOutcome } from "./workflows/types";

type AttachmentCandidate = {
  filename: string;
  contentType: string;
  fileId?: Id<"_storage">;
};

const REQUIREMENT_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
]);

const RequirementAttachmentDecisionSchema = z.object({
  intent: z.enum([
    "import_new_requirements",
    "analyze_new_requirements",
    "use_existing_requirements",
    "no_import",
    "ambiguous",
  ]),
  intentEvidence: z.string().max(240),
  scope: z.enum(["vendors", "own_org", "mixed", "ambiguous"]),
  selectedFileIds: z.array(z.string()).max(20),
  documents: z
    .array(
      z.object({
        fileId: z.string(),
        classification: z.enum([
          "insurance_requirements",
          "insurance_policy",
          "certificate",
          "other",
        ]),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
  confidence: z.number().min(0).max(1),
});

type RequirementAttachmentDecision = z.infer<
  typeof RequirementAttachmentDecisionSchema
>;

type RequirementImportResolution<T extends AttachmentCandidate> =
  | {
      authorization: "none";
      attachments: [];
      decision?: RequirementAttachmentDecision;
    }
  | {
      authorization: "auto" | "confirmation";
      attachments: Array<T & { fileId: Id<"_storage"> }>;
      scope: RequirementScope;
      decision: RequirementAttachmentDecision;
    };

type ImportableRequirementAttachment = AttachmentCandidate & {
  fileId: Id<"_storage">;
};

type RequirementImportResult = {
  filename: string;
  sourceDocumentId: Id<"requirementSourceDocuments">;
  requirementIds: Id<"insuranceRequirements">[];
  createdCount: number;
};

type RequirementImportConfirmationPayload = Extract<
  Doc<"threadActionConfirmations">["payload"],
  { kind: "requirement_import" }
>;

function supportedRequirementCandidate(attachment: AttachmentCandidate) {
  const extension = attachment.filename.toLowerCase().split(".").pop() ?? "";
  const contentType = attachment.contentType.toLowerCase();
  return (
    REQUIREMENT_DOCUMENT_EXTENSIONS.has(extension) ||
    contentType === "application/pdf" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "text/csv"
  );
}

export function validateRequirementAttachmentDecision<
  T extends AttachmentCandidate,
>(value: unknown, attachments: T[]): RequirementImportResolution<T> {
  const parsed = RequirementAttachmentDecisionSchema.safeParse(value);
  if (!parsed.success) return { authorization: "none", attachments: [] };

  const decision = parsed.data;
  const candidates = new Map(
    attachments
      .filter(
        (attachment): attachment is T & { fileId: Id<"_storage"> } =>
          Boolean(attachment.fileId) &&
          supportedRequirementCandidate(attachment),
      )
      .map((attachment) => [String(attachment.fileId), attachment]),
  );
  const classifications = new Map(
    decision.documents.map((document) => [document.fileId, document]),
  );
  const selected = [...new Set(decision.selectedFileIds)].flatMap((fileId) => {
    const attachment = candidates.get(fileId);
    const classification = classifications.get(fileId);
    return attachment &&
      classification?.classification === "insurance_requirements"
      ? [attachment]
      : [];
  });
  const explicitlyUsesNewSource =
    decision.intent === "import_new_requirements" ||
    decision.intent === "analyze_new_requirements";
  if (!explicitlyUsesNewSource || selected.length === 0) {
    return { authorization: "none", attachments: [], decision };
  }

  const scope =
    decision.scope === "vendors" || decision.scope === "own_org"
      ? decision.scope
      : undefined;
  if (!scope) {
    return { authorization: "none", attachments: [], decision };
  }
  const selectedConfidence = Math.min(
    ...selected.map(
      (attachment) =>
        classifications.get(String(attachment.fileId))?.confidence ?? 0,
    ),
  );
  const autoAuthorized =
    Boolean(decision.intentEvidence.trim()) &&
    decision.confidence >= 0.9 &&
    selectedConfidence >= 0.9;

  return {
    authorization: autoAuthorized ? "auto" : "confirmation",
    attachments: selected,
    scope,
    decision,
  };
}

export async function decideRequirementAttachmentImport<
  T extends AttachmentCandidate,
>(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    attachments: T[];
  },
): Promise<RequirementImportResolution<T>> {
  const candidates = args.attachments.filter(
    (attachment) =>
      attachment.fileId && supportedRequirementCandidate(attachment),
  );
  if (candidates.length === 0) {
    return { authorization: "none", attachments: [] };
  }

  if (candidates.length > 20 || args.messageText.length > 240) {
    return reasonRequirementAttachmentImport(ctx, args);
  }
  const intents = [
    "import_new_requirements",
    "analyze_new_requirements",
    "use_existing_requirements",
    "no_import",
    "ambiguous",
  ];
  const scopes = ["vendors", "own_org", "mixed", "ambiguous"];
  const classes = [
    "insurance_requirements",
    "insurance_policy",
    "certificate",
    "other",
  ];
  const questions: Record<string, DecisionQuestion> = {
    intent: choiceQuestion(
      "Does the current user's message explicitly request using newly attached files as canonical insurance requirements? Honor negation; comparing a policy with saved requirements does not import the policy.",
      {
        import_new_requirements:
          "Explicitly import or save new attached requirement sources.",
        analyze_new_requirements:
          "Explicitly analyze new attached requirements as the canonical source.",
        use_existing_requirements:
          "Use already saved requirements; attached policies are comparison evidence.",
        no_import:
          "No requested import, or explicit instruction not to persist the attachment.",
        ambiguous: "The requested use of the attachment is unclear.",
      },
    ),
    scope: choiceQuestion(
      "Whose insurance obligations are imposed by the new requirements?",
      {
        vendors:
          "Obligations of vendors, contractors, suppliers or tenants serving this organization.",
        own_org:
          "Obligations of this organization imposed by a client, landlord, lender or investor.",
        mixed: "Both kinds explicitly present.",
        ambiguous: "The obligated party is not explicit.",
      },
    ),
  };
  candidates.forEach((candidate, index) => {
    questions[`document_${index}`] = choiceQuestion(
      "What type of document is this exact attachment, based on explicit current-user evidence? A filename alone is insufficient; abstain when content interpretation is needed.",
      Object.fromEntries(classes.map((value) => [value, value])),
      { attachment: decisionState(candidate) },
    );
    questions[`selected_${index}`] = choiceQuestion(
      "Does the current user explicitly select this exact attachment as a new requirement source?",
      {
        yes: "Explicitly selected as a requirement source.",
        no: "Not selected as a requirement source.",
      },
      { attachment: decisionState(candidate) },
    );
  });
  return decideWithFallback<RequirementImportResolution<T>>({
    ctx,
    orgId: args.orgId,
    family: "intent.requirement_import",
    state: decisionState({
      currentMessage: args.messageText,
      attachments: candidates,
    }),
    questions,
    accept: (answers) => {
      const intent = acceptedChoice(answers.intent, intents);
      if (!intent) return undefined;
      if (["no_import", "use_existing_requirements"].includes(intent.value))
        return { authorization: "none", attachments: [] };
      if (intent.value === "ambiguous") return undefined;
      const scope = acceptedChoice(answers.scope, scopes);
      if (
        !scope ||
        !["vendors", "own_org"].includes(scope.value) ||
        !args.messageText.trim()
      )
        return undefined;
      const documents = [];
      const selectedFileIds: string[] = [];
      const confidences = [intent.confidence, scope.confidence];
      for (const [index, candidate] of candidates.entries()) {
        const selected = acceptedChoice(answers[`selected_${index}`], [
          "yes",
          "no",
        ]);
        if (!selected) return undefined;
        confidences.push(selected.confidence);
        if (selected.value === "no") continue;
        const kind = acceptedChoice(answers[`document_${index}`], classes);
        if (!kind || kind.value !== "insurance_requirements") return undefined;
        selectedFileIds.push(String(candidate.fileId));
        documents.push({
          fileId: String(candidate.fileId),
          classification: kind.value,
          confidence: kind.confidence,
        });
      }
      if (!selectedFileIds.length) return undefined;
      return validateRequirementAttachmentDecision(
        {
          intent: intent.value,
          intentEvidence: args.messageText.trim(),
          scope: scope.value,
          selectedFileIds,
          documents,
          confidence: Math.min(...confidences),
        },
        candidates,
      );
    },
    fallback: () => reasonRequirementAttachmentImport(ctx, args),
  });
}

async function reasonRequirementAttachmentImport<T extends AttachmentCandidate>(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    attachments: T[];
  },
): Promise<RequirementImportResolution<T>> {
  const candidates = args.attachments.filter(
    (attachment) =>
      attachment.fileId && supportedRequirementCandidate(attachment),
  );
  try {
    const { object } = await generateObjectForOrg(
      ctx,
      args.orgId,
      "classification",
      {
        schema: RequirementAttachmentDecisionSchema,
        maxOutputTokens: 700,
        system: `Classify whether the user explicitly wants newly attached files treated as canonical insurance-requirement sources.

Return structured evidence only. Distinguish agreements, leases, contracts, insurance schedules, and requirement packets from insurance policies, binders, declarations, endorsements, and certificates. A request to compare a policy with already-saved requirements is not a request to import the policy. Negated persistence instructions are no_import. Scope must be vendors only when the requirements govern vendors/contractors/suppliers/tenants, own_org only when they govern the user's organization, mixed when both are explicit, and ambiguous otherwise. Select only exact file IDs from the supplied candidates. Confidence measures the entire decision, and each document gets its own classification confidence.`,
        prompt: JSON.stringify({
          message: args.messageText,
          attachments: candidates.map((attachment) => ({
            fileId: String(attachment.fileId),
            filename: attachment.filename,
            contentType: attachment.contentType,
          })),
        }),
      },
    );
    return validateRequirementAttachmentDecision(object, candidates);
  } catch {
    return { authorization: "none", attachments: [] };
  }
}

export function buildRequirementImportConfirmation(
  resolution: RequirementImportResolution<AttachmentCandidate>,
):
  | {
      message: string;
      payload: RequirementImportConfirmationPayload;
    }
  | undefined {
  if (resolution.authorization !== "confirmation") {
    return undefined;
  }
  const { decision } = resolution;
  return {
    message: `Confirm importing ${resolution.attachments.map(({ filename }) => filename).join(", ")} as ${resolution.scope === "vendors" ? "vendor" : "your organization's"} insurance requirements.`,
    payload: {
      kind: "requirement_import",
      fileIds: resolution.attachments.map(({ fileId }) => fileId),
      classifications: resolution.attachments.map((attachment) => ({
        fileId: attachment.fileId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        documentClass: "insurance_requirements",
        confidence:
          decision.documents.find(
            (document) => document.fileId === String(attachment.fileId),
          )?.confidence ?? 0,
      })),
      scope: resolution.scope,
      confidence: decision.confidence,
      intentEvidence: decision.intentEvidence,
    },
  };
}

export async function importRequirementSources(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    attachments: ImportableRequirementAttachment[];
    scope?: RequirementScope;
  },
) {
  const imports: RequirementImportResult[] = [];
  for (const attachment of args.attachments) {
    const imported = await ctx.runAction(
      internal.actions.complianceRequirements.importRequirementsInternal,
      {
        orgId: args.orgId,
        userId: args.userId,
        fileId: attachment.fileId,
        fileName: attachment.filename,
        contentType: attachment.contentType,
        sourceName: attachment.filename,
        scope: args.scope,
      },
    );
    imports.push({ filename: attachment.filename, ...imported });
  }
  const createdCount = imports.reduce(
    (total, imported) => total + imported.createdCount,
    0,
  );
  const workflowOutcome: WorkflowOutcome<"requirement_import"> = {
    workflowKind: "requirement_import",
    status: "completed",
    nextAction: "review_imported_requirements",
    requiredSlots: [],
    forbiddenQuestions: [],
    forbiddenClaims: ["import_completed_without_import_completed_side_effect"],
    sideEffects: imports.flatMap((imported) => [
      {
        kind: "import_completed" as const,
        targetType: "requirementSourceDocument",
        targetId: String(imported.sourceDocumentId),
      },
      ...imported.requirementIds.map((requirementId) => ({
        kind: "record_created" as const,
        targetType: "insuranceRequirement",
        targetId: String(requirementId),
      })),
    ]),
    artifacts: imports.flatMap((imported) => [
      {
        type: "requirement_source_document",
        id: String(imported.sourceDocumentId),
      },
      ...imported.requirementIds.map((requirementId) => ({
        type: "insurance_requirement",
        id: String(requirementId),
      })),
    ]),
    comms: {
      headline: `${imports.length} requirement source${imports.length === 1 ? " was" : "s were"} imported.`,
    },
    audit: [
      {
        step: "requirement_import",
        decision: "completed",
        detail: `${createdCount} requirements created`,
      },
    ],
  };
  return { imports, createdCount, workflowOutcome };
}

export function importConfirmedRequirementSources(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    payload: RequirementImportConfirmationPayload;
  },
) {
  return importRequirementSources(ctx, {
    orgId: args.orgId,
    userId: args.userId,
    attachments: args.payload.classifications.map((document) => ({
      fileId: document.fileId,
      filename: document.filename,
      contentType: document.contentType,
    })),
    scope: args.payload.scope,
  });
}

export function confirmedRequirementImportMessage(result: {
  imports: RequirementImportResult[];
  createdCount: number;
}) {
  return `Imported ${result.createdCount} insurance requirement${result.createdCount === 1 ? "" : "s"} from the confirmed source${result.imports.length === 1 ? "" : "s"}.`;
}

const REQUIRED_REQUIREMENT_TOOLS = [
  "import_requirement_attachments",
  "lookup_compliance_requirements",
] as const;

export function requiredRequirementImportStep(
  stepNumber: number,
  hasAuthorizedRequirementAttachments: boolean,
) {
  if (!hasAuthorizedRequirementAttachments) return undefined;
  const toolName = REQUIRED_REQUIREMENT_TOOLS[stepNumber];
  if (!toolName) return undefined;
  return {
    toolChoice: {
      type: "tool" as const,
      toolName,
    },
  };
}
