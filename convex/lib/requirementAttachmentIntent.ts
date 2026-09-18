"use node";

import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
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
>(
  value: unknown,
  attachments: T[],
): RequirementImportResolution<T> {
  const parsed = RequirementAttachmentDecisionSchema.safeParse(value);
  if (!parsed.success) return { authorization: "none", attachments: [] };

  const decision = parsed.data;
  const candidates = new Map(
    attachments
      .filter(
        (attachment): attachment is T & { fileId: Id<"_storage"> } =>
          Boolean(attachment.fileId) && supportedRequirementCandidate(attachment),
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
  _ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    attachments: T[];
  },
): Promise<RequirementImportResolution<T>> {
  const candidates = args.attachments.filter(
    (attachment) => attachment.fileId && supportedRequirementCandidate(attachment),
  );
  if (candidates.length === 0) {
    return { authorization: "none", attachments: [] };
  }

  try {
    const result = await clRouterDecide({
      orgId: args.orgId,
      task: "requirement_attachment_import",
      state: {
        message: args.messageText,
        attachments: candidates.map((attachment, index) => ({
          candidate: `document_${index}`,
          fileId: String(attachment.fileId),
          filename: attachment.filename,
          contentType: attachment.contentType,
        })),
      },
      questions: {
        intent: {
          type: "choice",
          instructions:
            "Does the current user explicitly want newly attached files treated as canonical insurance-requirement sources? Honor negated persistence instructions. Comparing a policy to saved requirements is not importing it.",
          criteria: {
            import_new_requirements:
              "Explicitly import new attached requirement sources",
            analyze_new_requirements:
              "Explicitly analyze new attached requirement sources",
            use_existing_requirements: "Use already-saved requirements",
            no_import: "No import requested or persistence is negated",
            ambiguous: "Unclear intent",
          },
        },
        scope: {
          type: "choice",
          instructions: "Who do the new insurance requirements govern?",
          criteria: {
            vendors: "Vendors, contractors, suppliers, or tenants",
            own_org: "The user's own organization",
            mixed: "Both explicitly",
            ambiguous: "Unclear scope",
          },
        },
        ...Object.fromEntries(
          candidates.map((attachment, index) => [
            `document_${index}`,
            {
              type: "choice" as const,
              instructions: `Classify candidate document_${index} (${attachment.filename}). Select insurance_requirements only when the user selects this attachment as a new requirement source. Agreements, leases, contracts and requirement schedules may qualify; policies, binders, declarations, endorsements and certificates do not.`,
              criteria: {
                insurance_requirements:
                  "Selected new insurance requirement source",
                insurance_policy:
                  "Policy, binder, declarations, or endorsement",
                certificate: "Insurance certificate",
                other: "Other, unselected, or uncertain document",
              },
            },
          ]),
        ),
      },
    });
    const intent = result.answers.intent;
    const scope = result.answers.scope;
    if (intent?.type !== "choice" || scope?.type !== "choice") {
      return { authorization: "none", attachments: [] };
    }
    const documents = candidates.map((attachment, index) => {
      const answer = result.answers[`document_${index}`];
      return {
        fileId: String(attachment.fileId),
        classification: answer?.type === "choice" ? answer.choice : "other",
        confidence:
          answer?.type === "choice"
            ? (answer.probabilities[answer.choice] ?? 0)
            : 0,
      };
    });
    return validateRequirementAttachmentDecision(
      {
        intent: intent.choice,
        intentEvidence: args.messageText.slice(0, 240),
        scope: scope.choice,
        selectedFileIds: documents
          .filter(
            (document) => document.classification === "insurance_requirements",
          )
          .map((document) => document.fileId),
        documents,
        confidence: Math.min(
          intent.probabilities[intent.choice] ?? 0,
          scope.probabilities[scope.choice] ?? 0,
        ),
      },
      candidates,
    );
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
    forbiddenClaims: [
      "import_completed_without_import_completed_side_effect",
    ],
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
