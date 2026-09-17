"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decideProposalReview } from "../lib/proposalDecisions";
import { generateObjectForOrg } from "../lib/models";
import {
  normalizeProposalReview,
  proposalReviewSchema,
} from "../lib/proposalReview";

const internalApi = internal as any;
const REVIEW_TIMEOUT_MS = 120_000;
const MAX_DOCUMENT_CHARS = 120_000;

function bounded(value: string) {
  return value.length > MAX_DOCUMENT_CHARS
    ? `${value.slice(0, MAX_DOCUMENT_CHARS)}\n\n…truncated…`
    : value;
}

async function generateReviewForOperator(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    proposalId: Id<"procurementProposals">;
  },
) {
  await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
    userId: args.operatorUserId,
  });
  const input = await ctx.runQuery(
    internalApi.procurementProposals.getReviewInputInternal,
    { proposalId: args.proposalId },
  );
  if (!input) throw new Error("Proposal extraction is not ready for review");
  if (input.sectionKeys.length === 0)
    throw new Error(
      "This request has no broker-visible packet sections to review against",
    );
  if (!input.proposalMarkdown.trim())
    throw new Error("The proposal extraction produced no readable content");
  const packetMarkdown = bounded(input.packetMarkdown);
  const proposalMarkdown = bounded(input.proposalMarkdown);

  const abortSignal = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
  let generated;
  try {
    generated = await decideProposalReview({
      ctx,
      orgId: input.clientOrgId,
      packetMarkdown,
      proposalMarkdown,
      sectionKeys: input.sectionKeys,
      legend: input.evidenceLegend,
      abortSignal,
      fallback: async () =>
        (
          await generateObjectForOrg(ctx, input.clientOrgId, "analysis", {
            schema: proposalReviewSchema,
            abortSignal,
            maxOutputTokens: 8_000,
            system: `You are a careful commercial-insurance proposal reviewer. You are given two markdown documents: the submission packet the broker was sent, and the offer extracted from the proposal they returned. Compare them section by section using only the supplied text. Never invent a carrier term, limit, deductible, premium, condition, exclusion, or page.

Return exactly one finding for every packet section, keyed by the section key printed after "## " in the packet. A finding is "meets" only when cited proposal evidence clearly satisfies what the section asks for, "has_gap" when cited evidence clearly conflicts with or falls short of it, and "insufficient_evidence" when the proposal does not establish an answer. A section that asks for nothing verifiable is insufficient_evidence, not meets.

Cite proposal evidence only by the bracketed tags printed in the proposal document, such as E1 or E7. Every "meets" and "has_gap" finding must cite at least one tag. Never write a tag that does not appear in the proposal document.

The overall conclusion is meets_requirements only when every section meets, has_gaps when at least one section has a supported gap, and insufficient_evidence otherwise.`,
            prompt: `# Submission packet

${packetMarkdown}

# Extracted proposal

${proposalMarkdown}

Return one finding per packet section, using these exact section keys: ${input.sectionKeys.join(", ")}`,
          })
        ).object,
    });
  } catch (error) {
    if (abortSignal.aborted)
      throw new Error("Proposal review took too long. Try again.");
    throw error;
  }
  const review = normalizeProposalReview(generated, {
    sectionKeys: input.sectionKeys,
    legend: input.evidenceLegend,
    proposalMarkdown,
  });
  const saved = await ctx.runMutation(
    internalApi.procurementProposals.saveGeneratedReviewInternal,
    {
      operatorUserId: args.operatorUserId,
      proposalId: input.proposalId,
      extractionFingerprint: input.extractionFingerprint,
      packetRevision: input.packetRevision,
      findings: review.findings,
      conclusion: review.conclusion,
    },
  );
  return {
    ...saved,
    conclusion: review.conclusion,
    findingCount: review.findings.length,
  };
}

export const generateReview = action({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throw new Error("Authentication required");
    return await generateReviewForOperator(ctx, {
      operatorUserId: operatorUserId as Id<"users">,
      proposalId: args.proposalId,
    });
  },
});

export const generateReviewInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    proposalId: v.id("procurementProposals"),
  },
  handler: generateReviewForOperator,
});
