import dayjs from "dayjs";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { COMPANY_RESEARCH_VERSION, companyResearchFactValidator, companyResearchFingerprint, publicResearchUrl, samePublicResearchSite, samePublicResearchUrl } from "./lib/companyResearch";
import { validateClientClassification } from "./lib/clientProfile";
import { reconcileExtractedCompanyFacts } from "./orgWiki";

const LEASE_MS = 5 * 60 * 1_000;
const MAX_ATTEMPTS = 3;
const runRef = makeFunctionReference<"action", { orgId: Id<"organizations"> }>("actions/companyResearch:run");
const recoverRef = makeFunctionReference<"mutation", { orgId: Id<"organizations">; leaseId: string }>("companyResearch:recover");

function missingFields(org: Doc<"organizations">) {
  return [!org.website && "website", !org.industry && "industry", !org.industryVertical && "industryVertical"].filter((field): field is string => Boolean(field));
}

export async function scheduleCompanyResearch(ctx: MutationCtx, orgId: Id<"organizations">, options: { force?: boolean } = {}) {
  const org = await ctx.db.get(orgId);
  if (!org || org.type !== "client") return false;
  const fingerprint = companyResearchFingerprint(org);
  if (org.companyResearch?.fingerprint === fingerprint && (!options.force || ["pending", "running"].includes(org.companyResearch.status))) return false;
  await ctx.db.patch(orgId, {
    companyResearch: {
      version: COMPANY_RESEARCH_VERSION, fingerprint, status: "pending", attempts: 0,
      unresolvedFields: missingFields(org), sourceUrls: org.companyResearch?.sourceUrls ?? [], facts: org.companyResearch?.facts ?? [], updatedAt: dayjs().valueOf(),
    },
  });
  await ctx.scheduler.runAfter(0, runRef, { orgId });
  return true;
}

export const claim = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org || org.type !== "client") return null;
    const research = org.companyResearch;
    if (!research || research.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, orgId);
      return null;
    }
    if (research.status !== "pending") return null;
    const now = dayjs().valueOf();
    const leaseId = crypto.randomUUID();
    await ctx.db.patch(orgId, { companyResearch: { ...research, status: "running", attempts: research.attempts + 1, leaseId, leaseExpiresAt: now + LEASE_MS, error: undefined, updatedAt: now } });
    await ctx.scheduler.runAfter(LEASE_MS, recoverRef, { orgId, leaseId });
    return {
      orgId, leaseId, fingerprint: research.fingerprint, name: org.name,
      legalNames: (org.relatedLegalEntities ?? []).map((entity) => entity.legalName),
      website: org.website, industry: org.industry, industryVertical: org.industryVertical,
    };
  },
});

async function failLease(ctx: MutationCtx, org: Doc<"organizations">, error: string) {
  const research = org.companyResearch!;
  const retry = research.attempts < MAX_ATTEMPTS;
  await ctx.db.patch(org._id, { companyResearch: { ...research, status: retry ? "pending" : "failed", error: error.slice(0, 500), leaseId: undefined, leaseExpiresAt: undefined, updatedAt: dayjs().valueOf() } });
  if (retry) await ctx.scheduler.runAfter(research.attempts * 1_000, runRef, { orgId: org._id });
}

export const recover = internalMutation({
  args: { orgId: v.id("organizations"), leaseId: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org || org.companyResearch?.status !== "running" || org.companyResearch.leaseId !== args.leaseId) return;
    if ((org.companyResearch.leaseExpiresAt ?? 0) > dayjs().valueOf()) return;
    if (org.companyResearch.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return;
    }
    await failLease(ctx, org, "Public company research lease expired");
  },
});

export const fail = internalMutation({
  args: { orgId: v.id("organizations"), leaseId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org || org.companyResearch?.status !== "running" || org.companyResearch.leaseId !== args.leaseId) return false;
    if (org.companyResearch.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return false;
    }
    await failLease(ctx, org, args.error);
    return true;
  },
});

export const complete = internalMutation({
  args: {
    orgId: v.id("organizations"), leaseId: v.string(), fingerprint: v.string(),
    website: v.optional(v.string()), industry: v.optional(v.string()), industryVertical: v.optional(v.string()),
    facts: v.array(companyResearchFactValidator), sourceUrls: v.array(v.string()), reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    const research = org?.companyResearch;
    if (!org || !research || research.status !== "running" || research.leaseId !== args.leaseId || research.fingerprint !== args.fingerprint) return false;
    if (research.fingerprint !== companyResearchFingerprint(org)) {
      await scheduleCompanyResearch(ctx, org._id);
      return false;
    }
    const currentSourceUrls = [...new Set(args.sourceUrls.map(publicResearchUrl).filter((url): url is string => Boolean(url)))].slice(0, 10);
    const currentFacts = args.facts.flatMap((fact) => {
      const sourceRef = currentSourceUrls.find((url) => samePublicResearchUrl(url, fact.sourceRef));
      return sourceRef && fact.content.length <= 1_200 ? [{ ...fact, sourceRef }] : [];
    }).slice(0, 40);
    const facts = [...new Map([...currentFacts, ...research.facts].map((fact) => [JSON.stringify([fact.key, fact.content, fact.sourceRef]), fact])).values()].slice(0, 40);
    const sourceUrls = [...new Set([...currentSourceUrls, ...facts.map((fact) => fact.sourceRef)])];
    const patch: Partial<Doc<"organizations">> = {};
    const website = args.website && publicResearchUrl(args.website);
    if (!org.website && website && currentSourceUrls.some((url) => samePublicResearchSite(url, website))) patch.website = website;
    if (currentSourceUrls.length) {
      const industry = org.industry || args.industry;
      const vertical = !args.industry || args.industry === industry ? args.industryVertical : undefined;
      validateClientClassification(industry, vertical);
      if (!org.industry && args.industry) patch.industry = args.industry;
      if (!org.industryVertical && vertical) patch.industryVertical = vertical;
    }
    const updated = { ...org, ...patch };
    const unresolvedFields = missingFields(updated);
    if (!currentSourceUrls.length || args.reason) unresolvedFields.push("publicIdentity");
    if (!currentFacts.length) unresolvedFields.push("companyFacts");
    await ctx.db.patch(org._id, { ...patch, companyResearch: { ...research,
      fingerprint: companyResearchFingerprint(updated), status: unresolvedFields.length ? "partial" : "completed",
      sourceUrls, facts, unresolvedFields, error: args.reason, leaseId: undefined, leaseExpiresAt: undefined, updatedAt: dayjs().valueOf(),
    } });
    const extractions = await ctx.db.query("companyInformationExtractions").withIndex("organization", (q) => q.eq("orgId", org._id)).order("desc").take(500);
    await reconcileExtractedCompanyFacts(ctx, { orgId: org._id, source: "extraction", facts: [
      ...extractions.filter((row) => row.appliedFingerprint).flatMap((row) => (row.organizationFacts ?? []).map((fact) => ({ key: fact.section ?? "profile" as const, content: fact.content, sourceRef: row.sourceRef }))),
      ...facts.map((fact) => ({ ...fact, content: `${fact.content} [Source](${fact.sourceRef})` })),
    ] });
    return true;
  },
});

async function requestResearch(ctx: MutationCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org || org.type !== "client") throw new Error("Client not found");
  const queued = await scheduleCompanyResearch(ctx, orgId, { force: true });
  const current = await ctx.db.get(orgId);
  return { success: true as const, queued, status: current!.companyResearch!.status };
}

export const request = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => requestResearch(ctx, args.orgId),
});

export const requestForUser = internalMutation({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db.query("orgMemberships").withIndex("organization_user", (q) => q.eq("orgId", args.orgId).eq("userId", args.userId)).unique();
    if (membership?.role !== "admin") throw new Error("Only a direct organization admin can research this company");
    const impersonation = await ctx.db.query("operatorImpersonationSessions").withIndex("operator_status", (q) => q.eq("operatorUserId", args.userId).eq("status", "active")).first();
    if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
    return requestResearch(ctx, args.orgId);
  },
});
