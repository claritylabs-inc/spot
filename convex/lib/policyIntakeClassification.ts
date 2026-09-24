"use node";

// Owner: P4 (docs/architecture/convex-section-extraction.md).
// Jev intake gate: document class plus advisory relationship to the client's
// existing policies. Moves classifyInsuranceExtractability out of
// convex/actions/policyExtraction.ts.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PdfPageText } from "./pdfText";

export type PolicyIntakeDocumentClass =
  | "bound_policy_document"
  | "specimen_policy_document"
  | "insurance_related_but_not_bound_policy"
  | "non_insurance"
  | "unknown";

export type PolicyIntakeRelationshipKind =
  | "new_policy"
  | "renewal"
  | "endorsement"
  | "duplicate"
  | "unknown";

export type ExistingPolicyCandidate = {
  policyId: string;
  policyNumber?: string;
  carrier?: string;
  namedInsured?: string;
  effectiveDate?: string;
  expirationDate?: string;
};

export type PolicyIntakeDecision = {
  classification: PolicyIntakeDocumentClass;
  shouldExtract: boolean;
  confidence: number;
  reason: string;
  detectedTitle: string | null;
  /** Advisory only in this change: recorded for operators, never auto-routed. */
  relationship: {
    kind: PolicyIntakeRelationshipKind;
    policyId?: string;
    confidence: number;
  };
};

export async function classifyPolicyIntake(_args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  pageCount: number;
  pages: PdfPageText[];
  existingPolicies: ExistingPolicyCandidate[];
  traceId?: string;
  policyId?: string;
}): Promise<PolicyIntakeDecision> {
  throw new Error("classifyPolicyIntake: not implemented (P4)");
}
