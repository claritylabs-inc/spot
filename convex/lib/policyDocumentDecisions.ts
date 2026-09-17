"use node";

import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export const policyDocumentClassificationSchema = z.enum([
  "bound_policy_document",
  "specimen_policy_document",
  "insurance_related_but_not_bound_policy",
  "non_insurance",
  "unknown",
]);
type ExtractionGateDecision = {
  classification: z.infer<typeof policyDocumentClassificationSchema>;
  shouldExtract: boolean;
  confidence: number;
  reason: string;
  detectedTitle: string | null;
};

export async function decidePolicyDocumentIntake(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  traceId?: string;
  pdfBytes: Uint8Array;
  sourceSpans: Array<{
    pageStart?: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>;
  fallback: () => Promise<ExtractionGateDecision>;
}): Promise<ExtractionGateDecision> {
  // PDF.js normalizes operator lists and silently drops unknown commands, even
  // with stopAtErrors. Neither these lists nor page text prove that all visible
  // evidence was captured. Retain PDF reasoning until the parser can provide
  // that guarantee; confidence and caller-supplied spans cannot establish it.
  return args.fallback();
}
