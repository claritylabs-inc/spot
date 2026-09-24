import {
  sameCarrierIdentityName,
  type CarrierIdentity,
  type CarrierLegalEntity,
  type CarrierLegalEntityRelationship,
} from "./carrierIdentity";
import { CARRIER_IDENTITY_ENRICHMENT_VERSION } from "./carrierIdentityEnrichment";
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
  source: "source_node" | "source_span" | "same_column_clause";
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

function sourceSpanPage(span: CarrierSourceSpan) {
  if (typeof span.pageStart === "number") return span.pageStart;
  const location = span.location;
  if (!location || typeof location !== "object") return undefined;
  return typeof location.page === "number"
    ? location.page
    : typeof location.startPage === "number"
      ? location.startPage
      : undefined;
}

type CarrierSourceRect = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function sourceSpanRect(
  span: CarrierSourceSpan,
): CarrierSourceRect | undefined {
  if (!Array.isArray(span.bbox)) return undefined;
  const boxes = span.bbox.filter((box): box is CarrierSourceRect =>
    Boolean(
      box &&
      typeof box.page === "number" &&
      typeof box.x === "number" &&
      typeof box.y === "number" &&
      typeof box.width === "number" &&
      typeof box.height === "number",
    )
  );
  if (boxes.length === 0) return undefined;
  const page = boxes[0].page;
  const pageBoxes = boxes.filter((box) => box.page === page);
  const left = Math.min(...pageBoxes.map((box) => box.x));
  const top = Math.min(...pageBoxes.map((box) => box.y));
  const right = Math.max(...pageBoxes.map((box) => box.x + box.width));
  const bottom = Math.max(...pageBoxes.map((box) => box.y + box.height));
  return {
    page,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function sameCarrierColumn(
  anchor: CarrierSourceRect,
  candidate: CarrierSourceRect,
) {
  if (anchor.page !== candidate.page) return false;
  const overlap =
    Math.min(anchor.x + anchor.width, candidate.x + candidate.width) -
    Math.max(anchor.x, candidate.x);
  const overlapRatio =
    Math.max(0, overlap) / Math.max(1, Math.min(anchor.width, candidate.width));
  const anchorCenter = anchor.x + anchor.width / 2;
  const candidateCenter = candidate.x + candidate.width / 2;
  return (
    overlapRatio >= 0.3 ||
    Math.abs(anchorCenter - candidateCenter) <=
      Math.max(24, Math.min(anchor.width, candidate.width) * 0.45)
  );
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

function sameColumnCarrierEvidence(
  sourceSpans: CarrierSourceSpan[],
): CarrierEvidence[] {
  return sourceSpans.flatMap((anchor, anchorIndex): CarrierEvidence[] => {
    const anchorText = typeof anchor.text === "string" ? anchor.text : "";
    if (
      !isCarrierIdentityEvidence(anchorText) &&
      !/\blloyd['’]?s\s+underwriters?\b/i.test(anchorText)
    ) {
      return [];
    }
    const page = sourceSpanPage(anchor);
    const anchorRect = sourceSpanRect(anchor);
    if (!anchorRect) return [];
    const candidates = sourceSpans
      .map((span, index) => ({ span, index, rect: sourceSpanRect(span) }))
      .filter(({ span, rect }) => {
        if (page !== undefined && sourceSpanPage(span) !== page) return false;
        if (!rect || span.sourceUnit === "page") return false;
        const verticalDistance = Math.max(
          0,
          anchorRect.y - (rect.y + rect.height),
          rect.y - (anchorRect.y + anchorRect.height),
        );
        const likelyMultiColumnAggregate =
          anchorRect.width < 350 && rect.width > 400;
        return (
          !likelyMultiColumnAggregate &&
          sameCarrierColumn(anchorRect, rect) &&
          verticalDistance <= 120
        );
      })
      .filter((candidate, index, all) => {
        const id = sourceSpanId(candidate.span);
        const text =
          typeof candidate.span.text === "string"
            ? candidate.span.text.replace(/\s+/g, " ").trim()
            : "";
        const key = `${id ?? ""}|${text}|${candidate.rect?.x}|${candidate.rect?.y}`;
        return all.findIndex((item) => {
          const itemId = sourceSpanId(item.span);
          const itemText =
            typeof item.span.text === "string"
              ? item.span.text.replace(/\s+/g, " ").trim()
              : "";
          return (
            `${itemId ?? ""}|${itemText}|${item.rect?.x}|${item.rect?.y}` ===
            key
          );
        }) === index;
      });
    candidates.sort((left, right) => {
      if (left.rect && right.rect) {
        return (
          left.rect.y - right.rect.y ||
          left.rect.x - right.rect.x ||
          left.index - right.index
        );
      }
      return left.index - right.index;
    });
    const anchorPosition = candidates.findIndex(
      ({ index }) => index === anchorIndex,
    );
    if (anchorPosition < 0) return [];
    const evidence: CarrierEvidence[] = [];
    for (let before = 0; before <= 6; before += 1) {
      const start = anchorPosition - before;
      if (start < 0) break;
      for (let after = 0; after <= 4; after += 1) {
        const end = anchorPosition + after + 1;
        if (end > candidates.length) break;
        const window = candidates.slice(start, end);
        const text = carrierClauseText(
          window
            .map(({ span }) =>
              typeof span.text === "string" ? span.text : ""
            )
            .filter(Boolean)
            .join(" "),
        );
        if (!text || !isCarrierIdentityEvidence(text)) continue;
        evidence.push({
          nodeIds: [],
          spanIds: window.flatMap(({ span }) => {
            const id = sourceSpanId(span);
            return id ? [id] : [];
          }),
          text,
          source: "same_column_clause",
          pageLevel: false,
          order: anchorIndex,
        });
      }
    }
    return evidence;
  });
}

function carrierIdentityEvidence(
  sourceTree: CarrierSourceNode[],
  sourceSpans: CarrierSourceSpan[],
) {
  const evidence: CarrierEvidence[] = [
    ...sourceTree.flatMap((node, order): CarrierEvidence[] => {
      const text = carrierClauseText(
        node.textExcerpt ?? node.description ?? node.title,
      );
      return text && isCarrierIdentityEvidence(text)
        ? [{
            nodeIds: [node.id],
            spanIds: node.sourceSpanIds,
            text,
            source: "source_node",
            pageLevel:
              ["document", "page_group", "page"].includes(node.kind) ||
              node.sourceSpanIds.length > 8,
            order,
          }]
        : [];
    }),
    ...sourceSpans.flatMap((span, order): CarrierEvidence[] => {
      const text = carrierClauseText(
        typeof span.text === "string" ? span.text : "",
      );
      const spanId = sourceSpanId(span);
      return text && isCarrierIdentityEvidence(text)
        ? [{
            nodeIds: [],
            spanIds: spanId ? [spanId] : [],
            text,
            source: "source_span",
            pageLevel: span.sourceUnit === "page",
            order,
          }]
        : [];
    }),
    ...sameColumnCarrierEvidence(sourceSpans),
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
            !["document", "page_group", "page"].includes(node.kind) &&
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

function evidenceSpecificityScore(item: CarrierEvidence) {
  return (
    (item.source === "same_column_clause"
      ? 50
      : item.source === "source_span"
        ? 35
        : 20) -
    (item.pageLevel ? 80 : 0) -
    Math.floor(item.text.length / 120)
  );
}

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
  return {
    displayName,
    sourceName: [
      `Lloyd's Underwriters led by: ${displayName}`,
      labels.join(" and "),
      contract && contractLabel
        ? `under ${contractLabel} ${contract[2]}`
        : undefined,
    ].filter(Boolean).join(", "),
    legalNames: labels.map((label) => `${displayName}, ${label}`),
    evidence: item,
    score:
      200 +
      evidenceSpecificityScore(item) +
      labels.length * 12 +
      (contract ? 8 : 0) -
      (CARRIER_CONTAMINATION_PATTERN.test(lead) ? 120 : 0) -
      (CARRIER_FINANCIAL_CONTAMINATION_PATTERN.test(lead) ? 180 : 0),
  };
}

function lloydsLedByIdentity(
  evidence: CarrierEvidence[],
  carrierParties: CarrierOperationalParty[],
) {
  return evidence
    .flatMap((item) => {
      const parsed = parseLloydsIdentity(item);
      if (!parsed) return [];
      const specificNames = [
        parsed.displayName,
        parsed.sourceName,
        ...parsed.legalNames,
      ];
      const belongsToCarrier = carrierParties.some((party) => {
        if (
          specificNames.some((name) =>
            sameCarrierIdentityName(name, party.name),
          )
        ) {
          return true;
        }
        if (!sameCarrierIdentityName(party.name, "Lloyd's Underwriters")) {
          return false;
        }
        if (item.pageLevel) return false;
        return (
          party.sourceNodeIds.some((id) => item.nodeIds.includes(id)) ||
          party.sourceSpanIds.some((id) => item.spanIds.includes(id))
        );
      });
      return belongsToCarrier ? [parsed] : [];
    })
    .sort((left, right) =>
      right.score - left.score ||
      left.evidence.text.length - right.evidence.text.length ||
      left.evidence.order - right.evidence.order
    )[0];
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

function operatingCarrierIdentity(
  evidence: CarrierEvidence[],
  carrierPartyNames: string[],
) {
  return evidence
    .flatMap((item) => {
      const legalNames = legalEntityNamesBeforeOperatingMarker(item.text);
      const displayName = operatingNameAfterMarker(item.text);
      const belongsToCarrier = [displayName, ...legalNames].some((name) =>
        carrierPartyNames.some((partyName) =>
          sameCarrierIdentityName(name, partyName)
        )
      );
      if (
        !displayName ||
        legalNames.length === 0 ||
        !belongsToCarrier
      ) {
        return [];
      }
      return [{
        displayName,
        legalNames,
        relationship: carrierLegalEntityRelationship(
          legalNames.length,
          item.text.slice(0, item.text.search(OPERATING_NAME_PATTERN)),
        ),
        evidence: item,
        score:
          160 +
          evidenceSpecificityScore(item) +
          legalNames.length * 10 -
          (CARRIER_CONTAMINATION_PATTERN.test(item.text) ? 120 : 0),
      }];
    })
    .sort((left, right) =>
      right.score - left.score ||
      left.evidence.text.length - right.evidence.text.length ||
      left.evidence.order - right.evidence.order
    )[0];
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
  evidence?: CarrierEvidence,
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
};

export async function resolveCarrierIdentityDecision(_args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  operationalProfile: CarrierOperationalProfile;
  sourceTree: CarrierSourceNode[];
  sourceSpans?: CarrierSourceSpan[];
  traceId?: string;
}): Promise<CarrierIdentityDecision | null> {
  return null;
}

export function buildCarrierIdentityFromSourceEvidence(params: {
  operationalProfile: CarrierOperationalProfile;
  sourceTree: CarrierSourceNode[];
  sourceSpans?: CarrierSourceSpan[];
  carrierDecision?: CarrierIdentityDecision | null;
}): CarrierIdentity | undefined {
  const parties = operationalParties(params.operationalProfile);
  const evidence = carrierIdentityEvidence(
    params.sourceTree,
    params.sourceSpans ?? [],
  );
  const insurerValue = params.operationalProfile.insurer;
  const insurerValueIsSourceBacked =
    stringArray(insurerValue?.sourceNodeIds).length > 0 ||
    stringArray(insurerValue?.sourceSpanIds).length > 0;
  const insurerValueName =
    typeof insurerValue?.value === "string" && insurerValueIsSourceBacked
      ? insurerValue.value.trim()
      : undefined;
  const sourceBackedCarrierParties = [
    ...parties.filter((party) =>
      ["carrier", "insurer"].includes(party.role.toLowerCase()) &&
      (party.sourceNodeIds.length > 0 || party.sourceSpanIds.length > 0)
    ),
    ...(insurerValueName
      ? [{
          role: "insurer",
          name: insurerValueName,
          sourceNodeIds: stringArray(insurerValue?.sourceNodeIds),
          sourceSpanIds: stringArray(insurerValue?.sourceSpanIds),
        }]
      : []),
  ];
  const carrierPartyNames = uniqueCarrierNames(
    sourceBackedCarrierParties.map((party) => party.name),
  );
  const lloydsIdentity = lloydsLedByIdentity(
    evidence,
    sourceBackedCarrierParties,
  );
  const operatingIdentity = operatingCarrierIdentity(
    evidence,
    carrierPartyNames,
  );
  const carrierParty = sourceBackedCarrierParties.find((party) =>
    party.role.toLowerCase() === "carrier"
  );
  const insurerParties = sourceBackedCarrierParties.filter((party) =>
    party.role.toLowerCase() === "insurer"
  );

  if (lloydsIdentity) {
    const legalEntities = lloydsIdentity.legalNames.map((name) =>
      carrierLegalEntity(
        name,
        sourceBackedCarrierParties,
        lloydsIdentity.evidence,
      )
    );
    return {
      displayName: lloydsIdentity.displayName,
      sourceName: lloydsIdentity.sourceName,
      legalEntities,
      legalEntityRelationship:
        legalEntities.length <= 1 ? "single" : "and",
      sourceNodeIds: [...new Set([
        ...lloydsIdentity.evidence.nodeIds,
        ...legalEntities.flatMap((entity) => entity.sourceNodeIds),
      ])],
      sourceSpanIds: [...new Set([
        ...lloydsIdentity.evidence.spanIds,
        ...legalEntities.flatMap((entity) => entity.sourceSpanIds),
      ])],
    };
  }

  if (operatingIdentity) {
    const legalEntities = operatingIdentity.legalNames.map((name) =>
      carrierLegalEntity(
        name,
        sourceBackedCarrierParties,
        operatingIdentity.evidence,
      )
    );
    return {
      displayName: operatingIdentity.displayName,
      sourceName: operatingIdentity.displayName,
      operatingName: operatingIdentity.displayName,
      legalEntities,
      legalEntityRelationship: operatingIdentity.relationship,
      sourceNodeIds: [...new Set([
        ...operatingIdentity.evidence.nodeIds,
        ...legalEntities.flatMap((entity) => entity.sourceNodeIds),
      ])],
      sourceSpanIds: [...new Set([
        ...operatingIdentity.evidence.spanIds,
        ...legalEntities.flatMap((entity) => entity.sourceSpanIds),
      ])],
    };
  }

  const insurerParty = insurerParties[0];
  const displayParty = carrierParty ?? insurerParty;
  const displayName =
    displayParty?.name ??
    insurerValueName;
  if (!displayName) return undefined;
  const insurerValueMatchesDisplay =
    insurerValueName !== undefined &&
    sameCarrierIdentityName(displayName, insurerValueName);
  const displaySourceNodeIds = [
    ...(displayParty?.sourceNodeIds ?? []),
    ...(insurerValueMatchesDisplay
      ? stringArray(insurerValue?.sourceNodeIds)
      : []),
  ];
  const displaySourceSpanIds = [
    ...(displayParty?.sourceSpanIds ?? []),
    ...(insurerValueMatchesDisplay
      ? stringArray(insurerValue?.sourceSpanIds)
      : []),
  ];
  if (
    displaySourceNodeIds.length === 0 &&
    displaySourceSpanIds.length === 0
  ) {
    return undefined;
  }
  const legalNames = uniqueCarrierNames([
    ...sourceBackedCarrierParties
      .map((party) => party.name)
      .filter(isCompleteLegalEntityName),
  ]);
  const legalEntities = legalNames.map((name) =>
    carrierLegalEntity(name, sourceBackedCarrierParties)
  );
  return {
    displayName,
    sourceName: displayName,
    legalEntities,
    legalEntityRelationship:
      legalEntities.length <= 1 ? "single" : "unspecified",
    sourceNodeIds: [...new Set([
      ...displaySourceNodeIds,
      ...legalEntities.flatMap((entity) => entity.sourceNodeIds),
    ])],
    sourceSpanIds: [...new Set([
      ...displaySourceSpanIds,
      ...legalEntities.flatMap((entity) => entity.sourceSpanIds),
    ])],
  };
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
