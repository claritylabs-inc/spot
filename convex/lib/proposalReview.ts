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

export type PacketSection = { key: string; heading: string; body: string };

/** Splits the packet markdown back into its sections, in `sectionKeys` order. */
export function parsePacketSections(
  packetMarkdown: string,
  sectionKeys: string[],
): PacketSection[] {
  const starts: { key: string; start: number; bodyStart: number; heading: string }[] = [];
  let cursor = 0;
  for (const key of sectionKeys) {
    const marker = new RegExp(
      `(?:^|\\n)## ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — ([^\\n]*)\\n?`,
    );
    const match = marker.exec(packetMarkdown.slice(cursor));
    if (!match) {
      starts.push({ key, start: -1, bodyStart: -1, heading: "" });
      continue;
    }
    const start = cursor + match.index;
    const bodyStart = start + match[0].length;
    starts.push({ key, start, bodyStart, heading: match[1]?.trim() ?? "" });
    cursor = bodyStart;
  }
  return starts.map((entry, index) => {
    if (entry.start < 0) return { key: entry.key, heading: "", body: "" };
    const next = starts.slice(index + 1).find((item) => item.start >= 0);
    return {
      key: entry.key,
      heading: entry.heading,
      body: packetMarkdown
        .slice(entry.bodyStart, next ? next.start : undefined)
        .trim(),
    };
  });
}

/** Evidence tag (`E7`) -> the proposal lines that cite it, with their heading. */
export function proposalEvidenceByTag(
  proposalMarkdown: string,
): Map<string, string> {
  const byTag = new Map<string, string[]>();
  let heading = "";
  for (const line of proposalMarkdown.split("\n")) {
    const headingMatch = /^## (.+)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1]?.trim() ?? "";
      continue;
    }
    const tagged = /^(.*?)\s*\[((?:E\d+\s*)+)\]\s*$/.exec(line);
    if (!tagged) continue;
    const text = `${heading}: ${(tagged[1] ?? "").replace(/^-\s*/, "").trim()}`;
    for (const tag of tagged[2]?.trim().split(/\s+/) ?? []) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), text]);
    }
  }
  return new Map(
    [...byTag].map(([tag, lines]) => [tag, lines.join("\n").slice(0, 600)]),
  );
}

const STOPWORDS = new Set(
  "the and for with that this from have has are was were will shall must may not any all per each than then also such its their into when upon under over only other your our you can include including includes required require requires requirement coverage policy insurance insured".split(
    " ",
  ),
);

function tokens(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => token.length >= 3 && !STOPWORDS.has(token),
    ),
  );
}

/**
 * Candidate evidence tags for one packet section: the proposal evidence that
 * shares the most distinctive words with it. Code only proposes; Jev decides
 * which candidates actually bear on the section.
 */
export function candidateEvidenceTags(
  section: PacketSection,
  evidence: Map<string, string>,
  limit: number,
): string[] {
  const wanted = tokens(`${section.heading} ${section.body}`);
  return [...evidence]
    .map(([tag, text], index) => ({
      tag,
      index,
      score: [...tokens(text)].filter((token) => wanted.has(token)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.tag);
}
