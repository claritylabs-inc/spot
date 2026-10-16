"use node";

// Jev decides what an extracted endorsement is (type) and whether it grants or
// removes coverage (support status). The extraction model only extracts the
// endorsement's title, summary, changes, and citations.

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { JsonValue } from "../../contracts/cl-router/policy";
import {
  decideChoicesOverEvidence,
  type EvidenceChoiceItem,
} from "./jevEvidenceChoices";
import { jevProceeds } from "./jevThreshold";
import type { SectionResult } from "./sectionExtraction/merge";
import {
  ENDORSEMENT_JUDGMENT_FALLBACK,
  ENDORSEMENT_SUPPORT_STATUSES,
  ENDORSEMENT_TYPES,
  type EndorsementJudgment,
} from "./sectionExtraction/schemas";

type ExtractedEndorsement = Extract<
  SectionResult,
  { kind: "endorsement" }
>["output"]["endorsements"][number];

/** Keyed by the extracted endorsement object that `mergeSectionResults` iterates. */
export type EndorsementJudgments = Map<
  ExtractedEndorsement,
  EndorsementJudgment
>;

const TYPE_CRITERIA: Record<
  (typeof ENDORSEMENT_TYPES)[number],
  string
> = {
  additional_insured:
    "Adds a specific scheduled or named person or company as an additional insured. Not for blanket wording that covers any party under a written contract.",
  blanket_additional_insured:
    "Adds additional insured status automatically for any party that meets a stated condition, such as a written contract requirement. Not for a named or scheduled party.",
  waiver_of_subrogation: "Waives the insurer's right of recovery against a party.",
  primary_noncontributory:
    "Makes this policy primary and noncontributory to other insurance.",
  loss_payee: "Names a loss payee or lender's loss payable interest.",
  mortgage_holder: "Names a mortgage holder or mortgagee interest.",
  broadening:
    "Extends coverage to something not otherwise covered, other than additional insureds, waivers, or loss payees.",
  restriction:
    "Narrows coverage or adds conditions to existing coverage without excluding a whole exposure.",
  exclusion: "Excludes a specific exposure, cause of loss, or operation entirely.",
  amendatory:
    "Amends policy wording generally, such as definitions, state-specific changes, or conditions, without a specific coverage effect named here.",
  notice_of_cancellation:
    "Changes who gets notice of cancellation or the notice period.",
  designated_premises:
    "Limits or applies coverage to designated premises, locations, or projects.",
  classification_change: "Changes the rated classification or class code.",
  schedule_update:
    "Updates a schedule of items, such as vehicles, locations, or equipment.",
  deductible_change: "Changes a deductible or self-insured retention.",
  limit_change: "Changes a limit of insurance or sublimit.",
  territorial_extension:
    "Extends or changes the coverage territory or jurisdiction.",
  other: "Fits none of the other kinds.",
};

const SUPPORT_CRITERIA: Record<
  (typeof ENDORSEMENT_SUPPORT_STATUSES)[number],
  string
> = {
  supported:
    "The endorsement grants or broadens coverage or insured status, such as adding an additional insured, a waiver of subrogation, or primary and noncontributory wording.",
  excluded:
    "The endorsement removes, excludes, or restricts coverage.",
  requires_review:
    "The endorsement is administrative, mixed, or neutral in effect (for example a notice, schedule update, or general amendment), or the effect is unclear.",
};

const MAX_QUOTES = 3;
const MAX_QUOTE_CHARS = 400;
const MAX_ITEMS = 60;

function endorsementItem(
  key: string,
  endorsement: ExtractedEndorsement,
  sectionPageStart: number,
): EvidenceChoiceItem {
  const evidence: Record<string, JsonValue> = {
    title: endorsement.title,
    summary: endorsement.summary,
  };
  if (endorsement.formNumber) evidence.formNumber = endorsement.formNumber;
  const quotes = endorsement.citations
    .map((citation) => citation.quote.trim().slice(0, MAX_QUOTE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_QUOTES);
  if (quotes.length) evidence.quotes = quotes;
  const coverageChanges = endorsement.coverageChanges.map(
    (change) => `${change.action}: ${change.coverage.name}`,
  );
  if (coverageChanges.length) evidence.coverageChanges = coverageChanges;
  const partyChanges = endorsement.partyChanges.map(
    (change) => `${change.action} ${change.role}`,
  );
  if (partyChanges.length) evidence.partyChanges = partyChanges;
  return {
    key,
    evidence,
    page: endorsement.citations[0]?.page ?? sectionPageStart,
  };
}

/**
 * Asks Jev two atomic Choices per endorsement over its title, summary, quotes,
 * and cited page image. Anything Jev is unsure about, or cannot answer, gets
 * `other` / `requires_review`.
 */
export async function decideEndorsementJudgments(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    traceId?: string;
    policyId: string;
    results: SectionResult[];
    loadPdf?: () => Promise<Uint8Array | null>;
    log?: (message: string, level?: "info" | "warn") => Promise<void>;
  },
): Promise<EndorsementJudgments> {
  const judgments: EndorsementJudgments = new Map();
  const byKey = new Map<string, ExtractedEndorsement>();
  const items: EvidenceChoiceItem[] = [];
  for (const result of params.results) {
    if (result.kind !== "endorsement") continue;
    for (const endorsement of result.output.endorsements) {
      judgments.set(endorsement, ENDORSEMENT_JUDGMENT_FALLBACK);
      if (items.length >= MAX_ITEMS) continue;
      const key = `e${items.length}`;
      byKey.set(key, endorsement);
      items.push(endorsementItem(key, endorsement, result.section.pageStart));
    }
  }
  if (items.length === 0) return judgments;

  const answers = await decideChoicesOverEvidence(ctx, {
    orgId: params.orgId,
    traceId: params.traceId,
    task: "endorsement_judgment",
    surface: "endorsement_judgment",
    sessionKey: params.policyId,
    items,
    loadPdf: params.loadPdf,
    specs: [
      {
        field: "type",
        instructions: (ref) =>
          `What kind of change does the endorsement at \`${ref}\` make? Judge from \`${ref}.title\`, \`${ref}.summary\`, \`${ref}.quotes\`, and the image at \`${ref}.page\` when present.`,
        criteria: TYPE_CRITERIA,
      },
      {
        field: "support",
        instructions: (ref) =>
          `Does the endorsement at \`${ref}\` grant or broaden coverage, remove or restrict coverage, or neither clearly? Judge from \`${ref}.title\`, \`${ref}.summary\`, \`${ref}.quotes\`, and the image at \`${ref}.page\` when present.`,
        criteria: SUPPORT_CRITERIA,
      },
    ],
  });

  let unanswered = 0;
  for (const [key, endorsement] of byKey) {
    const answer = answers.get(key);
    if (!answer?.type && !answer?.support) unanswered += 1;
    const type = answer?.type;
    const support = answer?.support;
    judgments.set(endorsement, {
      endorsementType:
        type && jevProceeds(type.confidence)
          ? (type.choice as EndorsementJudgment["endorsementType"])
          : ENDORSEMENT_JUDGMENT_FALLBACK.endorsementType,
      supportStatus:
        support && jevProceeds(support.confidence)
          ? (support.choice as EndorsementJudgment["supportStatus"])
          : ENDORSEMENT_JUDGMENT_FALLBACK.supportStatus,
    });
  }
  if (unanswered > 0) {
    await params.log?.(
      `Endorsement judgments unavailable for ${unanswered} of ${items.length} endorsements; marked for review`,
      "warn",
    );
  }
  return judgments;
}
