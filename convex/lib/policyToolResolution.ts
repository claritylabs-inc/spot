import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import { jevChoiceConfidence, jevProceeds } from "./jevThreshold";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";

function normalizeReference(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function policyScore(policy: Doc<"policies">, reference: string) {
  const normalizedReference = normalizeReference(reference);
  if (!normalizedReference) return 0;
  if (String(policy._id) === reference) return 100;
  if (normalizeReference(policy.policyNumber) === normalizedReference) return 95;
  if (normalizeReference(policy.fileName) === normalizedReference) return 85;

  return 0;
}

function policyLabel(policy: Doc<"policies">) {
  return [
    policy.security ?? policy.carrier ?? "Policy",
    policy.policyNumber ? `#${policy.policyNumber}` : undefined,
    policyLobCodes(policy).filter((code) => code !== "UN").length
      ? `(${policyLobCodes(policy).filter((code) => code !== "UN").map(lobLabel).join(", ")})`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function resolvePolicyReferenceForOrg(ctx: ActionCtx, args: {
  orgIds: Id<"organizations">[];
  reference: string;
}): Promise<
  | { ok: true; policy: Doc<"policies"> }
  | { ok: false; message: string }
> {
  const policies = (
    await Promise.all(
      args.orgIds.map((orgId) =>
        ctx.runQuery(internal.policies.listAllPreviewReadableInternal, { orgId }),
      ),
    )
  ).flat() as Doc<"policies">[];

  const matches = policies
    .map((policy) => ({ policy, score: policyScore(policy, args.reference) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0 && policies.length) {
    try {
      const semanticPolicies = [...policies]
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, 60);
      const orgIds = new Set(semanticPolicies.map((policy) => policy.orgId));
      const candidates = Object.fromEntries(semanticPolicies.map((policy, index) => [
        `policy_${index}`,
        {
          label: policyLabel(policy),
          carrier: policy.carrier ?? null,
          security: policy.security ?? null,
          effectiveDate: policy.effectiveDate ?? null,
          expirationDate: policy.expirationDate ?? null,
        },
      ]));
      const result = await clRouterDecide({
        ...(orgIds.size === 1 ? { orgId: String(semanticPolicies[0].orgId) } : {}),
        task: "policy_reference_resolution",
        state: { reference: args.reference, policies: candidates },
        questions: {
          policy: {
            type: "choice",
            instructions: "Which policy in `policies` does the user's `reference` identify? Use the carrier, coverage line, policy number and period to distinguish policies. Choose none if no single policy is identified.",
            criteria: {
              ...Object.fromEntries(Object.keys(candidates).map((key) => [key, {
                what: `The policy labeled in \`policies.${key}\`.`,
                not_for: "Another coverage line, carrier or period, or a reference ambiguous between policies.",
              }])),
              none: "No policy fits, or several policies fit without a distinguishing detail.",
            },
          },
        },
      }, { telemetry: ctx });
      const answer = result.answers.policy;
      if (answer?.type === "choice" && answer.choice !== "none" &&
          jevProceeds(jevChoiceConfidence(answer))) {
        const index = Object.keys(candidates).indexOf(answer.choice);
        if (index >= 0) return { ok: true, policy: semanticPolicies[index] };
      }
      if (answer?.type === "choice") {
        const plausible = semanticPolicies.filter((_, index) => {
          const probability = answer.probabilities[`policy_${index}`];
          return probability !== undefined && !jevProceeds(1 - probability);
        });
        if (plausible.length > 1) {
          return {
            ok: false,
            message: [
              "I found multiple matching policies. Choose one:",
              ...plausible.slice(0, 5).map((policy, index) =>
                `${index + 1}. ${policyLabel(policy)}`),
            ].join("\n"),
          };
        }
      }
    } catch {
      // Unavailable semantic resolution asks the user for an exact reference.
    }
  }

  if (matches.length === 0) {
    return {
      ok: false,
      message:
        "I could not match that to a policy in Spot. Ask me to list the policies first, then choose one from the list.",
    };
  }

  const bestScore = matches[0].score;
  const bestMatches = matches.filter((match) => match.score === bestScore);
  if (bestMatches.length > 1) {
    return {
      ok: false,
      message: [
        "I found multiple matching policies. Choose one:",
        ...bestMatches.slice(0, 5).map((match, index) => `${index + 1}. ${policyLabel(match.policy)}`),
      ].join("\n"),
    };
  }

  return { ok: true, policy: matches[0].policy };
}
