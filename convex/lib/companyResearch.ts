import { v } from "convex/values";
import { ORG_WIKI_SECTIONS } from "./orgWiki";

export const COMPANY_RESEARCH_VERSION = "public-company-v2";
export const companyResearchFactValidator = v.object({
  key: v.union(...ORG_WIKI_SECTIONS.map(([key]) => v.literal(key))),
  content: v.string(),
  sourceRef: v.string(),
});
export const companyResearchValidator = v.object({
  version: v.string(),
  fingerprint: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("partial"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  leaseId: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  error: v.optional(v.string()),
  unresolvedFields: v.array(v.string()),
  sourceUrls: v.array(v.string()),
  facts: v.array(companyResearchFactValidator),
  updatedAt: v.number(),
});

type PublicCompanyIdentity = {
  name: string;
  website?: string;
};

export function companyResearchFingerprint(org: PublicCompanyIdentity) {
  return JSON.stringify([
    COMPANY_RESEARCH_VERSION,
    org.name.trim(),
    org.website?.trim() ?? "",
  ]);
}

export function publicResearchUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const host = url.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      /^[\d.]+$/.test(host) ||
      host.includes(":") ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function publicResearchSiteHostname(value: string) {
  const normalized = publicResearchUrl(value);
  if (!normalized) return null;
  return new URL(normalized).hostname.replace(/^www\./, "");
}

export function samePublicResearchSite(left: string, right: string) {
  const leftHostname = publicResearchSiteHostname(left);
  return Boolean(
    leftHostname && leftHostname === publicResearchSiteHostname(right),
  );
}

export function samePublicResearchUrl(left: string, right: string) {
  const leftUrl = publicResearchUrl(left);
  const rightUrl = publicResearchUrl(right);
  if (!leftUrl || !rightUrl) return false;
  const normalizedLeft = new URL(leftUrl);
  const normalizedRight = new URL(rightUrl);
  normalizedLeft.hostname = publicResearchSiteHostname(left)!;
  normalizedRight.hostname = publicResearchSiteHostname(right)!;
  return normalizedLeft.toString() === normalizedRight.toString();
}

export function publicResearchAllowedDomains(value: string) {
  const hostname = publicResearchSiteHostname(value);
  return hostname ? [hostname, `www.${hostname}`] : [];
}

export function companyResearchFingerprintMatchesIdentity(
  fingerprint: string,
  org: PublicCompanyIdentity,
) {
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    if (!Array.isArray(parsed) || typeof parsed[1] !== "string") return false;
    const previousWebsite =
      parsed[0] === COMPANY_RESEARCH_VERSION
        ? parsed[2]
        : parsed[0] === "public-company-v1"
          ? parsed[3]
          : undefined;
    if (typeof previousWebsite !== "string" || parsed[1] !== org.name.trim())
      return false;
    const website = org.website?.trim() ?? "";
    return (
      previousWebsite === website ||
      (Boolean(previousWebsite) &&
        Boolean(website) &&
        samePublicResearchSite(previousWebsite, website))
    );
  } catch {
    return false;
  }
}
