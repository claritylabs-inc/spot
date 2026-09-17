"use node";

import {
  auditExtractionEvidence,
  parseExtractionEvidenceAudit,
  validateExtractionAuditBinding,
  type ExtractionAuditBinding,
  type ExtractionEvidenceAudit,
} from "@claritylabs/cl-sdk/extraction-audit";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { decisionPolicyFromEnvironment, logDecisionEvent } from "./decisions";
import { makeDecide } from "./sdkCallbacks";

/** Audit the final action-side snapshot; an upstream judgment cannot follow changed facts. */
export async function resolveExtractionEvidenceAudit(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  traceId?: string;
  binding: ExtractionAuditBinding;
  previous?: unknown;
  shouldCancel?: () => Promise<boolean>;
}): Promise<{
  report?: ExtractionEvidenceAudit;
  snapshot?: ExtractionAuditBinding;
  required: boolean;
}> {
  const policy = decisionPolicyFromEnvironment();
  const family = policy.families?.["extraction.audit"];
  const mode = family?.mode ?? policy.mode;
  const qualified = Boolean(
    family?.evaluationId && family.threshold && family.threshold > 0.5,
  );
  const required = mode === "active" && qualified;
  if (mode === "legacy" || (mode === "active" && !qualified))
    return { required: false };

  const checkCancellation = async () => {
    if (await args.shouldCancel?.()) throw new Error("Cancelled by user");
  };
  await checkCancellation();
  try {
    if (args.previous !== undefined) {
      const previous = parseExtractionEvidenceAudit(args.previous);
      let matches = false;
      try {
        validateExtractionAuditBinding(previous, args.binding);
        matches = true;
      } catch {
        // Normalization, cleanup, or changed sources require a new semantic audit.
      }
      if (
        matches &&
        previous.policyVersion === policy.policyVersion &&
        previous.evaluationId === family?.evaluationId &&
        previous.acceptanceThreshold === family?.threshold &&
        (mode === "shadow"
          ? previous.status === "shadow"
          : previous.status === "verified_text" ||
            previous.status === "unresolved")
      )
        return { report: previous, snapshot: args.binding, required };
    }

    const decide = makeDecide({
      ctx: args.ctx,
      orgId: args.orgId,
      traceId: args.traceId,
    });
    const result = await auditExtractionEvidence({
      ...args.binding,
      decisions: {
        decisionPolicy: policy,
        onDecision: logDecisionEvent,
        decide: async (request) => {
          await checkCancellation();
          const response = await decide(request);
          await checkCancellation();
          return response;
        },
      },
      // Host postprocessing is already complete. Audit it without replaying extraction or writes.
      options: { maxRepairRounds: 0 },
    });
    await checkCancellation();
    return {
      report: parseExtractionEvidenceAudit(result.audit, args.binding),
      snapshot: args.binding,
      required,
    };
  } catch (error) {
    await checkCancellation();
    if (mode !== "shadow") throw error;
    console.warn("[decision] extraction.audit shadow unavailable");
    return { required: false };
  }
}

/** This preflight can block promotion; only the existing promotion mutation can grant it. */
export function requireResolvedExtractionAudit(args: {
  report?: ExtractionEvidenceAudit;
  snapshot?: ExtractionAuditBinding;
  required: boolean;
}): void {
  if (
    args.required &&
    (args.report?.status !== "verified_text" ||
      !args.snapshot?.originalSourceSpans?.length)
  ) {
    throw new Error(
      "Extraction evidence audit is unresolved; policy promotion requires review",
    );
  }
}
