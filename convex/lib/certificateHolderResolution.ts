import {
  certificateHolderAddressLines,
  normalizeCertificateHolderName,
  type CertificateHolderAddressInput,
} from "./certificateIdentity";

export type HolderIdentityVerdict =
  | "same_holder"
  | "different_holder"
  | "ambiguous"
  | "needs_model"
  | "no_match";

export type NormalizedCertificateHolderAddress = {
  canonicalText: string;
  streetKey?: string;
  unit?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type CertificateHolderIdentity = {
  displayName: string;
  normalizedName: string;
  address?: CertificateHolderAddressInput;
  normalizedAddress?: NormalizedCertificateHolderAddress;
};

export type CertificateHolderResolutionCandidate<T = unknown> = {
  candidateId: string;
  identity: CertificateHolderIdentity;
  issuedAt?: number;
  createdAt?: number;
  data: T;
};

export type CertificateHolderResolutionResult<T = unknown> =
  | {
      verdict: "same_holder";
      confidence: "high" | "moderate";
      reason: string;
      candidate: CertificateHolderResolutionCandidate<T>;
    }
  | {
      verdict: "ambiguous" | "needs_model";
      confidence: "low" | "moderate";
      reason: string;
      candidates: CertificateHolderResolutionCandidate<T>[];
    }
  | {
      verdict: "no_match";
      confidence: "high" | "moderate";
      reason: string;
    };

function cleanText(value?: string) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed || undefined;
}

function normalizeState(value?: string) {
  return cleanText(value)?.toLowerCase();
}

function normalizePostalCode(value?: string) {
  return cleanText(value)?.toLowerCase().replace(/\s+/g, "");
}

function normalizeAddressText(value: string) {
  let text = value
    .toLowerCase()
    .replace(/#/g, " unit ")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .replace(/\b(suite|ste|unit|apt|apartment|floor|fl)\b/g, "unit")
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(parkway)\b/g, "pkwy")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w");

  text = text.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function compactAddressText(value?: string) {
  return value?.replace(/[^a-z0-9]/g, "") || undefined;
}

function addressFieldLines(address: CertificateHolderAddressInput) {
  const cityStateZip = [
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return [address.line1, address.line2, cityStateZip, address.country]
    .filter((line): line is string => Boolean(cleanText(line)));
}

function addressLines(address: CertificateHolderAddressInput) {
  const fieldLines = addressFieldLines(address);
  if (fieldLines.length > 0) return fieldLines;
  return certificateHolderAddressLines(address)
    .flatMap((line) => line.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function streetLines(address: CertificateHolderAddressInput) {
  if (address.line1 || address.line2) {
    return [address.line1, address.line2]
      .filter((line): line is string => Boolean(cleanText(line)));
  }
  const lines = address.formatted
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) ?? [];
  return lines.slice(0, Math.min(2, lines.length));
}

function firstUnit(value?: string) {
  const normalized = value ? normalizeAddressText(value) : undefined;
  const match = normalized?.match(/\bunit\s+([a-z0-9-]+)\b/);
  return match?.[1];
}

function stripUnit(value?: string) {
  return value
    ?.replace(/\bunit\s+[a-z0-9-]+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripKnownLocalityParts(value: string, address: CertificateHolderAddressInput) {
  let next = value;
  for (const part of [address.city, address.state, address.postalCode, address.country]) {
    const normalized = part ? normalizeAddressText(part) : undefined;
    if (!normalized) continue;
    next = next.replace(new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "g"), " ");
  }
  return next.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeCertificateHolderIdentityAddress(
  address?: CertificateHolderAddressInput,
): NormalizedCertificateHolderAddress | undefined {
  if (!address) return undefined;
  const lines = addressLines(address);
  if (lines.length === 0) return undefined;

  const normalizedLines = lines
    .map((line) => normalizeAddressText(line))
    .filter((line): line is string => Boolean(line));
  const canonicalText = compactAddressText(normalizedLines.join(" "));
  if (!canonicalText) return undefined;

  const streetText = normalizeAddressText(streetLines(address).join(" "));
  const streetWithoutUnit = stripKnownLocalityParts(
    stripUnit(streetText) ?? "",
    address,
  );
  const streetKey = compactAddressText(streetWithoutUnit);
  const wholeText = normalizeAddressText(normalizedLines.join(" "));
  const unit = firstUnit(streetText) ?? firstUnit(wholeText);
  const parsedPostal = wholeText?.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];

  return {
    canonicalText,
    streetKey,
    unit,
    city: cleanText(address.city)?.toLowerCase(),
    state: normalizeState(address.state),
    postalCode: normalizePostalCode(address.postalCode) ?? parsedPostal,
    country: cleanText(address.country)?.toLowerCase(),
  };
}

export function certificateHolderIdentity(args: {
  displayName: string;
  address?: CertificateHolderAddressInput;
}): CertificateHolderIdentity {
  return {
    displayName: args.displayName.trim(),
    normalizedName: normalizeCertificateHolderName(args.displayName),
    address: args.address,
    normalizedAddress: normalizeCertificateHolderIdentityAddress(args.address),
  };
}

function nameTokens(value: string) {
  return new Set(value.split(/\s+/).filter((token) => token.length > 1));
}

function nameOverlap(left: string, right: string) {
  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

type AddressComparison = "same" | "different" | "one_missing" | "both_missing" | "ambiguous";

export function compareCertificateHolderAddresses(
  left?: NormalizedCertificateHolderAddress,
  right?: NormalizedCertificateHolderAddress,
): AddressComparison {
  if (!left && !right) return "both_missing";
  if (!left || !right) return "one_missing";
  if (left.canonicalText === right.canonicalText) return "same";

  const sameStreet = Boolean(left.streetKey && right.streetKey && left.streetKey === right.streetKey);
  if (sameStreet) {
    if (left.unit || right.unit) {
      if (!left.unit || !right.unit) return "ambiguous";
      if (left.unit !== right.unit) return "different";
    }
    if (left.postalCode && right.postalCode && left.postalCode !== right.postalCode) return "different";
    if (left.city && right.city && left.city !== right.city) return "different";
    if (left.state && right.state && left.state !== right.state) return "different";
    return "same";
  }

  if (left.postalCode && right.postalCode && left.postalCode !== right.postalCode) {
    return "different";
  }
  if (left.unit && right.unit && left.unit !== right.unit) {
    return "different";
  }
  return "ambiguous";
}

export function compareCertificateHolderIdentities(
  requested: CertificateHolderIdentity,
  candidate: CertificateHolderIdentity,
): {
  verdict: Exclude<HolderIdentityVerdict, "needs_model" | "no_match">;
  confidence: "high" | "moderate" | "low";
  reason: string;
} {
  if (!requested.normalizedName || !candidate.normalizedName) {
    return {
      verdict: "different_holder",
      confidence: "high",
      reason: "Missing holder name.",
    };
  }

  if (requested.normalizedName !== candidate.normalizedName) {
    const overlap = nameOverlap(requested.normalizedName, candidate.normalizedName);
    if (overlap >= 0.75) {
      return {
        verdict: "ambiguous",
        confidence: "moderate",
        reason: "Holder names are similar but not an exact deterministic match.",
      };
    }
    return {
      verdict: "different_holder",
      confidence: "high",
      reason: "Holder names differ.",
    };
  }

  const address = compareCertificateHolderAddresses(
    requested.normalizedAddress,
    candidate.normalizedAddress,
  );
  if (address === "same") {
    return {
      verdict: "same_holder",
      confidence: "high",
      reason: "Holder name and normalized address match.",
    };
  }
  if (address === "both_missing") {
    return {
      verdict: "same_holder",
      confidence: "moderate",
      reason: "Holder name matches and neither side has an address.",
    };
  }
  if (address === "different") {
    return {
      verdict: "different_holder",
      confidence: "high",
      reason: "Holder name matches but address unit, postal code, or locality differs.",
    };
  }
  return {
    verdict: "ambiguous",
    confidence: "moderate",
    reason: address === "one_missing"
      ? "Holder name matches but one side is missing an address."
      : "Holder name matches but addresses are not deterministically comparable.",
  };
}

function candidateTime(candidate: CertificateHolderResolutionCandidate) {
  return Number(candidate.issuedAt ?? candidate.createdAt ?? 0);
}

function newestCandidate<T>(
  candidates: CertificateHolderResolutionCandidate<T>[],
) {
  return [...candidates].sort((left, right) => candidateTime(right) - candidateTime(left))[0];
}

function explicitAddressConflict<T>(
  candidates: CertificateHolderResolutionCandidate<T>[],
) {
  const addressed = candidates.filter((candidate) => candidate.identity.normalizedAddress);
  for (let index = 0; index < addressed.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < addressed.length; otherIndex += 1) {
      const comparison = compareCertificateHolderAddresses(
        addressed[index]?.identity.normalizedAddress,
        addressed[otherIndex]?.identity.normalizedAddress,
      );
      if (comparison !== "same" && comparison !== "both_missing" && comparison !== "one_missing") {
        return true;
      }
    }
  }
  return false;
}

function plausibleForModel<T>(
  requested: CertificateHolderIdentity,
  candidates: CertificateHolderResolutionCandidate<T>[],
) {
  return candidates.filter((candidate) => {
    if (nameOverlap(requested.normalizedName, candidate.identity.normalizedName) >= 0.5) {
      return true;
    }
    const addressComparison = compareCertificateHolderAddresses(
      requested.normalizedAddress,
      candidate.identity.normalizedAddress,
    );
    return addressComparison === "same";
  });
}

export function resolveDeterministicCertificateHolder<T>(
  requested: CertificateHolderIdentity,
  candidates: CertificateHolderResolutionCandidate<T>[],
): CertificateHolderResolutionResult<T> {
  if (candidates.length === 0) {
    return {
      verdict: "no_match",
      confidence: "high",
      reason: "No issued certificate candidates exist for this policy and request.",
    };
  }

  const exactNameCandidates = candidates.filter((candidate) =>
    candidate.identity.normalizedName === requested.normalizedName,
  );
  const sameAddressCandidates = exactNameCandidates.filter((candidate) =>
    compareCertificateHolderIdentities(requested, candidate.identity).verdict === "same_holder",
  );
  if (sameAddressCandidates.length > 0) {
    const candidate = newestCandidate(sameAddressCandidates);
    return {
      verdict: "same_holder",
      confidence: sameAddressCandidates.length === 1 ? "high" : "moderate",
      reason: sameAddressCandidates.length === 1
        ? "Found one issued certificate with the same holder identity."
        : "Found multiple same-holder certificate candidates and selected the latest issued version.",
      candidate,
    };
  }

  if (!requested.normalizedAddress && exactNameCandidates.length > 0) {
    if (!explicitAddressConflict(exactNameCandidates)) {
      const candidate = newestCandidate(exactNameCandidates);
      return {
        verdict: "same_holder",
        confidence: exactNameCandidates.length === 1 ? "high" : "moderate",
        reason: exactNameCandidates.length === 1
          ? "Holder name matches the only current issued holder for this policy."
          : "Holder name matches multiple candidates that do not have conflicting addresses; selected the latest issued version.",
        candidate,
      };
    }
    return {
      verdict: "ambiguous",
      confidence: "moderate",
      reason: "Holder name matches multiple issued certificates with different addresses.",
      candidates: exactNameCandidates,
    };
  }

  const ambiguous = exactNameCandidates.filter((candidate) =>
    compareCertificateHolderIdentities(requested, candidate.identity).verdict === "ambiguous",
  );
  if (ambiguous.length > 0) {
    return {
      verdict: "ambiguous",
      confidence: "moderate",
      reason: "Holder name matches but address identity is ambiguous.",
      candidates: ambiguous,
    };
  }

  const plausible = plausibleForModel(requested, candidates);
  if (plausible.length > 0) {
    return {
      verdict: "needs_model",
      confidence: "moderate",
      reason: "No deterministic match was found, but some policy candidates are close enough for model review.",
      candidates: plausible.slice(0, 5),
    };
  }

  return {
    verdict: "no_match",
    confidence: "moderate",
    reason: "No same-holder certificate candidate matched the requested holder.",
  };
}

function formatIdentity(identity: CertificateHolderIdentity) {
  return {
    name: identity.displayName,
    normalizedName: identity.normalizedName,
    address: identity.address,
    normalizedAddress: identity.normalizedAddress,
  };
}

export function buildHolderIdentityReviewPrompt<T>(args: {
  requested: CertificateHolderIdentity;
  candidates: CertificateHolderResolutionCandidate<T>[];
}) {
  return `Decide whether the requested certificate holder is the same real-world certificate holder as one of the existing issued certificate candidates.

Rules:
- Only choose a candidate listed below. Do not invent candidates.
- Compare holder legal/display name plus address.
- Ignore casing, punctuation, line breaks, common street/unit abbreviations, and whether suite/unit is on line 1 or line 2.
- Contact name, email, and phone are delivery metadata. They must not make different holder names match.
- If the holder name is materially different, do not select that candidate even when email or contact details look related.
- If multiple candidates could be the same holder and you cannot choose one, return ambiguous.
- If the requested holder has no address and exactly one plausible same-name candidate exists, selecting that candidate is acceptable.

Requested holder:
${JSON.stringify(formatIdentity(args.requested), null, 2)}

Existing issued certificate candidates:
${JSON.stringify(args.candidates.map((candidate) => ({
  candidateId: candidate.candidateId,
  issuedAt: candidate.issuedAt,
  identity: formatIdentity(candidate.identity),
})), null, 2)}`;
}
