"use node";

import { z } from "zod";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";
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

/** Probabilities from independent single-property questions; code composes them. */
const RequirementAttachmentDecisionSchema = z.object({
  /** `message` asks to use newly attached files as requirement sources. */
  wantsNewRequirements: z.number().min(0).max(1),
  /** `message` says not to save, import, or store the attachments. */
  persistenceNegated: z.number().min(0).max(1),
  scope: z.enum(["vendors", "own_org", "mixed"]),
  scopeConfidence: z.number().min(0).max(1),
  intentEvidence: z.string().max(240),
  documents: z
    .array(
      z.object({
        fileId: z.string(),
        /** The file is an agreement, lease, contract, or requirements schedule. */
        isRequirementsSource: z.number().min(0).max(1),
        /** `message` points at this file (or at all attachments). */
        selectedByUser: z.number().min(0).max(1),
      }),
    )
    .max(20),
});

type RequirementAttachmentDecision = z.infer<
  typeof RequirementAttachmentDecisionSchema
> & {
  /** Per selected file: the weaker of its type and selection answers. */
  selectedConfidence: Record<string, number>;
  /** Weakest answer behind the decision; Jev's own certainty, not a blend. */
  confidence: number;
};

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

/** Above 0.5 is a "yes"; a Noul near 0.5 is unsure and never counts as one. */
const isYes = (probability: number) => probability > 0.5;

export function validateRequirementAttachmentDecision<
  T extends AttachmentCandidate,
>(
  value: unknown,
  attachments: T[],
): RequirementImportResolution<T> {
  const parsed = RequirementAttachmentDecisionSchema.safeParse(value);
  if (!parsed.success) return { authorization: "none", attachments: [] };

  const raw = parsed.data;
  const candidates = new Map(
    attachments
      .filter(
        (attachment): attachment is T & { fileId: Id<"_storage"> } =>
          Boolean(attachment.fileId) && supportedRequirementCandidate(attachment),
      )
      .map((attachment) => [String(attachment.fileId), attachment]),
  );
  const selectedConfidence: Record<string, number> = {};
  const selected = [
    ...new Map(raw.documents.map((document) => [document.fileId, document])),
  ].flatMap(([fileId, document]) => {
    const attachment = candidates.get(fileId);
    if (
      !attachment ||
      !isYes(document.isRequirementsSource) ||
      !isYes(document.selectedByUser)
    )
      return [];
    selectedConfidence[fileId] = Math.min(
      document.isRequirementsSource,
      document.selectedByUser,
    );
    return [attachment];
  });
  const decision: RequirementAttachmentDecision = {
    ...raw,
    selectedConfidence,
    confidence: Math.min(
      raw.wantsNewRequirements,
      1 - raw.persistenceNegated,
      raw.scopeConfidence,
      ...Object.values(selectedConfidence),
    ),
  };
  if (
    !isYes(raw.wantsNewRequirements) ||
    isYes(raw.persistenceNegated) ||
    selected.length === 0 ||
    raw.scope === "mixed"
  ) {
    return { authorization: "none", attachments: [], decision };
  }

  const autoAuthorized =
    Boolean(raw.intentEvidence.trim()) && jevProceeds(decision.confidence);

  return {
    authorization: autoAuthorized ? "auto" : "confirmation",
    attachments: selected,
    scope: raw.scope,
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
    // Ids stay out of the model's view; state keys are the only handles.
    const attachmentKeys = candidates.map((_, index) => `d${index}`);
    const result = await clRouterDecide({
      orgId: args.orgId,
      task: "requirement_attachment_import",
      state: {
        message: args.messageText,
        attachments: Object.fromEntries(
          candidates.map((attachment, index) => [
            attachmentKeys[index],
            { filename: attachment.filename },
          ]),
        ),
      },
      questions: {
        wants_new_requirements: {
          type: "noul",
          instructions: {
            question:
              "Does `message` ask to use the newly attached files as sources of insurance requirements?",
            focus:
              "Importing or analyzing the attached files as requirement sources.",
            not_for:
              "Checking a policy or certificate against requirements that are already saved; asking about the files without asking to use them as requirements.",
          },
        },
        persistence_negated: {
          type: "noul",
          instructions: {
            question:
              "Does `message` tell the assistant not to save, import, or store the attached files or the requirements in them?",
            focus: "Explicit refusals such as 'don't save this' or 'just read it'.",
          },
        },
        scope: {
          type: "choice",
          instructions:
            "Whose obligations are described by the insurance requirements the user wants taken from the attached files, according to `message`?",
          criteria: {
            vendors: {
              what: "Requirements that vendors, contractors, suppliers, or tenants must satisfy.",
              not_for: "Requirements the user's own organization must satisfy.",
            },
            own_org: {
              what: "Requirements the user's own organization must satisfy.",
              not_for: "Requirements placed on vendors, contractors, or tenants.",
            },
            mixed: {
              what: "Both groups are named explicitly for the same files.",
            },
          },
        },
        ...Object.fromEntries(
          candidates.flatMap((attachment, index) => [
            [
              `doc_${index}_is_requirements_source`,
              {
                type: "noul" as const,
                instructions: {
                  question: `Judging by the filename in \`attachments.${attachmentKeys[index]}.filename\`, is this an agreement, lease, contract, or schedule of insurance requirements?`,
                  not_for:
                    "An insurance policy, binder, declarations page, endorsement, or certificate of insurance.",
                },
              },
            ],
            [
              `doc_${index}_selected_by_user`,
              {
                type: "noul" as const,
                instructions: {
                  question: `Does \`message\` refer to the file named in \`attachments.${attachmentKeys[index]}.filename\`, or to all the attachments, as a file to use?`,
                  not_for: "A message that points only at other attachments.",
                },
              },
            ],
          ]),
        ),
      },
    }, { telemetry: _ctx });
    const noul = (id: string) => {
      const answer = result.answers[id];
      return answer?.type === "noul" ? answer.noul : undefined;
    };
    const scope = result.answers.scope;
    const wantsNewRequirements = noul("wants_new_requirements");
    const persistenceNegated = noul("persistence_negated");
    if (
      scope?.type !== "choice" ||
      wantsNewRequirements === undefined ||
      persistenceNegated === undefined
    ) {
      return { authorization: "none", attachments: [] };
    }
    return validateRequirementAttachmentDecision(
      {
        wantsNewRequirements,
        persistenceNegated,
        scope: scope.choice,
        scopeConfidence: Math.min(
          scope.confidence,
          scope.probabilities[scope.choice] ?? 0,
        ),
        intentEvidence: args.messageText.slice(0, 240),
        documents: candidates.map((attachment, index) => ({
          fileId: String(attachment.fileId),
          isRequirementsSource: noul(`doc_${index}_is_requirements_source`) ?? 0,
          selectedByUser: noul(`doc_${index}_selected_by_user`) ?? 0,
        })),
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
        confidence: decision.selectedConfidence[String(attachment.fileId)] ?? 0,
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
