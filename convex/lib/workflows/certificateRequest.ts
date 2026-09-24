import { inferCertificateEndorsements } from "../certificateRequestGate";
import { workflowCommsPlan } from "./comms";
import type {
  WorkflowArtifact,
  WorkflowAuditEntry,
  WorkflowOutcome,
  WorkflowSideEffect,
} from "./types";

export type CertificateRequestNextAction =
  | "return_existing_certificate"
  | "generate_certificate"
  | "hold_for_broker_follow_up"
  | "wait_for_extraction"
  | "wait_for_source_tree"
  | "report_failure";

export type CertificateRequestWorkflowParams = {
  policyId?: string;
  requirementSourceDocumentId?: string;
  requirementId?: string;
  holderName: string;
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
  descriptionOfOperations?: string;
  requestedEndorsements?: string[];
};

export const CERTIFICATE_FORBIDDEN_QUESTIONS = [
  "holderEmail",
  "specialWording",
  "requestedEndorsements",
];

export const CERTIFICATE_FORBIDDEN_CLAIMS = [
  "certificate_generated_without_file",
  "certificate_emailed_without_send_side_effect",
];

/**
 * The certificate action classifies endorsements with regex plus Jev and
 * reports them as `requiredChanges`; the regex alone is the fallback when the
 * outcome has no generation result.
 */
export function certificateRequestRequiresEndorsementReview(
  params: CertificateRequestWorkflowParams,
  generated?: Record<string, unknown>,
) {
  if (Array.isArray(generated?.requiredChanges)) {
    return generated.requiredChanges.length > 0;
  }
  return inferCertificateEndorsements({
    certificateHolder: params.certificateHolder,
    requestText: params.requestText,
    requestedEndorsements: params.requestedEndorsements,
  }).length > 0;
}

function baseAudit(
  params: CertificateRequestWorkflowParams,
  generated?: Record<string, unknown>,
): WorkflowAuditEntry[] {
  return [
    {
      step: "intake_received",
      decision: "parsed_holder",
      detail: params.holderName,
    },
    {
      step: "endorsement_intent_classified",
      decision: certificateRequestRequiresEndorsementReview(params, generated)
        ? "endorsement_review_required"
        : "holder_only",
    },
  ];
}

function certificateArtifact(data: Record<string, unknown>): WorkflowArtifact {
  return { type: "certificate_result", data };
}

function certificateSideEffect(
  generated: Record<string, unknown>,
): WorkflowSideEffect {
  if (generated.status === "existing") {
    return {
      kind: "existing_file_returned",
      targetType: "certificateVersion",
      targetId: String(generated.certificateVersionId ?? ""),
      description: "Returned an existing certificate for the current policy version.",
    };
  }
  return {
    kind: "file_generated",
    targetType: "certificate",
    targetId: String(generated.certificateId ?? ""),
    description: "Generated a certificate PDF.",
  };
}

export function certificateGeneratedOutcome(args: {
  params: CertificateRequestWorkflowParams;
  generated: Record<string, unknown>;
  attachment?: Record<string, unknown>;
  artifactData: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  const existing = args.generated.status === "existing";
  return {
    workflowKind: "certificate_request",
    status: "completed",
    nextAction: existing ? "return_existing_certificate" : "generate_certificate",
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [certificateSideEffect(args.generated)],
    artifacts: [
      certificateArtifact(args.artifactData),
      ...(args.attachment ? [{ type: "response_attachment", data: args.attachment }] : []),
    ],
    comms: workflowCommsPlan({
      headline: existing
        ? `I found an existing certificate for ${args.params.holderName} and attached it.`
        : `I generated the certificate for ${args.params.holderName} and attached it.`,
      nextActionLabel: existing ? "Return existing certificate" : "Attach generated certificate",
    }),
    audit: [
      ...baseAudit(args.params, args.generated),
      {
        step: "existing_certificate_checked",
        decision: existing ? "existing_returned" : "no_reusable_certificate",
      },
      {
        step: existing ? "completed_existing_returned" : "completed_generated",
        decision: "completed",
      },
    ],
  };
}

export function certificateHeldOutcome(args: {
  params: CertificateRequestWorkflowParams;
  generated: Record<string, unknown>;
  artifactData: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  return {
    workflowKind: "certificate_request",
    status: "held",
    nextAction: "hold_for_broker_follow_up",
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [
      {
        kind: "record_created",
        targetType: "certificateRequestHold",
        targetId: String(args.generated.holdId ?? ""),
        description: "Put the certificate request on hold.",
      },
    ],
    artifacts: [
      { type: "certificate_hold", data: args.artifactData },
    ],
    comms: workflowCommsPlan({
      headline: String(args.generated.message ?? "This certificate needs broker review before it can be issued."),
      nextActionLabel: "Broker follow-up required",
    }),
    audit: [
      ...baseAudit(args.params, args.generated),
      {
        step: "endorsement_evidence_reviewed",
        decision: "held_for_broker_follow_up",
        detail: String(args.generated.reasonCode ?? ""),
      },
    ],
  };
}

export function certificateRecoverableOutcome(args: {
  params: CertificateRequestWorkflowParams;
  status: string;
  message: string;
  nextAction: CertificateRequestNextAction;
  artifactData?: Record<string, unknown>;
}): WorkflowOutcome<"certificate_request", CertificateRequestNextAction> {
  return {
    workflowKind: "certificate_request",
    status: "failed_recoverably",
    nextAction: args.nextAction,
    requiredSlots: [],
    forbiddenQuestions: CERTIFICATE_FORBIDDEN_QUESTIONS,
    forbiddenClaims: CERTIFICATE_FORBIDDEN_CLAIMS,
    sideEffects: [],
    artifacts: args.artifactData ? [{ type: "certificate_result", data: args.artifactData }] : [],
    comms: workflowCommsPlan({
      headline: args.message,
      nextActionLabel: args.status,
    }),
    audit: [
      ...baseAudit(args.params),
      { step: args.status, decision: "blocked_recoverably" },
    ],
  };
}
