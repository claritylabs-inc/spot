import { z } from "zod";
import { v, type Infer } from "convex/values";
import type { ProposalEvidenceLegend } from "./proposalMarkdown";

export const proposalReviewConclusionSchema = z.enum([
  "meets_requirements",
  "has_gaps",
  "insufficient_evidence",
]);

const findingConclusionSchema = z.enum([
  "meets",
  "has_gap",
  "insufficient_evidence",
]);

export const proposalReviewFindingValidator = v.object({
  sectionKey: v.string(),
  conclusion: v.union(
    v.literal("meets"),
    v.literal("has_gap"),
    v.literal("insufficient_evidence"),
  ),
  summary: v.string(),
  evidence: v.array(
    v.object({
      proposalDocumentId: v.string(),
      sourceNodeIds: v.array(v.string()),
      sourceSpanIds: v.array(v.string()),
      pageStart: v.union(v.number(), v.null()),
      pageEnd: v.union(v.number(), v.null()),
    }),
  ),
});

export type StoredProposalFinding = Infer<typeof proposalReviewFindingValidator>;

export const proposalReviewSchema = z.object({
  conclusion: proposalReviewConclusionSchema,
  findings: z
    .array(
      z.object({
        sectionKey: z.string().min(1),
        conclusion: findingConclusionSchema,
        summary: z.string().min(1).max(1200),
        evidenceRefs: z.array(z.string().min(1)).max(20),
      }),
    )
    .max(200),
});

export type ProposalReviewOutput = z.infer<typeof proposalReviewSchema>;

export function normalizeProposalReview(
  output: ProposalReviewOutput,
  input: {
    sectionKeys: string[];
    legend: ProposalEvidenceLegend;
    proposalMarkdown: string;
  },
): {
  conclusion: ProposalReviewOutput["conclusion"];
  findings: StoredProposalFinding[];
} {
  const allowed = new Set(input.sectionKeys);
  const visibleEvidenceRefs = new Set(
    [...input.proposalMarkdown.matchAll(/\[((?:E\d+\s*)+)\]/g)].flatMap(
      (match) => match[1]?.trim().split(/\s+/) ?? [],
    ),
  );
  const bySection = new Map<string, StoredProposalFinding>();
  for (const finding of output.findings) {
    if (!allowed.has(finding.sectionKey)) continue;
    if (bySection.has(finding.sectionKey)) continue;
    const evidence = [
      ...new Set(finding.evidenceRefs.map((ref) => ref.trim().toUpperCase())),
    ].flatMap((ref) => {
      const resolved = visibleEvidenceRefs.has(ref)
        ? input.legend[ref]
        : undefined;
      return resolved
        ? [
            {
              proposalDocumentId: resolved.proposalDocumentId,
              sourceNodeIds: resolved.sourceNodeIds,
              sourceSpanIds: resolved.sourceSpanIds,
              pageStart: resolved.pageStart ?? null,
              pageEnd: resolved.pageEnd ?? resolved.pageStart ?? null,
            },
          ]
        : [];
    });
    const grounded =
      evidence.length > 0 || finding.conclusion === "insufficient_evidence";
    bySection.set(finding.sectionKey, {
      sectionKey: finding.sectionKey,
      conclusion: grounded ? finding.conclusion : "insufficient_evidence",
      summary: grounded
        ? finding.summary.trim()
        : "The generated finding did not cite accepted proposal evidence.",
      evidence,
    });
  }
  const findings = input.sectionKeys.map(
    (sectionKey): StoredProposalFinding =>
      bySection.get(sectionKey) ?? {
        sectionKey,
        conclusion: "insufficient_evidence",
        summary: "The review did not return a finding for this packet section.",
        evidence: [],
      },
  );
  const conclusion = findings.some((finding) => finding.conclusion === "has_gap")
    ? "has_gaps"
    : findings.some(
          (finding) => finding.conclusion === "insufficient_evidence",
        )
      ? "insufficient_evidence"
      : "meets_requirements";
  return { conclusion, findings };
}
