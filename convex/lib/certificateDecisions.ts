import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decideWithFallback, type DecisionQuestion } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";

type GateReview<Change extends string> = {
  status: "allowed" | "held";
  reasonCode:
    | "policy_change_required"
    | "missing_policy_evidence"
    | "ambiguous_policy_evidence"
    | "conflicting_policy_evidence"
    | null;
  reasonMessage: string;
  requiredChanges: Change[];
  evidenceIds: string[];
};

export function decideCertificateEvidence<Change extends string>(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  requiredChanges: Change[];
  certificateHolder?: string;
  requestText?: string;
  requestedEndorsements?: string[];
  evidencePacket: Array<{ evidenceId: string; text: string }>;
  fallback: () => Promise<GateReview<Change>>;
}) {
  const { evidencePacket, requiredChanges } = args;
  if (!evidencePacket.length || JSON.stringify(evidencePacket).length > 60_000)
    return args.fallback();
  const questions: Record<string, DecisionQuestion> = Object.fromEntries(
    requiredChanges.map((change, index) => [
      `change_${index}`,
      choiceQuestion(
        "Can this exact requested certificate change be issued from existing policy evidence? Consider every endorsement and conflicting or missing prerequisite. Additional-insured status must explicitly schedule the holder or automatically cover the holder's evidenced class. One selected evidence item must establish the entire change; abstain if several items need legal interpretation.",
        {
          ...Object.fromEntries(
            evidencePacket.map((item) => [
              item.evidenceId,
              {
                meaning:
                  "This existing authoritative evidence completely supports the requested wording for the exact holder, with no conflicting endorsement.",
                evidence: decisionState(item),
              },
            ]),
          ),
          change_required:
            "Explicit policy terms require a new endorsement for this exact holder/change; existing evidence does not already grant it.",
        },
        { change },
      ),
    ]),
  );
  return decideWithFallback<GateReview<Change>>({
    ctx: args.ctx,
    orgId: args.orgId,
    family: "certificates.evidence_support",
    state: decisionState({
      certificateHolder: args.certificateHolder,
      requestText: args.requestText,
      requestedEndorsements: args.requestedEndorsements,
      requiredChanges,
      evidencePacket,
    }),
    questions,
    accept: (answers) => {
      const ids: string[] = [];
      const unsupported: Change[] = [];
      for (const [index, change] of requiredChanges.entries()) {
        const result = acceptedChoice(answers[`change_${index}`], [
          ...evidencePacket.map((item) => item.evidenceId),
          "change_required",
        ]);
        if (!result) return undefined;
        if (result.value === "change_required") unsupported.push(change);
        else ids.push(result.value);
      }
      if (unsupported.length)
        return {
          status: "held",
          reasonCode: "policy_change_required",
          reasonMessage: `Existing policy evidence requires an endorsement for: ${unsupported.join(", ")}.`,
          requiredChanges,
          evidenceIds: [...new Set(ids)],
        };
      if (ids.length !== requiredChanges.length) return undefined;
      return {
        status: "allowed",
        reasonCode: null,
        reasonMessage:
          "Each requested change is supported by cited existing endorsement evidence.",
        requiredChanges,
        evidenceIds: [...new Set(ids)],
      };
    },
    fallback: args.fallback,
  });
}
