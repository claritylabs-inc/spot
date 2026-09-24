import {
  sameCarrierIdentityName,
  type CarrierIdentity,
  type CarrierLegalEntity,
  type CarrierLegalEntityRelationship,
} from "./carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./carrierIdentityEnrichment";
import { clRouterDecide } from "./clRouterClient";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type CarrierSourceSpan = {
  id?: string;
  spanId?: string;
  documentId?: string;
  sourceKind?: string;
  kind?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?:
    | { page?: number; startPage?: number; endPage?: number }
    | Record<string, unknown>;
  text?: string;
  textHash?: string;
  hash?: string;
  bbox?: Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  metadata?: Record<string, unknown>;
};

export type CarrierSourceNode = {
  id: string;
  kind: string;
  title: string;
  description: string;
  textExcerpt?: string;
  sourceSpanIds: string[];
  order: number;
};

type CarrierOperationalParty = {
  role: string;
  name: string;
  sourceNodeIds: string[];
  sourceSpanIds: string[];
};

export type CarrierOperationalProfile = {
  insurer?: {
    value?: unknown;
    sourceNodeIds?: unknown;
    sourceSpanIds?: unknown;
  };
  parties?: unknown;
};

const OPERATING_NAME_PATTERN =
  /\b(?:operating\s+as|doing\s+business\s+as|d\s*\/?\s*b\s*\/?\s*a|dba)\b/i;
const LLOYDS_LED_BY_PATTERN =
  /\blloyd['’]?s\s+underwriters?\s*[:,;-]?\s+led\s+by\b/i;
const CARRIER_CONTAMINATION_PATTERN =
  /\b(?:coverage|coverages|premium|premiums|deductible|limit of insurance|total payable|taxes?|fees?)\b/i;
const CARRIER_FINANCIAL_CONTAMINATION_PATTERN =
  /(?:[$€£]\s*\d|\b\d+(?:\.\d+)?\s*%)/i;
const COMPLETE_LEGAL_ENTITY_SUFFIX =
  "(?:Insurance\\s+Company|Assurance\\s+Company|Insurance\\s+Corporation|Assurance\\s+Corporation|Indemnity\\s+Company|Company|Corporation|Corp\\.?|Incorporated|Inc\\.?|Limited|Ltd\\.?|L\\.?L\\.?C\\.?|PLC|S\\.?(?:E\\.?)?)";
const COMPLETE_LEGAL_ENTITY_PATTERN = new RegExp(
  `(?:^|[,;]|\\b(?:and\\s*\\/\\s*or|and|or)\\b)\\s*` +
    `([A-Z][A-Za-z0-9&'’.-]*(?:\\s+[A-Za-z0-9&'’.-]+){0,10}\\s+${COMPLETE_LEGAL_ENTITY_SUFFIX})` +
    `(?=\\s*(?:,|;|\\b(?:and\\s*\\/\\s*or|and|or|operating\\s+as|doing\\s+business\\s+as|d\\s*\\/?\\s*b\\s*\\/?\\s*a|dba)\\b|$))`,
  "gi",
);
const COMPLETE_LEGAL_ENTITY_NAME_PATTERN = new RegExp(
  `^[A-Z][A-Za-z0-9&'’.-]*(?:\\s+[A-Za-z0-9&'’.-]+){0,10}\\s+${COMPLETE_LEGAL_ENTITY_SUFFIX}$`,
  "i",
);

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.length > 0,
      )
    : [];
}

function operationalParties(
  profile: CarrierOperationalProfile,
): CarrierOperationalParty[] {
  if (!Array.isArray(profile.parties)) return [];
  return profile.parties.flatMap((value): CarrierOperationalParty[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const party = value as Record<string, unknown>;
    const role = typeof party.role === "string" ? party.role : "";
    const name = typeof party.name === "string" ? party.name.trim() : "";
    return role && name
      ? [{
          role,
          name,
          sourceNodeIds: stringArray(party.sourceNodeIds),
          sourceSpanIds: stringArray(party.sourceSpanIds),
        }]
      : [];
  });
}

function normalizedCarrierIdentityText(value: unknown) {
  return typeof value === "string"
    ? value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function uniqueCarrierNames(names: string[]) {
  return names.filter((name, index) =>
    names.findIndex((candidate) => sameCarrierIdentityName(candidate, name)) ===
      index
  );
}

function isCompleteLegalEntityName(value: string) {
  const name = value.trim();
  if (!COMPLETE_LEGAL_ENTITY_NAME_PATTERN.test(name)) return false;
  const withoutSuffix = name
    .replace(new RegExp(`\\s+${COMPLETE_LEGAL_ENTITY_SUFFIX}$`, "i"), "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  return ![
    "america",
    "canada",
    "canadian",
    "global",
    "international",
    "national",
    "service",
    "services",
  ].includes(withoutSuffix);
}

function legalEntityNamesBeforeOperatingMarker(text: string) {
  const marker = text.match(OPERATING_NAME_PATTERN);
  if (marker?.index === undefined) return [];
  const prefix = text.slice(0, marker.index);
  const names: string[] = [];
  COMPLETE_LEGAL_ENTITY_PATTERN.lastIndex = 0;
  for (
    let match = COMPLETE_LEGAL_ENTITY_PATTERN.exec(prefix);
    match;
    match = COMPLETE_LEGAL_ENTITY_PATTERN.exec(prefix)
  ) {
    const name = match[1]?.replace(/\s+/g, " ").trim();
    if (name && isCompleteLegalEntityName(name)) names.push(name);
  }
  return uniqueCarrierNames(names);
}

type CarrierEvidence = {
  nodeIds: string[];
  spanIds: string[];
  text: string;
  pageLevel: boolean;
  order: number;
};

function sourceSpanId(span: CarrierSourceSpan) {
  return typeof span.id === "string"
    ? span.id
    : typeof span.spanId === "string"
      ? span.spanId
      : undefined;
}

function carrierClauseText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lloydsIndex = normalized.search(/\blloyd['’]?s\s+underwriters?\b/i);
  if (lloydsIndex >= 0) {
    const tail = normalized.slice(lloydsIndex, lloydsIndex + 900);
    const contract = tail.match(
      /\b(?:under\s+)?contract\s+(?:number|no\.?)\s*[:#]?\s*[A-Z0-9][A-Z0-9()/_-]*/i,
    );
    if (contract?.index !== undefined) {
      return tail
        .slice(0, contract.index + contract[0].length)
        .replace(/[;,]+$/, "")
        .trim();
    }
    return tail.split(/(?<=[.;])\s+(?=[A-Z])/)[0].slice(0, 700).trim();
  }
  const markerIndex = normalized.search(OPERATING_NAME_PATTERN);
  if (markerIndex < 0) return normalized.slice(0, 900);
  const tail = normalized.slice(Math.max(0, markerIndex - 500), markerIndex + 400);
  return tail.split(/(?<=[.;])\s+(?=[A-Z])/)[0].trim();
}

function isCarrierIdentityEvidence(text: string) {
  return OPERATING_NAME_PATTERN.test(text) ||
    LLOYDS_LED_BY_PATTERN.test(text);
}

const PAGE_LEVEL_NODE_KINDS = ["document", "page_group", "page"];

/**
 * Operating-name and Lloyd's clauses from source nodes, single spans, and the
 * spans each extracted carrier party cites (joined in source order, since one
 * clause is often split across several spans).
 */
function carrierIdentityEvidence(
  sourceTree: CarrierSourceNode[],
  sourceSpans: CarrierSourceSpan[],
  parties: CarrierOperationalParty[],
) {
  const spanOrder = new Map(
    sourceSpans.map((span, index) => [sourceSpanId(span), index]),
  );
  const clause = (
    rawText: string,
    item: Omit<CarrierEvidence, "text">,
  ): CarrierEvidence[] => {
    const text = carrierClauseText(rawText);
    return text && isCarrierIdentityEvidence(text) ? [{ ...item, text }] : [];
  };
  const evidence: CarrierEvidence[] = [
    ...sourceTree.flatMap((node, order) =>
      clause(node.textExcerpt ?? node.description ?? node.title, {
        nodeIds: [node.id],
        spanIds: node.sourceSpanIds,
        pageLevel:
          PAGE_LEVEL_NODE_KINDS.includes(node.kind) ||
          node.sourceSpanIds.length > 8,
        order,
      })
    ),
    ...sourceSpans.flatMap((span, order) => {
      const spanId = sourceSpanId(span);
      return clause(typeof span.text === "string" ? span.text : "", {
        nodeIds: [],
        spanIds: spanId ? [spanId] : [],
        pageLevel: span.sourceUnit === "page",
        order,
      });
    }),
    ...parties.flatMap((party) => {
      const cited = sourceSpans
        .filter((span) => party.sourceSpanIds.includes(sourceSpanId(span) ?? ""))
        .sort((left, right) =>
          (spanOrder.get(sourceSpanId(left)) ?? 0) -
          (spanOrder.get(sourceSpanId(right)) ?? 0)
        );
      if (cited.length < 2) return [];
      return clause(cited.map((span) => span.text ?? "").join(" "), {
        nodeIds: party.sourceNodeIds,
        spanIds: party.sourceSpanIds,
        pageLevel: cited.some((span) => span.sourceUnit === "page"),
        order: spanOrder.get(sourceSpanId(cited[0])) ?? 0,
      });
    }),
  ];
  const seen = new Set<string>();
  return evidence
    .filter((item) => {
      const key =
        `${item.nodeIds.join(",")}|${item.spanIds.join(",")}|${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      ...item,
      nodeIds: [...new Set([
        ...item.nodeIds,
        ...sourceTree
          .filter((node) =>
            !PAGE_LEVEL_NODE_KINDS.includes(node.kind) &&
            node.sourceSpanIds.some((spanId) => item.spanIds.includes(spanId))
          )
          .map((node) => node.id),
      ])],
    }));
}

function titleCaseCarrierName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (!letters || word !== word.toUpperCase() || letters.length <= 3) {
        return word;
      }
      return `${word[0]}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

type CarrierCandidate = {
  relationship: Exclude<CarrierIdentityDecision["relationship"], "unknown">;
  displayName: string;
  sourceName: string;
  operatingName?: string;
  legalNames: string[];
  legalEntityRelationship: CarrierLegalEntityRelationship;
  evidence: CarrierEvidence;
  /** Tied to a source-backed carrier party; used only without a decision. */
  linked: boolean;
};

function parseLloydsIdentity(item: CarrierEvidence) {
  const text = item.text.replace(/\s+/g, " ").trim();
  const ledBy = text.match(
    /\blloyd['’]?s\s+underwriters?\s*[:,;-]?\s+led\s+by\s*:?\s*/i,
  );
  if (!ledBy || ledBy.index === undefined) return undefined;
  const tail = text.slice(ledBy.index + ledBy[0].length);
  const syndicates = Array.from(
    tail.matchAll(
      /\bsyndicates?\s+(?:no\.?\s*)?(\d{3,6})(?:\s+([A-Z0-9]+))?/gi,
    ),
  );
  if (syndicates.length === 0 || syndicates[0].index === undefined) {
    return undefined;
  }
  const lead = tail
    .slice(0, syndicates[0].index)
    .trim()
    .replace(/[,:;-]+$/, "")
    .trim();
  if (
    !lead ||
    lead.length > 160 ||
    CARRIER_CONTAMINATION_PATTERN.test(lead) ||
    CARRIER_FINANCIAL_CONTAMINATION_PATTERN.test(lead)
  ) {
    return undefined;
  }
  const displayName = titleCaseCarrierName(lead);
  const labels = syndicates.map((match) => {
    const suffix = match[2]?.toUpperCase();
    const safeSuffix =
      suffix && !["AND", "OR", "UNDER"].includes(suffix)
        ? suffix
        : undefined;
    return `Syndicate No. ${match[1]}${safeSuffix ? ` ${safeSuffix}` : ""}`;
  });
  const contract = tail.match(
    /\b(?:under\s+)?contract\s+(number|no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9()/_-]*)/i,
  );
  const contractLabel = contract
    ? /^no/i.test(contract[1]) ? "contract no." : "contract number"
    : undefined;
  const legalNames = labels.map((label) => `${displayName}, ${label}`);
  return {
    displayName,
    sourceName: [
      `Lloyd's Underwriters led by: ${displayName}`,
      labels.join(" and "),
      contract && contractLabel
        ? `under ${contractLabel} ${contract[2]}`
        : undefined,
    ].filter(Boolean).join(", "),
    legalNames,
    legalEntityRelationship: legalNames.length <= 1 ? "single" as const : "and" as const,
  };
}

function carrierLegalEntityRelationship(
  legalEntityCount: number,
  evidenceText: string,
): CarrierLegalEntityRelationship {
  if (legalEntityCount <= 1) return "single";
  if (/\band\s*\/\s*or\b/i.test(evidenceText)) return "and_or";
  if (/\bor\b/i.test(evidenceText)) return "or";
  if (/\band\b/i.test(evidenceText)) return "and";
  return "unspecified";
}

function operatingNameAfterMarker(text: string) {
  const marker = text.match(OPERATING_NAME_PATTERN);
  if (marker?.index === undefined) return undefined;
  const tail = text
    .slice(marker.index + marker[0].length)
    .replace(/^[\s:,-]+/, "")
    .split(/[.;\n]/)[0]
    .replace(/\s+\([A-Z0-9&/ -]{2,20}\)\s*$/i, "")
    .replace(/[,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !tail ||
    tail.length > 120 ||
    tail.split(/\s+/).length > 12 ||
    /^(?:the|this|that|it|we|you|they|an?|and|or)\b/i.test(tail) ||
    CARRIER_CONTAMINATION_PATTERN.test(tail) ||
    /\b(?:is|are|was|were|provides?|includes?|applies?|means?)$/i.test(tail)
  ) {
    return undefined;
  }
  return tail;
}

function parseOperatingIdentity(item: CarrierEvidence) {
  const legalNames = legalEntityNamesBeforeOperatingMarker(item.text);
  const displayName = operatingNameAfterMarker(item.text);
  if (!displayName || legalNames.length === 0) return undefined;
  return {
    displayName,
    sourceName: displayName,
    operatingName: displayName,
    legalNames,
    legalEntityRelationship: carrierLegalEntityRelationship(
      legalNames.length,
      item.text.slice(0, item.text.search(OPERATING_NAME_PATTERN)),
    ),
  };
}

function candidateNames(candidate: Pick<CarrierCandidate, "displayName" | "sourceName" | "legalNames">) {
  return [candidate.displayName, candidate.sourceName, ...candidate.legalNames];
}

function sharesProvenance(party: CarrierOperationalParty, evidence: CarrierEvidence) {
  return !evidence.pageLevel && (
    party.sourceNodeIds.some((id) => evidence.nodeIds.includes(id)) ||
    party.sourceSpanIds.some((id) => evidence.spanIds.includes(id))
  );
}

/**
 * Lloyd's and operating-name clauses parsed from source evidence, most
 * specific evidence first. Jev chooses among these when a decision exists.
 */
function structuredCarrierCandidates(
  evidence: CarrierEvidence[],
  carrierParties: CarrierOperationalParty[],
): CarrierCandidate[] {
  const ordered = [...evidence].sort((left, right) =>
    Number(left.pageLevel) - Number(right.pageLevel) ||
    left.text.length - right.text.length ||
    left.order - right.order
  );
  const candidates: CarrierCandidate[] = [];
  const nameMatchesParty = (names: string[]) =>
    carrierParties.some((party) =>
      names.some((name) => sameCarrierIdentityName(name, party.name))
    );
  for (const item of ordered) {
    const lloyds = parseLloydsIdentity(item);
    if (lloyds) {
      candidates.push({
        ...lloyds,
        relationship: "lloyds_syndicate",
        evidence: item,
        linked:
          nameMatchesParty(candidateNames(lloyds)) ||
          carrierParties.some((party) =>
            sameCarrierIdentityName(party.name, "Lloyd's Underwriters") &&
            sharesProvenance(party, item)
          ),
      });
    }
    const operating = parseOperatingIdentity(item);
    if (operating) {
      candidates.push({
        ...operating,
        relationship: "operating_name",
        evidence: item,
        linked: nameMatchesParty(candidateNames(operating)),
      });
    }
  }
  const seen = new Set<string>();
  return candidates
    .sort((left, right) =>
      Number(right.relationship === "lloyds_syndicate") -
      Number(left.relationship === "lloyds_syndicate")
    )
    .filter((candidate) => {
      const key = JSON.stringify([
        normalizedCarrierIdentityText(candidate.sourceName),
        candidate.legalNames.map(normalizedCarrierIdentityText),
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function matchingPartySources(
  parties: CarrierOperationalParty[],
  name: string,
) {
  const matching = parties.filter((party) =>
    sameCarrierIdentityName(party.name, name)
  );
  return {
    sourceNodeIds: matching.flatMap((party) => party.sourceNodeIds),
    sourceSpanIds: matching.flatMap((party) => party.sourceSpanIds),
  };
}

function carrierLegalEntity(
  name: string,
  parties: CarrierOperationalParty[],
  evidence?: Pick<CarrierEvidence, "nodeIds" | "spanIds">,
): CarrierLegalEntity {
  const partySources = matchingPartySources(parties, name);
  return {
    name,
    sourceNodeIds: [...new Set([
      ...partySources.sourceNodeIds,
      ...(evidence?.nodeIds ?? []),
    ])],
    sourceSpanIds: [...new Set([
      ...partySources.sourceSpanIds,
      ...(evidence?.spanIds ?? []),
    ])],
  };
}

function carrierIdentityFromCandidate(
  candidate: CarrierCandidate,
  parties: CarrierOperationalParty[],
): CarrierIdentity {
  const legalEntities = candidate.legalNames.map((name) =>
    carrierLegalEntity(name, parties, candidate.evidence)
  );
  return {
    displayName: candidate.displayName,
    sourceName: candidate.sourceName,
    ...(candidate.operatingName ? { operatingName: candidate.operatingName } : {}),
    legalEntities,
    legalEntityRelationship: candidate.legalEntityRelationship,
    sourceNodeIds: [...new Set([
      ...candidate.evidence.nodeIds,
      ...legalEntities.flatMap((entity) => entity.sourceNodeIds),
    ])],
    sourceSpanIds: [...new Set([
      ...candidate.evidence.spanIds,
      ...legalEntities.flatMap((entity) => entity.sourceSpanIds),
    ])],
  };
}

function sourceBackedCarrierParties(
  profile: CarrierOperationalProfile,
): CarrierOperationalParty[] {
  const insurer = profile.insurer;
  const insurerParty = {
    role: "insurer",
    name: typeof insurer?.value === "string" ? insurer.value.trim() : "",
    sourceNodeIds: stringArray(insurer?.sourceNodeIds),
    sourceSpanIds: stringArray(insurer?.sourceSpanIds),
  };
  return [...operationalParties(profile), insurerParty].filter((party) =>
    party.name &&
    ["carrier", "insurer"].includes(party.role.toLowerCase()) &&
    (party.sourceNodeIds.length > 0 || party.sourceSpanIds.length > 0)
  );
}

/** Extracted carrier/insurer parties, one candidate per distinct name. */
function partyCarrierCandidates(
  parties: CarrierOperationalParty[],
): CarrierCandidate[] {
  return uniqueCarrierNames(parties.map((party) => party.name)).map((name) => {
    const sources = matchingPartySources(parties, name);
    return {
      relationship: "issuing_insurer",
      displayName: name,
      sourceName: name,
      legalNames: [name],
      legalEntityRelationship: "single",
      evidence: {
        nodeIds: [...new Set(sources.sourceNodeIds)],
        spanIds: [...new Set(sources.sourceSpanIds)],
        text: name,
        pageLevel: false,
        order: 0,
      },
      linked: true,
    };
  });
}

/** Deterministic fallback when no clause applies: the extracted carrier party. */
function partyCarrierIdentity(
  parties: CarrierOperationalParty[],
): CarrierIdentity | undefined {
  const displayName = (
    parties.find((party) => party.role.toLowerCase() === "carrier") ??
    parties[0]
  )?.name;
  if (!displayName) return undefined;
  const displaySources = matchingPartySources(parties, displayName);
  const legalEntities = uniqueCarrierNames(
    parties.map((party) => party.name).filter(isCompleteLegalEntityName),
  ).map((name) => carrierLegalEntity(name, parties));
  return {
    displayName,
    sourceName: displayName,
    legalEntities,
    legalEntityRelationship:
      legalEntities.length <= 1 ? "single" : "unspecified",
    sourceNodeIds: [...new Set([
      ...displaySources.sourceNodeIds,
      ...legalEntities.flatMap((entity) => entity.sourceNodeIds),
    ])],
    sourceSpanIds: [...new Set([
      ...displaySources.sourceSpanIds,
      ...legalEntities.flatMap((entity) => entity.sourceSpanIds),
    ])],
  };
}

function sourceCarrierIdentityKey(identity: CarrierIdentity) {
  return JSON.stringify({
    sourceName: normalizedCarrierIdentityText(
      identity.sourceName ?? identity.displayName,
    ),
    legalNames: identity.legalEntities
      .map((entity) => normalizedCarrierIdentityText(entity.name))
      .sort(),
    legalEntityRelationship: identity.legalEntityRelationship,
  });
}

export function sourceCarrierIdentityUnchanged(
  existing: CarrierIdentity | undefined,
  rebuilt: CarrierIdentity,
) {
  return Boolean(
    existing &&
    sourceCarrierIdentityKey(existing) === sourceCarrierIdentityKey(rebuilt),
  );
}

export function preserveCurrentCarrierBranding(
  rebuilt: CarrierIdentity,
  existing: CarrierIdentity | undefined,
) {
  if (
    !sourceCarrierIdentityUnchanged(existing, rebuilt) ||
    existing?.branding?.enrichmentVersion !==
      CARRIER_IDENTITY_ENRICHMENT_VERSION
  ) {
    return rebuilt;
  }
  return {
    ...rebuilt,
    displayName: existing.displayName,
    ...(existing.operatingName
      ? { operatingName: existing.operatingName }
      : rebuilt.operatingName
        ? { operatingName: rebuilt.operatingName }
        : {}),
    ...(existing.publicNameRelationship
      ? { publicNameRelationship: existing.publicNameRelationship }
      : {}),
    branding: existing.branding,
  };
}

// Owner: P4 (docs/architecture/convex-section-extraction.md). Jev choice among
// deterministic carrier candidates; consumed by buildCarrierIdentityFromSourceEvidence.
export type CarrierIdentityDecision = {
  version: "carrier-identity-decision-v1";
  /** Exact candidate name chosen from deterministic source evidence; null when none fits. */
  insurerLegalName: string | null;
  relationship: "issuing_insurer" | "operating_name" | "lloyds_syndicate" | "unknown";
  confidence: number;
  sourceSpanIds: string[];
  /** Set when Jev was not confident enough to choose; operators should confirm the carrier. */
  reviewReason?: string;
};

type CarrierEvidenceParams = {
  operationalProfile: CarrierOperationalProfile;
  sourceTree: CarrierSourceNode[];
  sourceSpans?: CarrierSourceSpan[];
};

function carrierCandidates(params: CarrierEvidenceParams) {
  const parties = sourceBackedCarrierParties(params.operationalProfile);
  const structured = structuredCarrierCandidates(
    carrierIdentityEvidence(params.sourceTree, params.sourceSpans ?? [], parties),
    parties,
  );
  return {
    parties,
    structured,
    all: [...structured, ...partyCarrierCandidates(parties)],
  };
}

const CARRIER_DECISION_MIN_CONFIDENCE = 0.6;
const MAX_CARRIER_CANDIDATES = 24;

export async function resolveCarrierIdentityDecision(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  operationalProfile: CarrierOperationalProfile;
  sourceTree: CarrierSourceNode[];
  sourceSpans?: CarrierSourceSpan[];
  traceId?: string;
}): Promise<CarrierIdentityDecision | null> {
  const { structured, all } = carrierCandidates(args);
  // A lone extracted party needs no judgment: the deterministic path uses it.
  if (structured.length === 0 && all.length <= 1) return null;
  const candidates = all.slice(0, MAX_CARRIER_CANDIDATES);
  const spanText = new Map(
    (args.sourceSpans ?? []).map((span) => [sourceSpanId(span), span.text ?? ""]),
  );
  const evidenceText = (candidate: CarrierCandidate) =>
    (candidate.relationship === "issuing_insurer"
      ? candidate.evidence.spanIds.map((id) => spanText.get(id) ?? "").join(" ")
      : candidate.evidence.text
    ).replace(/\s+/g, " ").trim().slice(0, 600);
  try {
    const result = await clRouterDecide({
      orgId: String(args.orgId),
      task: "policy_extraction_carrier_identity",
      state: {
        extractedCarrierParties: all
          .filter((candidate) => candidate.relationship === "issuing_insurer")
          .map((candidate) => candidate.displayName),
      },
      questions: {
        insurer: {
          type: "choice",
          instructions:
            "Which candidate identifies the insurer that issued this policy: the risk-bearing legal entity or entities, not a broker, agent, MGA, reinsurer, or a policy merely referenced by this one? Candidates are quoted from the policy's own text. An operating-name clause lists legal entities trading under one brand. For Lloyd's placements, choose the led-by clause for this policy rather than one quoted from an underlying or scheduled policy. Choose none when no candidate is the issuing insurer.",
          criteria: {
            ...Object.fromEntries(candidates.map((candidate, index) => [
              `candidate_${index}`,
              {
                name: candidate.sourceName,
                legalEntities: candidate.legalNames,
                presentation: candidate.relationship,
                evidence: evidenceText(candidate) || candidate.sourceName,
              },
            ])),
            none: "None of the candidates is the issuing insurer.",
          },
        },
      },
      trace: args.traceId ? { traceId: args.traceId } : undefined,
    }, { telemetry: args.ctx });
    const answer = result.answers.insurer;
    if (answer?.type !== "choice") return null;
    const confidence = Math.min(
      answer.confidence,
      answer.probabilities[answer.choice] ?? 0,
    );
    const chosen = candidates[Number(answer.choice.replace("candidate_", ""))];
    if (confidence < CARRIER_DECISION_MIN_CONFIDENCE || answer.choice === "none" || !chosen) {
      return {
        version: "carrier-identity-decision-v1",
        insurerLegalName: null,
        relationship: "unknown",
        confidence,
        sourceSpanIds: [],
        ...(confidence < CARRIER_DECISION_MIN_CONFIDENCE
          ? {
              reviewReason: `Carrier identity is ambiguous across ${candidates.length} source candidates; confirm the issuing insurer.`,
            }
          : {}),
      };
    }
    return {
      version: "carrier-identity-decision-v1",
      insurerLegalName: chosen.legalNames[0] ?? chosen.displayName,
      relationship: chosen.relationship,
      confidence,
      sourceSpanIds: chosen.evidence.spanIds,
    };
  } catch {
    // Router failures keep the deterministic carrier identity.
    return null;
  }
}

export function buildCarrierIdentityFromSourceEvidence(params: CarrierEvidenceParams & {
  carrierDecision?: CarrierIdentityDecision | null;
}): CarrierIdentity | undefined {
  const { parties, structured, all } = carrierCandidates(params);
  const decidedName = params.carrierDecision?.insurerLegalName;
  if (decidedName) {
    const matches = all.filter((candidate) =>
      candidateNames(candidate).some((name) =>
        sameCarrierIdentityName(name, decidedName)
      )
    );
    const decided =
      matches.find((candidate) =>
        candidate.relationship === params.carrierDecision?.relationship
      ) ?? matches[0];
    if (decided) return carrierIdentityFromCandidate(decided, parties);
  }
  const linked = structured.find((candidate) => candidate.linked);
  return linked
    ? carrierIdentityFromCandidate(linked, parties)
    : partyCarrierIdentity(parties);
}

export function sourceSpanLikeFromStoredSource(
  value: Record<string, unknown>,
  fallbackDocumentId: string,
): CarrierSourceSpan {
  return {
    id: String(value.spanId),
    spanId: String(value.spanId),
    documentId:
      typeof value.documentId === "string"
        ? value.documentId
        : fallbackDocumentId,
    sourceKind:
      typeof value.sourceKind === "string"
        ? value.sourceKind
        : "policy_pdf",
    kind: "pdf_text",
    pageStart:
      typeof value.pageStart === "number" ? value.pageStart : undefined,
    pageEnd: typeof value.pageEnd === "number" ? value.pageEnd : undefined,
    sectionId:
      typeof value.sectionId === "string" ? value.sectionId : undefined,
    formNumber:
      typeof value.formNumber === "string" ? value.formNumber : undefined,
    sourceUnit:
      typeof value.sourceUnit === "string" ? value.sourceUnit : undefined,
    parentSpanId:
      typeof value.parentSpanId === "string"
        ? value.parentSpanId
        : undefined,
    table:
      value.table && typeof value.table === "object" &&
        !Array.isArray(value.table)
        ? value.table as Record<string, unknown>
        : undefined,
    location:
      value.location && typeof value.location === "object" &&
        !Array.isArray(value.location)
        ? value.location as Record<string, unknown>
        : undefined,
    text: typeof value.text === "string" ? value.text : "",
    textHash:
      typeof value.textHash === "string" ? value.textHash : undefined,
    bbox: Array.isArray(value.bbox)
      ? value.bbox as CarrierSourceSpan["bbox"]
      : undefined,
    metadata:
      value.metadata && typeof value.metadata === "object" &&
        !Array.isArray(value.metadata)
        ? value.metadata as Record<string, unknown>
        : undefined,
  };
}

export function sourceNodeFromStoredSource(
  value: Record<string, unknown>,
  fallbackDocumentId: string,
): (CarrierSourceNode & Record<string, unknown>) | undefined {
  if (typeof value.nodeId !== "string" || !value.nodeId.trim()) {
    return undefined;
  }
  if (typeof value.kind !== "string" || !value.kind.trim()) return undefined;
  return {
    id: value.nodeId,
    documentId:
      typeof value.documentId === "string"
        ? value.documentId
        : fallbackDocumentId,
    parentId:
      typeof value.parentNodeId === "string"
        ? value.parentNodeId
        : undefined,
    kind: value.kind,
    title: typeof value.title === "string" ? value.title : value.kind,
    description:
      typeof value.description === "string"
        ? value.description
        : value.kind,
    textExcerpt:
      typeof value.textExcerpt === "string"
        ? value.textExcerpt
        : undefined,
    sourceSpanIds: stringArray(value.sourceSpanIds),
    pageStart:
      typeof value.pageStart === "number" ? value.pageStart : undefined,
    pageEnd: typeof value.pageEnd === "number" ? value.pageEnd : undefined,
    bbox: value.bbox,
    order: typeof value.order === "number" ? value.order : 0,
    path: typeof value.path === "string" ? value.path : "",
    metadata: value.metadata,
  };
}
