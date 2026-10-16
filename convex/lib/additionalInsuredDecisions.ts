"use node";

// Jev decides how each extracted additional-insured class and named insured is
// treated for certificates. Generation only extracts the classes, names,
// endorsement titles, and source node IDs; sorting them into buckets happens here.

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { JsonValue } from "../../contracts/cl-router/policy";
import {
  decideChoicesOverEvidence,
  type EvidenceChoiceItem,
} from "./jevEvidenceChoices";
import { jevProceeds } from "./jevThreshold";
import type { DocumentSourceNode } from "./sourceTree";

export type AdditionalInsuredClass = {
  category: string;
  condition: string;
  summary: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

export type NamedAdditionalInsuredCandidate = {
  name: string;
  scope: string;
  endorsementTitle: string | null;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

export type NamedAdditionalInsuredStatus =
  | "scheduled_by_endorsement"
  | "automatic_class"
  | "review_required";

export type ClassTreatment = "automatic" | "requires_endorsement" | "review";

const MAX_SOURCES = 3;
const MAX_SOURCE_CHARS = 1200;
const MAX_ITEMS = 60;

const CLASS_CRITERIA: Record<ClassTreatment, string> = {
  automatic:
    "The policy wording itself includes this class as an additional insured with no scheduling, naming, or new endorsement needed, usually subject to stated conditions such as a written contract. Example: 'any person or organization you are required to add by written contract'.",
  requires_endorsement:
    "The class only qualifies once it is scheduled, named, added, or endorsed. Example: 'any Scheduled Additional Insured added by endorsement'. Not for wording that includes the class automatically.",
  review:
    "The cited text does not say which, contradicts itself, or is missing. Choose this when unsure.",
};

const NAMED_CRITERIA: Record<NamedAdditionalInsuredStatus, string> = {
  scheduled_by_endorsement:
    "The sources name this party in a schedule, table, or endorsement that adds it as an additional insured.",
  automatic_class:
    "The sources name this party, but its additional insured status comes from automatic policy wording for a class it belongs to, not from a schedule or endorsement.",
  review_required:
    "The sources do not make clear how this party holds additional insured status. Choose this when unsure.",
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourcesFor(
  nodeIds: string[],
  nodesById: Map<string, DocumentSourceNode>,
): { sources: JsonValue[]; page?: number } {
  const sources: JsonValue[] = [];
  let firstPage: number | undefined;
  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    firstPage ??= node.pageStart;
    const text = [node.description, node.textExcerpt]
      .filter(Boolean)
      .join(" ")
      .trim()
      .slice(0, MAX_SOURCE_CHARS);
    if (text && sources.length < MAX_SOURCES) {
      sources.push({ title: node.title ?? "", text });
    }
  }
  // Page images only stand in for missing text.
  return sources.length > 0 ? { sources } : { sources, page: firstPage };
}

/**
 * Splits classes into automatic / endorsement-required / review, and gives each
 * named insured a status. Classes in `fixedRequiresEndorsement` (deterministic
 * scheduled-AI wording) skip Jev; named insureds that appear in `scheduled` by
 * normalized name are scheduled without asking. Low confidence or no answer
 * means review.
 */
export async function decideAdditionalInsuredTreatment(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    traceId?: string;
    policyId: string;
    classes: AdditionalInsuredClass[];
    fixedRequiresEndorsement: AdditionalInsuredClass[];
    scheduled: NamedAdditionalInsuredCandidate[];
    named: NamedAdditionalInsuredCandidate[];
    sourceTree: DocumentSourceNode[];
    loadPdf?: () => Promise<Uint8Array | null>;
  },
): Promise<{
  withoutEndorsement: AdditionalInsuredClass[];
  requiresEndorsement: AdditionalInsuredClass[];
  reviewRequired: AdditionalInsuredClass[];
  additionalInsureds: Array<
    NamedAdditionalInsuredCandidate & { status: NamedAdditionalInsuredStatus }
  >;
}> {
  const nodesById = new Map(params.sourceTree.map((node) => [node.id, node]));
  const scheduledNames = new Set(
    params.scheduled.map((entry) => normalizeName(entry.name)),
  );
  const askedNamed = params.named.filter(
    (entry) => !scheduledNames.has(normalizeName(entry.name)),
  );

  const items: EvidenceChoiceItem[] = [];
  const classKeys = new Map<AdditionalInsuredClass, string>();
  const namedKeys = new Map<NamedAdditionalInsuredCandidate, string>();
  const addItem = (
    key: string,
    evidence: Record<string, JsonValue>,
    nodeIds: string[],
  ) => {
    const { sources, page } = sourcesFor(nodeIds, nodesById);
    // Nothing to read (or over the cap) stays unanswered and routes to review.
    if (
      (sources.length === 0 && page === undefined) ||
      items.length >= MAX_ITEMS
    ) {
      return;
    }
    items.push({
      key,
      evidence: { ...evidence, sources },
      ...(page !== undefined ? { page } : {}),
    });
  };
  params.classes.forEach((term, index) => {
    const key = `c${index}`;
    classKeys.set(term, key);
    addItem(
      key,
      { category: term.category, condition: term.condition },
      term.sourceNodeIds,
    );
  });
  askedNamed.forEach((entry, index) => {
    const key = `n${index}`;
    namedKeys.set(entry, key);
    addItem(
      key,
      {
        name: entry.name,
        ...(entry.scope ? { scope: entry.scope } : {}),
        ...(entry.endorsementTitle
          ? { endorsementTitle: entry.endorsementTitle }
          : {}),
      },
      entry.sourceNodeIds,
    );
  });

  const classItems = items.filter((item) => item.key.startsWith("c"));
  const namedItems = items.filter((item) => item.key.startsWith("n"));
  const common = {
    orgId: params.orgId,
    traceId: params.traceId,
    surface: "additional_insured_treatment",
    sessionKey: params.policyId,
    loadPdf: params.loadPdf,
  };
  const [classAnswers, namedAnswers] = await Promise.all([
    decideChoicesOverEvidence(ctx, {
      ...common,
      task: "additional_insured_class_treatment",
      items: classItems,
      specs: [
        {
          field: "treatment",
          instructions: (ref) =>
            `Is the additional insured class named at \`${ref}.category\` included automatically by the policy wording, included only when scheduled, named, or endorsed, or neither clearly? Judge from \`${ref}.sources\` and the image at \`${ref}.page\` when present.`,
          criteria: CLASS_CRITERIA,
        },
      ],
    }),
    decideChoicesOverEvidence(ctx, {
      ...common,
      task: "additional_insured_named_status",
      items: namedItems,
      specs: [
        {
          field: "status",
          instructions: (ref) =>
            `How does the party named at \`${ref}.name\` hold additional insured status? Judge from \`${ref}.sources\` and the image at \`${ref}.page\` when present.`,
          criteria: NAMED_CRITERIA,
        },
      ],
    }),
  ]);

  const withoutEndorsement: AdditionalInsuredClass[] = [];
  const requiresEndorsement: AdditionalInsuredClass[] = [
    ...params.fixedRequiresEndorsement,
  ];
  const reviewRequired: AdditionalInsuredClass[] = [];
  for (const term of params.classes) {
    const answer = classAnswers.get(classKeys.get(term)!)?.treatment;
    const treatment: ClassTreatment =
      answer && jevProceeds(answer.confidence)
        ? (answer.choice as ClassTreatment)
        : "review";
    if (treatment === "automatic") withoutEndorsement.push(term);
    else if (treatment === "requires_endorsement") requiresEndorsement.push(term);
    else reviewRequired.push(term);
  }

  const additionalInsureds = params.named.map((entry) => {
    let status: NamedAdditionalInsuredStatus = "review_required";
    if (scheduledNames.has(normalizeName(entry.name))) {
      status = "scheduled_by_endorsement";
    } else {
      const answer = namedAnswers.get(namedKeys.get(entry)!)?.status;
      if (answer && jevProceeds(answer.confidence)) {
        status = answer.choice as NamedAdditionalInsuredStatus;
      }
    }
    return { ...entry, status };
  });

  return {
    withoutEndorsement,
    requiresEndorsement,
    reviewRequired,
    additionalInsureds,
  };
}
